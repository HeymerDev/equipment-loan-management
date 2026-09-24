import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { Role } from '@prisma/client';
import { usersService } from './users.service.js';
import { createUserSchema } from './users.schema.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/role.middleware.js';

export const usersRouter: IRouter = Router();

// GET /users  (admin)
usersRouter.get(
  '/',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await usersService.listUsers();
      res.status(200).json({ data: users });
    } catch (err) {
      next(err);
    }
  },
);

// POST /users  (admin — registers a teacher or another administrator)
usersRouter.post(
  '/',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createUserSchema.parse(req.body);
      const created = await usersService.createUser(body);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  },
);
