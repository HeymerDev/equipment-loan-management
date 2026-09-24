export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(400, 'VALIDATION_ERROR', message, field);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autenticación requerida') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tiene permisos para esta acción') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} no encontrado`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class PdfGenerationError extends AppError {
  constructor(message = 'El comprobante PDF no pudo generarse') {
    super(500, 'PDF_GENERATION_FAILED', message);
  }
}

/**
 * The account still has the temporary password an administrator generated:
 * every endpoint except the auth ones is closed until it is changed.
 */
export class PasswordChangeRequiredError extends AppError {
  constructor(
    message = 'Debes cambiar tu contraseña temporal antes de continuar',
  ) {
    super(403, 'PASSWORD_CHANGE_REQUIRED', message);
  }
}
