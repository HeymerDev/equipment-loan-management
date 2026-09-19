"use client";

import { useState } from "react";
import { History, SearchX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/domain/back-link";
import { EmptyState } from "@/components/domain/empty-state";
import { HistoryTable } from "@/components/domain/history-table";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { Pagination } from "@/components/domain/pagination";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { byId, fetchCategories, fetchUsers } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { Equipment, HistoryEvent, Item, Paginated } from "@/lib/types";

/** Máximo 100 registros por página (Req 5.6). */
const PAGE_SIZE = 100;

export default function EquipmentHistoryPage({ params }: { params: { id: string } }) {
  const [page, setPage] = useState(1);

  const lookups = useResource(
    async (signal) => {
      const [users, categories] = await Promise.all([fetchUsers(signal), fetchCategories(signal)]);
      return { users: byId(users), categories: byId(categories) };
    },
    [],
  );

  // `null` = el equipo fue eliminado (soft delete): su historial sigue disponible.
  const equipment = useResource(
    (signal) =>
      api
        .get<Item<Equipment>>(`/equipment/${params.id}`, { signal })
        .then((response): Equipment | null => response.data.data)
        .catch((error: unknown) => {
          if (parseApiError(error).status === 404) return null;
          throw error;
        }),
    [params.id],
  );

  const history = useResource(
    (signal) =>
      api
        .get<Paginated<HistoryEvent>>(`/equipment/${params.id}/history`, {
          params: { page, limit: PAGE_SIZE },
          signal,
        })
        .then((response) => response.data),
    [params.id, page],
  );

  const back = <BackLink href="/inventory">Inventario</BackLink>;
  const name = equipment.data?.name;

  if (history.error && parseApiError(history.error).status === 404) {
    return (
      <div>
        <PageHeader back={back} title="Equipo no encontrado" />
        <Card>
          <EmptyState icon={SearchX} title="No existe ningún equipo con este identificador" />
        </Card>
      </div>
    );
  }

  const error = history.error ?? lookups.error ?? equipment.error;

  return (
    <div>
      <PageHeader
        back={back}
        title={name ? `Historial de ${name}` : "Historial del equipo"}
        description={
          equipment.data === null
            ? "Este equipo fue eliminado del inventario; su historial se conserva."
            : "Todos los eventos del equipo, del más reciente al más antiguo."
        }
      />

      <Card>
        {error ? (
          <div className="p-4">
            <LoadError
              error={error}
              onRetry={() => {
                history.reload();
                lookups.reload();
                equipment.reload();
              }}
            />
          </div>
        ) : history.loading || lookups.loading || !history.data || !lookups.data ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : history.data.data.length === 0 ? (
          <EmptyState icon={History} title="Sin eventos registrados" />
        ) : (
          <>
            <div className={history.refreshing ? "opacity-60" : undefined}>
              <HistoryTable
                events={history.data.data}
                users={lookups.data.users}
                categories={lookups.data.categories}
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
