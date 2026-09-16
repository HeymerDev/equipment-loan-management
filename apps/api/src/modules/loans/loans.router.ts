import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { Role } from '@prisma/client';
import { loansService, type LoanActor } from './loans.service.js';
import {
  returnLoanSchema,
  loanIdParamSchema,
  listLoansQuerySchema,
} from './loans.schema.js';
import { pdfService } from '../pdf/pdf.service.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/role.middleware.js';
import { UnauthorizedError } from '../../shared/errors.js';

export const loansRouter: IRouter = Router();

/** `authenticate` guarantees `req.user`; this narrows the optional type. */
function actor(req: Request): LoanActor {
  if (!req.user) throw new UnauthorizedError();
  return { id: req.user.id, role: req.user.role };
}

// GET /loans  (admin — active loans by default)
loansRouter.get(
  '/',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listLoansQuerySchema.parse(req.query);
      const result = await loansService.listActiveLoans(query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /loans/:id  (authenticated — a teacher only sees their own)
loansRouter.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanIdParamSchema.parse(req.params);
      const loan = await loansService.getLoanById(id, actor(req));
      res.status(200).json({ data: loan });
    } catch (err) {
      next(err);
    }
  },
);

// POST /loans/:id/return  (admin)
loansRouter.post(
  '/:id/return',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanIdParamSchema.parse(req.params);
      const body = returnLoanSchema.parse(req.body ?? {});
      const loan = await loansService.returnLoan(id, body, actor(req).id);
      res.status(200).json({ data: loan });
    } catch (err) {
      next(err);
    }
  },
);

// GET /loans/:id/pdf  (admin) — rendered on every request from current data
loansRouter.get(
  '/:id/pdf',
  authenticate,
  requireRole(Role.ADMINISTRADOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = loanIdParamSchema.parse(req.params);
      const pdf = await pdfService.generateVoucher(id);

      res
        .status(200)
        .set({
          'Content-Type': 'application/pdf',
          // inline: the browser opens it in its viewer, ready to print (Req 6.2).
          'Content-Disposition': `inline; filename="comprobante-prestamo-${id}.pdf"`,
          'Content-Length': String(pdf.length),
          // Never serve a cached copy: a regeneration must show current data (Req 6.5).
          'Cache-Control': 'no-store',
        })
        .send(pdf);
    } catch (err) {
      next(err);
    }
  },
);
