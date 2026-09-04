import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../shared/errors.js';

interface TokenPayload {
  sub: string;
  email: string;
  role: string;
}

interface RefreshPayload {
  sub: string;
}

export class AuthService {
  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Generic error for any credential mismatch — never reveal which field is wrong (Req 7.7)
    const genericError = new UnauthorizedError('Credenciales incorrectas');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw genericError;

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) throw genericError;

    // Access token: 15 minutes
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role } satisfies TokenPayload,
      env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    // Refresh token: 7 days
    const refreshToken = jwt.sign(
      { sub: user.id } satisfies RefreshPayload,
      env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' },
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    // Verify JWT signature first
    let payload: RefreshPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshPayload;
    } catch {
      throw new UnauthorizedError('Token de refresco inválido o expirado');
    }

    // Look up in DB and check revocation/expiry
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revokedAt !== null || stored.expiresAt <= new Date()) {
      throw new UnauthorizedError('Token de refresco inválido o expirado');
    }

    // Validate sub matches (extra safety)
    if (stored.userId !== payload.sub) {
      throw new UnauthorizedError('Token de refresco inválido o expirado');
    }

    const accessToken = jwt.sign(
      {
        sub: stored.user.id,
        email: stored.user.email,
        role: stored.user.role,
      } satisfies TokenPayload,
      env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    return { accessToken };
  }

  async logout(refreshToken: string): Promise<void> {
    // Silently ignore if token not found — idempotent logout
    await prisma.refreshToken
      .update({
        where: { token: refreshToken },
        data: { revokedAt: new Date() },
      })
      .catch(() => {
        // Token not found or already revoked — ignore
      });
  }
}

export const authService = new AuthService();
