"use client";

import { useState, type FormEvent } from "react";
import { Filter, History, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/domain/empty-state";
import { HistoryTable } from "@/components/domain/history-table";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { Pagination } from "@/components/domain/pagination";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { EVENT_TYPES, EVENT_TYPE_LABEL } from "@/lib/labels";
import { byId, fetchAllEquipment, fetchCategories, fetchUsers } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { HistoryEvent, Paginated } from "@/lib/types";

/** Máximo 100 registros por página (Req 5.5). */
const PAGE_SIZE = 100;

interface Filters {
  eventType: string;
  startDate: string;
  endDate: string;
  equipmentId: string;
  userId: string;
}

const NO_FILTERS: Filters = { eventType: "", startDate: "", endDate: "", equipmentId: "", userId: "" };

const RANGE_MESSAGE = "La fecha de inicio no puede ser posterior a la fecha de fin.";

/** Solo los filtros con valor viajan a la API. */
const activeFilters = (filters: Filters) =>
  Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")) as Partial<Filters>;

export default function HistoryPage() {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [rangeError, setRangeError] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const lookups = useResource(
    async (signal) => {
      const [users, categories, equipment] = await Promise.all([
        fetchUsers(signal),
        fetchCategories(signal),
        fetchAllEquipment(signal),
      ]);
      return { users, equipment, byUser: byId(users), byCategory: byId(categories), byEquipment: byId(equipment) };
    },
    [],
  );

  // Todos los filtros aplicados se combinan en la misma consulta (Req 5.3).
  const history = useResource(
    (signal) =>
      api
        .get<Paginated<HistoryEvent>>("/history", {
          params: { ...activeFilters(applied), page, limit: PAGE_SIZE },
          signal,
        })
        .then((response) => response.data),
    [applied, page],
  );

  function update(field: keyof Filters, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "startDate" || field === "endDate") setRangeError(undefined);
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Se valida aquí para no enviar un rango imposible (Req 5.7).
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setRangeError(RANGE_MESSAGE);
      return;
    }
    setApplied({ ...draft });
    setPage(1);
  }

  function clear() {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
    setRangeError(undefined);
    setPage(1);
  }

  const appliedCount = Object.keys(activeFilters(applied)).length;
  const total = history.data?.meta.total;

  return (
    <div>
      <PageHeader
        title="Historial"
        description="Registro de solo lectura de todo lo que ocurre con equipos, solicitudes y préstamos."
      />

      <Card className="mb-4">
        <form onSubmit={apply} noValidate className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <FormField id="eventType" label="Tipo de evento">
            <NativeSelect value={draft.eventType} onChange={(e) => update("eventType", e.target.value)}>
              <option value="">Todos</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENT_TYPE_LABEL[type]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField id="startDate" label="Desde">
            <Input
              type="date"
              value={draft.startDate}
              max={draft.endDate || undefined}
              onChange={(e) => update("startDate", e.target.value)}
            />
          </FormField>

          <FormField id="endDate" label="Hasta" error={rangeError}>
            <Input
              type="date"
              value={draft.endDate}
              min={draft.startDate || undefined}
              onChange={(e) => update("endDate", e.target.value)}
            />
          </FormField>

          <FormField id="equipmentId" label="Equipo">
            <NativeSelect
              value={draft.equipmentId}
              onChange={(e) => update("equipmentId", e.target.value)}
              disabled={!lookups.data}
            >
              <option value="">Todos</option>
              {lookups.data?.equipment.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.serialNumber}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField id="userId" label="Usuario">
            <NativeSelect
              value={draft.userId}
              onChange={(e) => update("userId", e.target.value)}
              disabled={!lookups.data}
            >
              <option value="">Todos</option>
              {lookups.data?.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit">
              <Filter className="mr-1 h-4 w-4" aria-hidden />
              Aplicar filtros
            </Button>
            <Button type="button" variant="ghost" onClick={clear} disabled={appliedCount === 0 && draft === NO_FILTERS}>
              <RotateCcw className="mr-1 h-4 w-4" aria-hidden />
              Limpiar
            </Button>
            {appliedCount > 0 && (
              <Badge variant="secondary">
                {plural(appliedCount, "filtro activo", "filtros activos")}
              </Badge>
            )}
            {total !== undefined && (
              <span className="ml-auto text-sm text-muted-foreground">{plural(total, "evento", "eventos")}</span>
            )}
          </div>
        </form>
      </Card>

      <Card>
        {history.error || lookups.error ? (
          <div className="p-4">
            <LoadError
              error={history.error ?? lookups.error}
              onRetry={() => {
                history.reload();
                lookups.reload();
              }}
            />
          </div>
        ) : history.loading || lookups.loading || !history.data || !lookups.data ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : history.data.data.length === 0 ? (
          <EmptyState
            icon={History}
            title={appliedCount > 0 ? "Ningún evento coincide con los filtros" : "Aún no hay eventos"}
            description={appliedCount > 0 ? "Prueba ampliando el rango de fechas o quitando filtros." : undefined}
          />
        ) : (
          <>
            <div className={history.refreshing ? "opacity-60" : undefined}>
              <HistoryTable
                events={history.data.data}
                users={lookups.data.byUser}
                categories={lookups.data.byCategory}
                equipment={lookups.data.byEquipment}
              />
            </div>
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={history.data.meta.total}
              onPageChange={setPage}
              disabled={history.refreshing}
            />
          </>
        )}
      </Card>
    </div>
  );
}
