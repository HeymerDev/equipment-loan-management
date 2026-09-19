import axios from "axios";

export interface ApiErrorInfo {
  status?: number;
  code?: string;
  /** Mensaje listo para mostrar al usuario. */
  message: string;
  /** Campo que falló la validación, cuando la API lo indica. */
  field?: string;
  /** Un mensaje por campo inválido (primer error de cada uno). */
  fieldErrors: Record<string, string>;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    field?: string;
    details?: Array<{ field?: string; message?: string }>;
  };
}

const NETWORK_MESSAGE = "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
const FALLBACK_MESSAGE = "Ocurrió un error inesperado. Inténtalo de nuevo.";

/** Traduce cualquier error de una petición al formato `{ error: {...} }` de la API. */
export function parseApiError(error: unknown, fallback = FALLBACK_MESSAGE): ApiErrorInfo {
  if (!axios.isAxiosError(error)) return { message: fallback, fieldErrors: {} };
  if (!error.response) return { message: NETWORK_MESSAGE, fieldErrors: {} };

  const body = (error.response.data ?? {}) as ApiErrorBody;
  const apiError = body.error;

  const fieldErrors: Record<string, string> = {};
  for (const detail of apiError?.details ?? []) {
    if (detail.field && detail.message && !(detail.field in fieldErrors)) {
      fieldErrors[detail.field] = detail.message;
    }
  }
  if (apiError?.field && apiError.message && !(apiError.field in fieldErrors)) {
    fieldErrors[apiError.field] = apiError.message;
  }

  return {
    status: error.response.status,
    code: apiError?.code,
    message: apiError?.message ?? fallback,
    field: apiError?.field,
    fieldErrors,
  };
}
