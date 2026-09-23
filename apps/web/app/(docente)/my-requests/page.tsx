"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardList, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { Pagination } from "@/components/domain/pagination";
import { RequestStatusBadge } from "@/components/domain/status-badges";
import { api } from "@/lib/api";
import { formatDateTime, formatPeriod, plural } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { cn } from "@/lib/utils";
import type { LoanRequest, LoanRequestStatus, Paginated } from "@/lib/types";

const PAGE_SIZE = 50;

const TABS: Array<{ status: LoanRequestStatus | ""; label: string }> = [
  { status: "", label: "Todas" },
  { status: "PENDIENTE", label: "Pendientes" },
  { status: "APROBADA", label: "Aprobadas" },
  { status: "RECHAZADA", label: "Rechazadas" },
  { status: "CANCELADA", label: "Canceladas" },
];

const EMPTY_TITLE: Record<LoanRequestStatus, string> = {
  PENDIENTE: "No tienes solicitudes pendientes",
  APROBADA: "No tienes solicitudes aprobadas",
  RECHAZADA: "No tienes solicitudes rechazadas",
  CANCELADA: "No tienes solicitudes canceladas",
};

// La página se prerenderiza estática: la query solo se lee en el cliente.
export default function MyRequestsPage() {
  return (
    <Suspense>
      <MyRequests />
    </Suspense>
  );
}

function MyRequests() {
  const noticeParam = useSearchParams().get("notice");
  const router = useRouter();
  const [status, setStatus] = useState<LoanRequestStatus | "">("");
  const [page, setPage] = useState(1);
  const [toCancel, setToCancel] = useState<LoanRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(
    noticeParam === "created"
      ? "Tu solicitud quedó pendiente. El administrador la revisará y aquí verás su respuesta."
      : null,
  );

  // De la más reciente a la más antigua (Req 2.8).
  const list = useResource(
    (signal) =>
      api
        .get<Paginated<LoanRequest>>("/loan-requests/my", {
          params: { status: status || undefined, page, limit: PAGE_SIZE },
          signal,
        })
        .then((response) => response.data),
    [status, page],
  );

  function dismissNotice() {
    setNotice(null);
    if (noticeParam) router.replace("/my-requests");
  }

  async function cancel(request: LoanRequest) {
    await api.patch(`/loan-requests/${request.id}/cancel`);
    setNotice(`Cancelaste la solicitud de ${request.equipmentName}.`);
    if (status === "PENDIENTE" && list.data?.data.length === 1 && page > 1) setPage((current) => current - 1);
    else list.reload();
  }

  const requests = list.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Mis solicitudes"
        description="Sigue aquí el estado de cada equipo que has pedido."
        actions={
          <Button asChild>
            <Link href="/my-requests/new">
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              Nueva solicitud
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div role="tablist" aria-label="Estado de la solicitud" className="inline-flex flex-wrap rounded-md bg-muted p-1">
            {TABS.map((tab) => (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={status === tab.status}
                onClick={() => {
                  setStatus(tab.status);
                  setPage(1);
                }}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium transition-colors",
                  status === tab.status ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {list.data && (
            <span className="text-sm text-muted-foreground">
              {plural(list.data.meta.total, "solicitud", "solicitudes")}
            </span>
          )}
        </div>

        {list.error ? (
          <div className="p-4">
            <LoadError error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading || !list.data ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={status ? EMPTY_TITLE[status] : "Aún no has solicitado ningún equipo"}
            description={status ? undefined : "Busca en el catálogo el equipo que necesitas y solicítalo."}
            action={
              !status && (
                <Button asChild variant="outline">
                  <Link href="/equipment">Ver catálogo</Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Propósito</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={list.refreshing ? "opacity-60" : undefined}>
                {requests.map((request) => (
                  <TableRow key={request.id} className="align-top">
                    <TableCell className="min-w-[9rem] font-medium">{request.equipmentName}</TableCell>
                    <TableCell className="min-w-[14rem] max-w-sm">
                      <p className="line-clamp-2" title={request.purpose}>
                        {request.purpose}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatPeriod(request.startDate, request.returnDate)}
                    </TableCell>
                    <TableCell className="min-w-[10rem]">
                      <RequestStatusBadge status={request.status} />
                      {request.status === "RECHAZADA" && request.rejectionReason && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Motivo:</span> {request.rejectionReason}
                        </p>
                      )}
                      {request.status === "CANCELADA" && request.cancelledAt && (
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {formatDateTime(request.cancelledAt)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDateTime(request.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {request.status === "PENDIENTE" && (
                          <Button size="sm" variant="outline" onClick={() => setToCancel(request)}>
                            <X className="mr-1 h-4 w-4" aria-hidden />
                            Cancelar
                          </Button>
                        )}
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
        )}
      </Card>

      <ConfirmDialog
        open={toCancel !== null}
        onOpenChange={(open) => !open && setToCancel(null)}
        title="¿Cancelar esta solicitud?"
        description={
          toCancel && (
            <>
              Retirarás tu solicitud de <strong className="text-foreground">{toCancel.equipmentName}</strong> para el{" "}
              {formatPeriod(toCancel.startDate, toCancel.returnDate)}. Si aún lo necesitas, tendrás que crear una nueva.
            </>
          )
        }
        confirmLabel="Cancelar solicitud"
        cancelLabel="Mantenerla"
        variant="destructive"
        onConfirm={() => (toCancel ? cancel(toCancel) : Promise.resolve())}
      />
    </div>
  );
}
