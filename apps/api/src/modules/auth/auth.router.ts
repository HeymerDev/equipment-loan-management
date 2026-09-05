import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { authService } from "./auth.service.js";
import { loginSchema } from "./auth.schema.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { env } from "../../config/env.js";

export const authRouter: IRouter = Router();

const REFRESH_TOKEN_COOKIE = "refreshToken";

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: "/",
};

// POST /auth/login
authRouter.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = loginSchema.parse(req.body);
      const { accessToken, refreshToken } = await authService.login(
        body.email,
        body.password,
      );

      res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions);
      res.status(200).json({ data: { accessToken } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/refresh
authRouter.post(
  "/refresh",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE] as
        string | undefined;

      if (!refreshToken) {
        res.status(401).json({
          error: {
            code: "UNAUTHORIZED",
            message: "Token de refresco no encontrado",
          },
        });
        return;
      }

      const { accessToken } = await authService.refresh(refreshToken);
      res.status(200).json({ data: { accessToken } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/logout  (requires valid access token)
authRouter.post(
  "/logout",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE] as
        string | undefined;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/" });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
