/**
 * Contrato de la API REST (`/api/v1`), tal como la responden los servicios.
 * Fechas en ISO 8601. Los días de préstamo (inicio, devolución pactada) son
 * días calendario guardados a la medianoche UTC.
 */

export type Role = "ADMINISTRADOR" | "DOCENTE";
export type EquipmentStatus = "DISPONIBLE" | "PRESTADO";
export type LoanRequestStatus = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
export type LoanStatus = "ACTIVO" | "FINALIZADO";
export type EventType =
  | "EQUIPMENT_CREATED"
  | "EQUIPMENT_UPDATED"
  | "EQUIPMENT_DELETED"
  | "REQUEST_CREATED"
  | "REQUEST_APPROVED"
  | "REQUEST_REJECTED"
  | "REQUEST_CANCELLED"
  | "LOAN_STARTED"
  | "LOAN_RETURNED";

// ─── Envolturas de respuesta ──────────────────────────────────────────────────

export interface Item<T> {
  data: T;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

// ─── Catálogo e inventario ────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  name: string;
  serialNumber: string;
  description: string;
  status: EquipmentStatus;
  categoryId: string;
  categoryName: string;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentInput {
  name: string;
  serialNumber: string;
  description: string;
  categoryId: string;
}

// ─── Solicitudes ──────────────────────────────────────────────────────────────

export interface LoanRequest {
  id: string;
  status: LoanRequestStatus;
  purpose: string;
  startDate: string;
  returnDate: string;
  rejectionReason?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  teacherId: string;
  teacherName: string;
  equipmentId: string;
  equipmentName: string;
}

export interface LoanRequestInput {
  equipmentId: string;
  purpose: string;
  /** Día calendario YYYY-MM-DD. */
  startDate: string;
  /** Día calendario YYYY-MM-DD. */
  returnDate: string;
}

export interface ApprovedLoan {
  id: string;
  status: LoanStatus;
  startDate: string;
  agreedReturnDate: string;
  equipmentId: string;
  requestId: string;
}

/** Cuerpo de `POST /loan-requests/:id/approve` (200, o 207 si el PDF falló). */
export interface ApproveResult {
  request: LoanRequest;
  loan: ApprovedLoan;
  autoCancelledRequestIds: string[];
  pdfGenerated: boolean;
  pdfUrl?: string;
}

// ─── Préstamos ────────────────────────────────────────────────────────────────

export interface Loan {
  id: string;
  status: LoanStatus;
  startDate: string;
  agreedReturnDate: string;
  actualReturnDate?: string;
  returnedLate?: boolean;
  daysLate?: number;
  returnNotes?: string;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  requestId: string;
  equipmentId: string;
  equipmentName: string;
  equipmentSerialNumber: string;
  teacherId: string;
  teacherName: string;
}

// ─── Historial y usuarios ─────────────────────────────────────────────────────

export interface ChangedField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface HistoryEvent {
  id: string;
  eventType: EventType;
  entityId: string;
  entityTable: string;
  userId: string;
  occurredAt: string;
  changedFields?: ChangedField[];
  equipmentId?: string;
  requestId?: string;
  loanId?: string;
}

export interface UserInput {
  fullName: string;
  email: string;
  role: Role;
}

/** Respuesta de `POST /users`: la contraseña temporal se devuelve una sola vez. */
export interface CreatedUser {
  user: UserSummary;
  temporaryPassword: string;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}
