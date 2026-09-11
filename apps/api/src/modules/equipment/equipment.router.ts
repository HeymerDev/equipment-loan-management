import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { Role } from '@prisma/client';
import { equipmentService } from './equipment.service.js';
import {
  createEquipmentSchema,
  updateEquipmentSchema,
  equipmentIdParamSchema,
  listEquipmentQuerySchema,
  equipmentHistoryQuerySchema,
} from './equipment.schema.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/role.middleware.js';
import { UnauthorizedError } from '../../shared/errors.js';

export const equipmentRouter: IRouter = Router();

/** `authenticate` guarantees `req.user`; this narrows the optional type. */
function actorId(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

// GET /equipment  (authenticated — admins manage the inventory, teachers browse it)
equipmentRouter.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listEquipmentQuerySchema.parse(req.query);
      const result = await equipmentService.listEquipment(query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /equipment  (admin)
equipmentRouter.post(
  '/',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createEquipmentSchema.parse(req.body);
      const equipment = await equipmentService.createEquipment(
        body,
        actorId(req),
      );
      res.status(201).json({ data: equipment });
    } catch (err) {
      next(err);
    }
  },
);

// GET /equipment/:id  (authenticated)
equipmentRouter.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = equipmentIdParamSchema.parse(req.params);
      const equipment = await equipmentService.getEquipmentById(id);
      res.status(200).json({ data: equipment });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /equipment/:id  (admin)
equipmentRouter.patch(
  '/:id',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = equipmentIdParamSchema.parse(req.params);
      const body = updateEquipmentSchema.parse(req.body);
      const equipment = await equipmentService.updateEquipment(
        id,
        body,
        actorId(req),
      );
      res.status(200).json({ data: equipment });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /equipment/:id  (admin — soft-delete)
equipmentRouter.delete(
  '/:id',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = equipmentIdParamSchema.parse(req.params);
      await equipmentService.deleteEquipment(id, actorId(req));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// GET /equipment/:id/history  (admin)
equipmentRouter.get(
  '/:id/history',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = equipmentIdParamSchema.parse(req.params);
      const query = equipmentHistoryQuerySchema.parse(req.query);
      const result = await equipmentService.listEquipmentHistory(id, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
