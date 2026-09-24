import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import {
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors.js';

interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  /** True while the account still carries an administrator's temporary password. */
  mustChangePassword: boolean;
}

interface RefreshPayload {
  sub: string;
  /**
   * Lets the web middleware route by role from the session cookie alone. It is
   * never trusted for authorisation: `refresh` re-reads the role from the
   * database, and every endpoint checks the access token.
   */
  role: string;
}

export class AuthService {
  async login(
    email: string,
    password: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    mustChangePassword: boolean;
  }> {
    // Generic error for any credential mismatch — never reveal which field is wrong (Req 7.7)
    const genericError = new UnauthorizedError('Credenciales incorrectas');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw genericError;

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) throw genericError;

    // Access token: 15 minutes
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      } satisfies TokenPayload,
      env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    // Refresh token: 7 days
    const refreshToken = jwt.sign(
      { sub: user.id, role: user.role } satisfies RefreshPayload,
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

    return {
      accessToken,
      refreshToken,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; mustChangePassword: boolean }> {
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
        mustChangePassword: stored.user.mustChangePassword,
      } satisfies TokenPayload,
      env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    return {
      accessToken,
      mustChangePassword: stored.user.mustChangePassword,
    };
  }

  /**
   * Replaces the user's own password. It clears the temporary-password flag
   * and revokes every other session, so a password handed over by an
   * administrator stops working everywhere once the user changes it.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepRefreshToken?: string,
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError();

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new ValidationError(
        'La contraseña actual no es correcta',
        'currentPassword',
      );
    }

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new ValidationError(
        'La nueva contraseña debe ser distinta de la actual',
        'newPassword',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
      }),
      prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepRefreshToken !== undefined && {
            token: { not: keepRefreshToken },
          }),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
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
