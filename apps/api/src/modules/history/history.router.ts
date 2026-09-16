import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { Role } from '@prisma/client';
import { historyQueryService } from './history.service.js';
import { historyQuerySchema } from './history.schema.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/role.middleware.js';

export const historyRouter: IRouter = Router();

// The history is read-only (Req 5.4): this router deliberately exposes no
// PUT, PATCH or DELETE route.

// GET /history  (admin)
historyRouter.get(
  '/',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = historyQuerySchema.parse(req.query);
      const result = await historyQueryService.listEvents(query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
