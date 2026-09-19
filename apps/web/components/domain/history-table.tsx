import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ENTITY_LABEL, EVENT_TYPE_LABEL, FIELD_LABEL, STATUS_VALUE_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, ChangedField, Equipment, EventType, HistoryEvent, UserSummary } from "@/lib/types";

const EVENT_TONE: Partial<Record<EventType, string>> = {
  EQUIPMENT_DELETED: "text-red-700",
  REQUEST_REJECTED: "text-red-700",
  REQUEST_CANCELLED: "text-slate-600",
  REQUEST_APPROVED: "text-emerald-700",
  LOAN_STARTED: "text-sky-700",
  LOAN_RETURNED: "text-emerald-700",
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_VALUE_LENGTH = 120;

function formatValue(field: string, value: unknown, categories: Map<string, Category>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string") {
    if (field === "categoryId") return categories.get(value)?.name ?? value;
    if (field === "status") return STATUS_VALUE_LABEL[value] ?? value;
    if (ISO_INSTANT.test(value)) return formatDateTime(value);
    return value;
  }
  return String(value);
}

function Change({ change, categories }: { change: ChangedField; categories: Map<string, Category> }) {
  const before = formatValue(change.field, change.before, categories);
  const after = formatValue(change.field, change.after, categories);
  const clip = (text: string) =>
    text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;

  return (
    <li className="break-words">
      <span className="font-medium">{FIELD_LABEL[change.field] ?? change.field}:</span>{" "}
      {before !== "—" && (
        <>
          <span className="text-muted-foreground line-through decoration-muted-foreground/50" title={before}>
            {clip(before)}
          </span>{" "}
          →{" "}
        </>
      )}
      <span title={after}>{clip(after)}</span>
    </li>
  );
}

interface HistoryTableProps {
  events: HistoryEvent[];
  users: Map<string, UserSummary>;
  categories: Map<string, Category>;
  /** Columna de equipo, para el historial global. */
  equipment?: Map<string, Equipment>;
}

/** Tabla de eventos del historial, con los valores antes/después de cada cambio (Req 5.2). */
export function HistoryTable({ events, users, categories, equipment }: HistoryTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha y hora</TableHead>
          <TableHead>Evento</TableHead>
          {equipment && <TableHead>Equipo</TableHead>}
          <TableHead>Realizado por</TableHead>
          <TableHead>Cambios</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => {
          const author = users.get(event.userId);
          const item = event.equipmentId ? equipment?.get(event.equipmentId) : undefined;
          return (
            <TableRow key={event.id} className="align-top">
              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                {formatDateTime(event.occurredAt)}
              </TableCell>
              <TableCell className="min-w-[10rem]">
                <p className={cn("font-medium", EVENT_TONE[event.eventType])}>
                  {EVENT_TYPE_LABEL[event.eventType]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ENTITY_LABEL[event.entityTable] ?? event.entityTable}
                </p>
              </TableCell>
              {equipment && (
                <TableCell className="min-w-[10rem]">
                  {item ? (
                    <Link href={`/inventory/${item.id}/history`} className="hover:underline">
                      {item.name}
                    </Link>
                  ) : event.equipmentId ? (
                    <span className="text-muted-foreground">Retirado del inventario</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}
              <TableCell className="min-w-[10rem]">
                {author ? (
                  <>
                    <p>{author.fullName}</p>
                    <p className="text-xs text-muted-foreground">{author.email}</p>
                  </>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">{event.userId}</span>
                )}
              </TableCell>
              <TableCell className="min-w-[16rem] text-sm">
                {event.changedFields?.length ? (
                  <ul className="space-y-1">
                    {event.changedFields.map((change) => (
                      <Change key={change.field} change={change} categories={categories} />
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
