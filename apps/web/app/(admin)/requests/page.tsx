"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, CheckCircle2, FileText, Inbox, Info, Loader2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { Pagination } from "@/components/domain/pagination";
import { usePendingRequests } from "@/components/domain/pending-requests";
import { RejectRequestDialog } from "@/components/domain/reject-request-dialog";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { formatDateTime, formatPeriod, plural } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { openVoucher } from "@/lib/voucher";
import type { ApproveResult, Item, LoanRequest, Paginated } from "@/lib/types";

const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

type Outcome =
  | { kind: "approved"; result: ApproveResult; warning?: string }
  | { kind: "rejected"; request: LoanRequest };

/** Días del período, contando el de inicio y el de devolución. */
const periodDays = (request: LoanRequest) =>
  Math.round((Date.parse(request.returnDate) - Date.parse(request.startDate)) / DAY_MS) + 1;

export default function RequestsPage() {
  const { count, refresh: refreshPending } = usePendingRequests();
  const [page, setPage] = useState(1);
  const [approving, setApproving] = useState<LoanRequest | null>(null);
  const [rejecting, setRejecting] = useState<LoanRequest | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [voucher, setVoucher] = useState<{ opening: boolean; error: string | null }>({ opening: false, error: null });

  // Pendientes, de la más antigua a la más reciente (Req 3.1).
  const list = useResource(
    (signal) =>
      api
        .get<Paginated<LoanRequest>>("/loan-requests", {
          params: { status: "PENDIENTE", page, limit: PAGE_SIZE },
          signal,
        })
        .then((response) => response.data),
    [page],
  );

  // Cuando la consulta periódica detecta solicitudes nuevas, la cola se actualiza sola.
  const { reload } = list;
  const lastCount = useRef(count);
  useEffect(() => {
    if (lastCount.current !== null && count !== lastCount.current) reload();
    lastCount.current = count;
  }, [count, reload]);

  function afterDecision() {
    if (list.data?.data.length === 1 && page > 1) setPage((current) => current - 1);
    else reload();
    refreshPending();
  }

  async function approve(request: LoanRequest) {
    // 200 con comprobante, o 207 si el PDF falló pero el préstamo se creó (Req 3.7).
    const response = await api.post<Item<ApproveResult> & { warning?: string }>(
      `/loan-requests/${request.id}/approve`,
    );
    setVoucher({ opening: false, error: null });
    setOutcome({ kind: "approved", result: response.data.data, warning: response.data.warning });
    afterDecision();
  }

  async function reject(request: LoanRequest, rejectionReason: string) {
    const response = await api.post<Item<LoanRequest>>(`/loan-requests/${request.id}/reject`, {
      rejectionReason,
    });
    setOutcome({ kind: "rejected", request: response.data.data });
    afterDecision();
  }

  async function showVoucher(loanId: string) {
    setVoucher({ opening: true, error: null });
    try {
      await openVoucher(loanId);
      setVoucher({ opening: false, error: null });
    } catch (err) {
      setVoucher({ opening: false, error: parseApiError(err).message });
    }
  }

  return (
    <div>
      <PageHeader
        title="Solicitudes pendientes"
        description="Revísalas en el orden en que llegaron. La lista se actualiza sola cada 30 segundos."
      />

      {outcome && (
        <OutcomeAlert
          outcome={outcome}
          voucher={voucher}
          onShowVoucher={showVoucher}
          onDismiss={() => setOutcome(null)}
        />
      )}

      <Card>
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
        ) : list.data.data.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No hay solicitudes pendientes"
            description="Cuando un docente solicite un equipo aparecerá aquí."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Solicitada</TableHead>
                  <TableHead>Docente</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Propósito</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Decisión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={list.refreshing ? "opacity-60" : undefined}>
                {list.data.data.map((request) => (
                  <TableRow key={request.id} className="align-top">
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDateTime(request.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{request.teacherName}</TableCell>
                    <TableCell className="min-w-[9rem]">{request.equipmentName}</TableCell>
                    <TableCell className="min-w-[14rem] max-w-sm">
                      <p className="line-clamp-2" title={request.purpose}>
                        {request.purpose}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className="tabular-nums">{formatPeriod(request.startDate, request.returnDate)}</p>
                      <p className="text-xs text-muted-foreground">{plural(periodDays(request), "día", "días")}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setApproving(request)}>
                          <Check className="mr-1 h-4 w-4" aria-hidden />
                          Aprobar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejecting(request)}>
                          <X className="mr-1 h-4 w-4" aria-hidden />
                          Rechazar
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
        )}
      </Card>

      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(open) => !open && setApproving(null)}
        title="¿Aprobar esta solicitud?"
        description={
          approving && (
            <>
              <strong className="text-foreground">{approving.equipmentName}</strong> quedará prestado a{" "}
              {approving.teacherName} del {formatPeriod(approving.startDate, approving.returnDate)} y se
              generará el comprobante.
            </>
          )
        }
        confirmLabel="Aprobar y crear préstamo"
        onConfirm={() => (approving ? approve(approving) : Promise.resolve())}
      >
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            Las demás solicitudes pendientes de este equipo que coincidan con estas fechas se cancelarán
            automáticamente.
          </AlertDescription>
        </Alert>
      </ConfirmDialog>

      <RejectRequestDialog
        request={rejecting}
        onOpenChange={(open) => !open && setRejecting(null)}
        onReject={reject}
      />
    </div>
  );
}

