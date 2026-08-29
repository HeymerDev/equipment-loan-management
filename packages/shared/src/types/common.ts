/**
 * Generic HTTP response wrappers used by both the API and the web client.
 */

/** Successful response wrapping a single item. */
export interface ApiResponse<T> {
  data: T;
}

/** Successful response wrapping a paginated list. */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

/** Structured error response. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** The field that failed validation, if applicable. */
    field?: string;
  };
}
