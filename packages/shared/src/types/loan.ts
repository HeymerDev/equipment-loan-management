import { LoanStatus } from '../enums.js';

/** Public representation of a loan. */
export interface LoanDto {
  id: string;
  status: LoanStatus;
  startDate: string; // ISO 8601
  agreedReturnDate: string; // ISO 8601
  actualReturnDate?: string; // ISO 8601 — present once returned
  returnedLate?: boolean;
  daysLate?: number;
  returnNotes?: string;
  /** True when agreedReturnDate < now() and the loan is still ACTIVO. */
  isOverdue: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  requestId: string;
  equipmentId: string;
  equipmentName: string;
  equipmentSerialNumber: string;
  teacherId: string;
  teacherName: string;
}

/** Request body for POST /loans/:id/return. */
export interface ReturnLoanDto {
  /** Optional return notes. Maximum 500 characters. */
  returnNotes?: string;
}
