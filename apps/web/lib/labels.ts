import type {
  EquipmentStatus,
  EventType,
  LoanRequestStatus,
  LoanStatus,
  Role,
} from "@/lib/types";

export const ROLE_LABEL: Record<Role, string> = {
  ADMINISTRADOR: "Administrador",
  DOCENTE: "Docente",
};

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  DISPONIBLE: "Disponible",
  PRESTADO: "Prestado",
};

export const REQUEST_STATUS_LABEL: Record<LoanRequestStatus, string> = {
  PENDIENTE: "Pendiente",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  CANCELADA: "Cancelada",
};

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  ACTIVO: "Activo",
  FINALIZADO: "Finalizado",
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  EQUIPMENT_CREATED: "Equipo registrado",
  EQUIPMENT_UPDATED: "Equipo actualizado",
  EQUIPMENT_DELETED: "Equipo eliminado",
  REQUEST_CREATED: "Solicitud creada",
  REQUEST_APPROVED: "Solicitud aprobada",
  REQUEST_REJECTED: "Solicitud rechazada",
  REQUEST_CANCELLED: "Solicitud cancelada",
  LOAN_STARTED: "Préstamo iniciado",
  LOAN_RETURNED: "Equipo devuelto",
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABEL) as EventType[];

export const ENTITY_LABEL: Record<string, string> = {
  Equipment: "Equipo",
  LoanRequest: "Solicitud",
  Loan: "Préstamo",
};

/** Nombre legible de cada campo que el historial registra antes/después. */
export const FIELD_LABEL: Record<string, string> = {
  name: "Nombre",
  serialNumber: "N.º de serie",
  description: "Descripción",
  categoryId: "Categoría",
  status: "Estado",
  rejectionReason: "Motivo de rechazo",
  cancelledAt: "Cancelada el",
  actualReturnDate: "Devolución real",
  returnedLate: "Con retraso",
  daysLate: "Días de retraso",
  returnNotes: "Observaciones",
};

/** Etiqueta de un valor de estado de cualquier entidad. */
export const STATUS_VALUE_LABEL: Record<string, string> = {
  ...EQUIPMENT_STATUS_LABEL,
  ...REQUEST_STATUS_LABEL,
  ...LOAN_STATUS_LABEL,
};