function OutcomeAlert({
  outcome,
  voucher,
  onShowVoucher,
  onDismiss,
}: {
  outcome: Outcome;
  voucher: { opening: boolean; error: string | null };
  onShowVoucher: (loanId: string) => void;
  onDismiss: () => void;
}) {
  const dismiss = (
    <button
      type="button"
      onClick={onDismiss}
      className="absolute right-3 top-3 rounded p-1 opacity-70 hover:opacity-100"
      aria-label="Cerrar aviso"
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );

  if (outcome.kind === "rejected") {
    return (
      <Alert variant="info" className="mb-4 pr-12">
        <Info aria-hidden />
        <AlertTitle>Solicitud rechazada</AlertTitle>
        <AlertDescription>
          {outcome.request.teacherName} verá el motivo en su lista de solicitudes.
        </AlertDescription>
        {dismiss}
      </Alert>
    );
  }

  const { result, warning } = outcome;
  const { request } = result;
  const cancelled = result.autoCancelledRequestIds.length;

  return (
    <Alert variant={result.pdfGenerated ? "success" : "warning"} className="mb-4 pr-12">
      {result.pdfGenerated ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}
      <AlertTitle>{result.pdfGenerated ? "Préstamo aprobado" : "Préstamo aprobado, sin comprobante"}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {request.equipmentName} queda prestado a {request.teacherName} del{" "}
          {formatPeriod(result.loan.startDate, result.loan.agreedReturnDate)}.
          {cancelled > 0 &&
            ` Se cancelaron automáticamente ${plural(cancelled, "solicitud pendiente que coincidía", "solicitudes pendientes que coincidían")} con estas fechas.`}
        </p>
        {!result.pdfGenerated && <p>{warning ?? "El comprobante PDF no pudo generarse."} Puedes intentarlo de nuevo.</p>}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onShowVoucher(result.loan.id)}
          disabled={voucher.opening}
          className="bg-background"
        >
          {voucher.opening ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileText className="mr-2 h-4 w-4" aria-hidden />
          )}
          {result.pdfGenerated ? "Ver comprobante PDF" : "Generar comprobante"}
        </Button>
        {voucher.error && (
          <p className="flex items-center gap-1.5 text-destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {voucher.error}
          </p>
        )}
      </AlertDescription>
      {dismiss}
    </Alert>
  );
}
