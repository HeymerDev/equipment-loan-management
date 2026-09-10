import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { categoriesService } from "./categories.service.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

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
