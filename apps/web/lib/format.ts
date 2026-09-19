/**
 * Formatos de fecha de la interfaz.
 *
 * Los días de solicitudes y préstamos son días calendario guardados a la
 * medianoche UTC, y la API valida "hoy" en UTC: todo lo que es un día se lee
 * en UTC para que la interfaz y la API coincidan. Los instantes exactos
 * (creación, devolución real, historial) se muestran en la hora local.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (value: number): string => String(value).padStart(2, "0");

/** DD/MM/YYYY de un día calendario. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** DD/MM/YYYY HH:MM de un instante, en la hora local. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** "15/09/2026 – 17/09/2026" */
export function formatPeriod(startIso: string, endIso: string): string {
  return `${formatDay(startIso)} – ${formatDay(endIso)}`;
}

/** Hoy como YYYY-MM-DD en UTC — el calendario con el que valida la API. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Suma días a un día YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Días calendario desde hoy hasta la fecha (negativo si ya pasó). */
export function daysFromToday(iso: string): number {
  const target = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayUtc()}T00:00:00Z`);
  return Math.round((target - today) / DAY_MS);
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "Vence hoy", "Vence en 3 días", "Venció hace 2 días"… */
export function dueLabel(agreedReturnIso: string): string {
  const days = daysFromToday(agreedReturnIso);
  if (days < 0) return `Venció hace ${plural(-days, "día", "días")}`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} días`;
}
