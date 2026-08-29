import { LoanRequestStatus } from '../enums.js';

/** Public representation of a loan request. */
export interface LoanRequestDto {
  id: string;
  status: LoanRequestStatus;
  purpose: string;
  startDate: string; // ISO 8601 date
  returnDate: string; // ISO 8601 date
  rejectionReason?: string;
  cancelledAt?: string; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  teacherId: string;
  teacherName: string;
  equipmentId: string;
  equipmentName: string;
}

/** Request body for POST /loan-requests. */
export interface CreateLoanRequestDto {
  equipmentId: string;
  purpose: string;
  startDate: string; // ISO 8601 date (YYYY-MM-DD)
  returnDate: string; // ISO 8601 date (YYYY-MM-DD)
}

/**
 * Request body for POST /loan-requests/:id/approve.
 * Currently no additional fields are required beyond authentication.
 */
export type ApproveLoanRequestDto = Record<string, never>;

/** Request body for POST /loan-requests/:id/reject. */
export interface RejectLoanRequestDto {
  /** Must be between 10 and 500 characters. */
  rejectionReason: string;
}
