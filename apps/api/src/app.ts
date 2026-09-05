import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errorHandler } from "./middlewares/error.middleware.js";

export const app: Express = express();

// ── Global middlewares ────────────────────────────────────────────────────────

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true, // required for cookie-based refresh token
  }),
);

app.use(express.json());
app.use(cookieParser());

// ── API routes ────────────────────────────────────────────────────────────────
// Routers are mounted here as each module is implemented.

import { authRouter } from "./modules/auth/auth.router.js";
app.use("/api/v1/auth", authRouter);

// import { categoriesRouter } from './modules/categories/categories.router.js';
// app.use('/api/v1/categories', categoriesRouter);

// import { equipmentRouter } from './modules/equipment/equipment.router.js';
// app.use('/api/v1/equipment', equipmentRouter);

// import { loanRequestsRouter } from './modules/loan-requests/loan-requests.router.js';
// app.use('/api/v1/loan-requests', loanRequestsRouter);

// import { loansRouter } from './modules/loans/loans.router.js';
// app.use('/api/v1/loans', loansRouter);

// import { historyRouter } from './modules/history/history.router.js';
// app.use('/api/v1/history', historyRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);
