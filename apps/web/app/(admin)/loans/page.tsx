"use client";

import { useState } from "react";
import { AlertCircle, ArrowLeftRight, CheckCircle2, FileText, Loader2, Undo2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { Pagination } from "@/components/domain/pagination";
import { ReturnLoanDialog } from "@/components/domain/return-loan-dialog";
import { OverdueBadge } from "@/components/domain/status-badges";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { dueLabel, formatDateTime, formatDay, plural } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { cn } from "@/lib/utils";
import { openVoucher } from "@/lib/voucher";
import type { Item, Loan, LoanStatus, Paginated } from "@/lib/types";

const PAGE_SIZE = 50;

const TABS: Array<{ status: LoanStatus; label: string }> = [
  { status: "ACTIVO", label: "Activos" },
  { status: "FINALIZADO", label: "Finalizados" },
];

type Notice = { tone: "success" | "error"; message: string };

export default function LoansPage() {
  const [status, setStatus] = useState<LoanStatus>("ACTIVO");
  const [page, setPage] = useState(1);
  const [returning, setReturning] = useState<Loan | null>(null);
  const [openingVoucher, setOpeningVoucher] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Activos: el que vence primero arriba, así los vencidos encabezan la lista (Req 4.5).
  const list = useResource(
    (signal) =>
      api
        .get<Paginated<Loan>>("/loans", { params: { status, page, limit: PAGE_SIZE }, signal })
        .then((response) => response.data),
    [status, page],
  );

  async function registerReturn(loan: Loan, returnNotes: string | undefined) {
    const response = await api.post<Item<Loan>>(`/loans/${loan.id}/return`, { returnNotes });
    const returned = response.data.data;
    setNotice({
      tone: "success",
      message:
        `Devolución registrada: ${returned.equipmentName} vuelve a estar disponible.` +
        (returned.returnedLate && returned.daysLate
          ? ` Quedó registrada con ${plural(returned.daysLate, "día", "días")} de retraso.`
          : ""),
    });
    if (list.data?.data.length === 1 && page > 1) setPage((current) => current - 1);
    else list.reload();
  }

  // Se regenera con los datos vigentes del préstamo, activo o finalizado (Req 6.5).
  async function showVoucher(loan: Loan) {
    setOpeningVoucher(loan.id);
    try {
      await openVoucher(loan.id);
    } catch (err) {
      setNotice({ tone: "error", message: `No se pudo generar el comprobante: ${parseApiError(err).message}` });
    } finally {
      setOpeningVoucher(null);
    }
  }

  const loans = list.data?.data ?? [];
  const overdueCount = status === "ACTIVO" ? loans.filter((loan) => loan.isOverdue).length : 0;

  return (
    <div>
      <PageHeader
        title="Préstamos"
        description={
          status === "ACTIVO"
            ? "Equipos que están fuera del inventario. Registra aquí cada devolución."
            : "Préstamos ya devueltos. Su comprobante se puede volver a generar."
        }
      />

      {notice && (
        <Alert variant={notice.tone === "success" ? "success" : "destructive"} className="mb-4 pr-12">
          {notice.tone === "success" ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{notice.message}</AlertDescription>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="absolute right-3 top-3 rounded p-1 opacity-70 hover:opacity-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </Alert>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div role="tablist" aria-label="Estado del préstamo" className="inline-flex rounded-md bg-muted p-1">
            {TABS.map((tab) => (
              <button
                key={tab.status}
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
          {overdueCount > 0 && (
            <p className="text-sm font-medium text-red-700">
              {plural(overdueCount, "préstamo vencido", "préstamos vencidos")} en esta página
            </p>
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
        ) : loans.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={status === "ACTIVO" ? "No hay préstamos activos" : "Aún no hay préstamos finalizados"}
            description={status === "ACTIVO" ? "Todos los equipos están en el inventario." : undefined}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Docente</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Devolución pactada</TableHead>
                  {status === "FINALIZADO" && <TableHead>Devuelto</TableHead>}
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={list.refreshing ? "opacity-60" : undefined}>
                {loans.map((loan) => (
                  <TableRow key={loan.id} className={cn("align-top", loan.isOverdue && "bg-red-50/50 hover:bg-red-50")}>
                    <TableCell className="whitespace-nowrap font-medium">{loan.teacherName}</TableCell>
                    <TableCell className="min-w-[10rem]">
                      <p>{loan.equipmentName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{loan.equipmentSerialNumber}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDay(loan.startDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className="tabular-nums">{formatDay(loan.agreedReturnDate)}</p>
                      {status === "ACTIVO" && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {loan.isOverdue && <OverdueBadge />}
                          <span className={cn("text-xs", loan.isOverdue ? "font-medium text-red-700" : "text-muted-foreground")}>
                            {dueLabel(loan.agreedReturnDate)}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    {status === "FINALIZADO" && (
                      <TableCell className="min-w-[11rem]">
                        <p className="tabular-nums">{loan.actualReturnDate ? formatDateTime(loan.actualReturnDate) : "—"}</p>
                        <div className="mt-1">
                          {loan.returnedLate && loan.daysLate ? (
                            <Badge variant="destructive">Con {plural(loan.daysLate, "día", "días")} de retraso</Badge>
                          ) : (
                            <Badge variant="success">A tiempo</Badge>
                          )}
                        </div>
                        {loan.returnNotes && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={loan.returnNotes}>
                            {loan.returnNotes}
                          </p>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => showVoucher(loan)}
                          disabled={openingVoucher === loan.id}
                          aria-label={`Comprobante PDF del préstamo de ${loan.equipmentName}`}
                        >
                          {openingVoucher === loan.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <FileText className="mr-1 h-4 w-4" aria-hidden />
                          )}
                          PDF
                        </Button>
                        {status === "ACTIVO" && (
                          <Button size="sm" onClick={() => setReturning(loan)}>
                            <Undo2 className="mr-1 h-4 w-4" aria-hidden />
                            Devolución
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

      <ReturnLoanDialog
        loan={returning}
        onOpenChange={(open) => !open && setReturning(null)}
        onReturn={registerReturn}
      />
    </div>
  );
}
