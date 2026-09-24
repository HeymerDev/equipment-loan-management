import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { PasswordChangeRequiredError } from '../shared/errors.js';

/** Paths that stay open so the user can actually change the password. */
const ALLOWED_PREFIX = '/api/v1/auth/';

/**
 * Closes the API to accounts that still carry a temporary password (Req: alta
 * de usuarios). It runs before the routers, so a single place covers every
 * module; requests without a usable token fall through and each router answers
 * with its own 401.
 */
export function requirePasswordChanged(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.path.startsWith(ALLOWED_PREFIX)) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as {
      mustChangePassword?: boolean;
    };
    if (payload.mustChangePassword) throw new PasswordChangeRequiredError();
  } catch (err) {
    if (err instanceof PasswordChangeRequiredError) throw err;
    // An invalid or expired token is not this guard's business.
  }

  next();
}
