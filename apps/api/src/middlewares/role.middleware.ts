import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { ForbiddenError } from '../shared/errors.js';

/**
 * Middleware factory that restricts access to users with one of the specified roles.
 * Must be used after the `authenticate` middleware.
 */
export function requireRole(...roles: Role[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const user = _req.user;

    if (!user) {
      // Should not happen if authenticate ran first, but be defensive
      throw new ForbiddenError();
    }

    if (!roles.includes(user.role as Role)) {
      throw new ForbiddenError();
    }

    next();
  };
}
