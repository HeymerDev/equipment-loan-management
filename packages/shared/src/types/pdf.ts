/**
 * Data required to render a loan voucher PDF.
 * This DTO travels from the loans service to the PDF service.
 */
export interface VoucherDataDto {
  /** Loan identifier. */
  loanId: string;
  /** Full name of the equipment. */
  equipmentName: string;
  /** Equipment serial number. */
  serialNumber: string;
  /** Equipment category name. */
  categoryName: string;
  /** Full name of the teacher who requested the loan. */
  teacherName: string;
  /** Purpose stated in the loan request. */
  purpose: string;
  /** Loan start date (ISO 8601). */
  startDate: string;
  /** Agreed return date (ISO 8601). */
  agreedReturnDate: string;
  /**
   * Timestamp at which the PDF is generated, formatted as DD/MM/YYYY HH:MM.
   * Computed by the PDF service at generation time.
   */
  generatedAt: string;
}
