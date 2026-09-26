import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role } from "@prisma/client";
import { categoriesService } from "./categories.service.js";
import {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema,
} from "./categories.schema.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";

export const categoriesRouter: IRouter = Router();

// GET /categories  (any authenticated user — used to populate equipment forms)
categoriesRouter.get(
  "/",
  authenticate,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const categories = await categoriesService.listCategories();
      res.status(200).json({ data: categories });
    } catch (err) {
      next(err);
    }
  },
);

// POST /categories  (admin)
categoriesRouter.post(
  "/",
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createCategorySchema.parse(req.body);
      const category = await categoriesService.createCategory(body);
      res.status(201).json({ data: category });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /categories/:id  (admin — rename)
categoriesRouter.patch(
  "/:id",
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = categoryIdParamSchema.parse(req.params);
      const body = updateCategorySchema.parse(req.body);
      const category = await categoriesService.updateCategory(id, body);
      res.status(200).json({ data: category });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /categories/:id  (admin — only when no equipment uses it)
categoriesRouter.delete(
  "/:id",
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = categoryIdParamSchema.parse(req.params);
      await categoriesService.deleteCategory(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
