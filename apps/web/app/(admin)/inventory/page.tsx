"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, History, Laptop, Pencil, Plus, Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { Pagination } from "@/components/domain/pagination";
import { EquipmentStatusBadge } from "@/components/domain/status-badges";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Equipment, EquipmentStatus, Paginated } from "@/lib/types";

/** Máximo 50 equipos por página (Req 1.5). */
const PAGE_SIZE = 50;

interface InventoryPageProps {
  searchParams: { notice?: string | string[] };
}

export default function InventoryPage({ searchParams }: InventoryPageProps) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<EquipmentStatus | "">("");
  const [notice, setNotice] = useState<string | null>(
    searchParams.notice === "created" ? "El equipo quedó registrado como disponible." : null,
  );
  const [toDelete, setToDelete] = useState<Equipment | null>(null);

  const list = useResource(
    (signal) =>
      api
        .get<Paginated<Equipment>>("/equipment", {
          params: { page, limit: PAGE_SIZE, status: status || undefined },
          signal,
        })
        .then((response) => response.data),
    [page, status],
  );

  function dismissNotice() {
    setNotice(null);
    if (searchParams.notice) router.replace("/inventory");
  }

  async function remove(equipment: Equipment) {
    await api.delete(`/equipment/${equipment.id}`);
    setNotice(`«${equipment.name}» se retiró del inventario. Su historial se conserva.`);
    // Si era el último de la página, vuelve a la anterior.
    if (list.data?.data.length === 1 && page > 1) setPage((current) => current - 1);
    else list.reload();
  }

  const total = list.data?.meta.total;

  return (
    <div>
      <PageHeader
        title="Inventario"
        description={
          total === undefined
            ? "Equipos registrados en la institución."
            : `${plural(total, "equipo", "equipos")}${status ? ` con estado ${status === "DISPONIBLE" ? "disponible" : "prestado"}` : " en el inventario"}.`
        }
        actions={
          <Button asChild>
            <Link href="/inventory/new">
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              Registrar equipo
            </Link>
          </Button>
        }
      />

      {notice && (
        <Alert variant="success" className="mb-4 pr-12">
          <CheckCircle2 aria-hidden />
          <AlertDescription>{notice}</AlertDescription>
          <button
            type="button"
            onClick={dismissNotice}
            className="absolute right-3 top-3 rounded p-1 text-emerald-700 hover:bg-emerald-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </Alert>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <label htmlFor="status-filter" className="text-sm text-muted-foreground">
            Estado
          </label>
          <div className="w-44">
            <NativeSelect
              id="status-filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as EquipmentStatus | "");
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="DISPONIBLE">Disponibles</option>
              <option value="PRESTADO">Prestados</option>
            </NativeSelect>
          </div>
        </div>

        {list.error ? (
          <div className="p-4">
            <LoadError error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading ? (
          <TableSkeleton />
        ) : list.data && list.data.data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>N.º de serie</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={list.refreshing ? "opacity-60" : undefined}>
                {list.data.data.map((equipment) => (
                  <TableRow key={equipment.id}>
                    <TableCell className="max-w-xs">
                      <Link href={`/inventory/${equipment.id}`} className="font-medium hover:underline">
                        {equipment.name}
                      </Link>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{equipment.description}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{equipment.categoryName}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{equipment.serialNumber}</TableCell>
                    <TableCell>
                      <EquipmentStatusBadge status={equipment.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" title="Editar">
                          <Link href={`/inventory/${equipment.id}`} aria-label={`Editar ${equipment.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon" title="Historial">
                          <Link
                            href={`/inventory/${equipment.id}/history`}
                            aria-label={`Historial de ${equipment.name}`}
                          >
                            <History className="h-4 w-4" aria-hidden />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setToDelete(equipment)}
                          disabled={equipment.status === "PRESTADO"}
                          title={
                            equipment.status === "PRESTADO"
                              ? "No se puede eliminar: tiene un préstamo activo"
                              : "Eliminar"
                          }
                          aria-label={`Eliminar ${equipment.name}`}
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={list.data.meta.total}
              onPageChange={setPage}
              disabled={list.refreshing}
            />
          </>
        ) : (
          <EmptyState
            icon={Laptop}
            title={status ? "No hay equipos con ese estado" : "Aún no hay equipos registrados"}
            description={status ? "Prueba con otro filtro." : "Registra el primer equipo para empezar a prestarlo."}
            action={
              !status && (
                <Button asChild>
                  <Link href="/inventory/new">
                    <Plus className="mr-1 h-4 w-4" aria-hidden />
                    Registrar equipo
                  </Link>
                </Button>
              )
            }
          />
        )}
      </Card>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="¿Eliminar este equipo del inventario?"
        description={
          toDelete && (
            <>
              <strong className="text-foreground">{toDelete.name}</strong> ({toDelete.serialNumber}) dejará de
              aparecer en el inventario y no podrá solicitarse. Su historial se conserva.
            </>
          )
        }
        confirmLabel="Eliminar equipo"
        variant="destructive"
        onConfirm={() => (toDelete ? remove(toDelete) : Promise.resolve())}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-10 w-full" />
      ))}
    </div>
  );
}
