import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { Role } from '@prisma/client';
import {
  loanRequestsService,
  type RequestActor,
} from './loan-requests.service.js';
import {
  createLoanRequestSchema,
  rejectLoanRequestSchema,
  loanRequestIdParamSchema,
  listLoanRequestsQuerySchema,
  myLoanRequestsQuerySchema,
} from './loan-requests.schema.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/role.middleware.js';
import { UnauthorizedError } from '../../shared/errors.js';

export const loanRequestsRouter: IRouter = Router();

/** `authenticate` guarantees `req.user`; this narrows the optional type. */
function actor(req: Request): RequestActor {
  if (!req.user) throw new UnauthorizedError();
  return { id: req.user.id, role: req.user.role };
}

// GET /loan-requests  (admin — pending queue by default)
loanRequestsRouter.get(
  '/',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listLoanRequestsQuerySchema.parse(req.query);
      const result = await loanRequestsService.listPendingRequests(query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /loan-requests  (docente)
loanRequestsRouter.post(
  '/',
  authenticate,
  requireRole(Role.DOCENTE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createLoanRequestSchema.parse(req.body);
      const request = await loanRequestsService.createLoanRequest(
        body,
        actor(req).id,
      );
      res.status(201).json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);

// GET /loan-requests/my  (docente) — declared before `/:id` so "my" is not read as an id
loanRequestsRouter.get(
  '/my',
  authenticate,
  requireRole(Role.DOCENTE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = myLoanRequestsQuerySchema.parse(req.query);
      const result = await loanRequestsService.listMyRequests(
        actor(req).id,
        query,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /loan-requests/:id  (authenticated — a teacher only sees their own)
loanRequestsRouter.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanRequestIdParamSchema.parse(req.params);
      const request = await loanRequestsService.getLoanRequestById(
        id,
        actor(req),
      );
      res.status(200).json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /loan-requests/:id/cancel  (docente)
loanRequestsRouter.patch(
  '/:id/cancel',
  authenticate,
  requireRole(Role.DOCENTE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanRequestIdParamSchema.parse(req.params);
      const request = await loanRequestsService.cancelLoanRequest(
        id,
        actor(req).id,
      );
      res.status(200).json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);

// POST /loan-requests/:id/approve  (admin)
loanRequestsRouter.post(
  '/:id/approve',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanRequestIdParamSchema.parse(req.params);
      const result = await loanRequestsService.approveLoanRequest(
        id,
        actor(req).id,
      );

      // The loan stands even when the voucher fails, so this is a partial
      // success rather than an error (Req 3.7).
      if (!result.pdfGenerated) {
        res.status(207).json({
          data: result,
          warning:
            'El comprobante PDF no pudo generarse. El préstamo fue creado correctamente.',
        });
        return;
      }

      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /loan-requests/:id/reject  (admin)
loanRequestsRouter.post(
  '/:id/reject',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanRequestIdParamSchema.parse(req.params);
      const body = rejectLoanRequestSchema.parse(req.body);
      const request = await loanRequestsService.rejectLoanRequest(
        id,
        body.rejectionReason,
        actor(req).id,
      );
      res.status(200).json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);
