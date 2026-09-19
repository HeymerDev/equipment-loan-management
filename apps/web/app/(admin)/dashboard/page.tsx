"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CalendarClock,
  Inbox,
  Laptop,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { OverdueBadge } from "@/components/domain/status-badges";
import { usePendingRequests } from "@/components/domain/pending-requests";
import { api } from "@/lib/api";
import { dueLabel, formatDateTime, formatPeriod, plural } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { cn } from "@/lib/utils";
import type { Equipment, Loan, LoanRequest, Paginated } from "@/lib/types";

/** Todos los préstamos activos (100 por página, como máximo 10 páginas). */
async function fetchActiveLoans(signal: AbortSignal): Promise<Loan[]> {
  const loans: Loan[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await api.get<Paginated<Loan>>("/loans", {
      params: { status: "ACTIVO", page, limit: 100 },
      signal,
    });
    loans.push(...response.data.data);
    if (loans.length >= response.data.meta.total || response.data.data.length === 0) break;
  }
  return loans;
}

async function fetchInventory(signal: AbortSignal): Promise<{ total: number; available: number }> {
  const [all, available] = await Promise.all([
    api.get<Paginated<Equipment>>("/equipment", { params: { limit: 1 }, signal }),
    api.get<Paginated<Equipment>>("/equipment", { params: { limit: 1, status: "DISPONIBLE" }, signal }),
  ]);
  return { total: all.data.meta.total, available: available.data.meta.total };
}

export default function DashboardPage() {
  const { count: pendingCount } = usePendingRequests();

  const pending = useResource(
    (signal) =>
      api
        .get<Paginated<LoanRequest>>("/loan-requests", { params: { status: "PENDIENTE", limit: 5 }, signal })
        .then((response) => response.data),
    [],
  );
  const loans = useResource(fetchActiveLoans, []);
  const inventory = useResource(fetchInventory, []);

  // Cuando la consulta periódica detecta cambios en las pendientes, el panel se
  // actualiza sin recargar la página.
  const { reload: reloadPending } = pending;
  const { reload: reloadLoans } = loans;
  const { reload: reloadInventory } = inventory;
  const lastCount = useRef(pendingCount);
  useEffect(() => {
    if (lastCount.current !== null && pendingCount !== lastCount.current) {
      reloadPending();
      reloadLoans();
      reloadInventory();
    }
    lastCount.current = pendingCount;
  }, [pendingCount, reloadPending, reloadLoans, reloadInventory]);

  const overdue = loans.data?.filter((loan) => loan.isOverdue) ?? [];
  const upcoming = loans.data?.slice(0, 5) ?? [];

  return (
    <div>
      <PageHeader title="Panel" description="Lo que necesita atención hoy." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Inbox}
          label="Solicitudes pendientes"
          value={pending.data?.meta.total}
          detail="Esperando revisión"
          href="/requests"
          tone={pending.data && pending.data.meta.total > 0 ? "warning" : "default"}
        />
        <StatCard
          icon={ArrowLeftRight}
          label="Préstamos activos"
          value={loans.data?.length}
          detail="Equipos fuera del inventario"
          href="/loans"
        />
        <StatCard
          icon={AlertTriangle}
          label="Préstamos vencidos"
          value={loans.data ? overdue.length : undefined}
          detail="Pasaron su día de devolución"
          href="/loans"
          tone={overdue.length > 0 ? "danger" : "default"}
        />
        <StatCard
          icon={Laptop}
          label="Equipos disponibles"
          value={inventory.data?.available}
          detail={inventory.data ? `De ${plural(inventory.data.total, "equipo", "equipos")} en inventario` : " "}
          href="/inventory"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Solicitudes por revisar</CardTitle>
              <CardDescription>Las más antiguas primero.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/requests">
                Ver todas <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {pending.error ? (
              <LoadError error={pending.error} onRetry={pending.reload} />
            ) : pending.loading ? (
              <ListSkeleton />
            ) : pending.data?.data.length ? (
              <ul className="divide-y">
                {pending.data.data.map((request) => (
                  <li key={request.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium">{request.equipmentName}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {request.teacherName} · {formatPeriod(request.startDate, request.returnDate)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(request.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Inbox} title="Todo al día" description="No hay solicitudes esperando revisión." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Próximas devoluciones</CardTitle>
              <CardDescription>Préstamos activos por fecha pactada.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/loans">
                Ver préstamos <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loans.error ? (
              <LoadError error={loans.error} onRetry={loans.reload} />
            ) : loans.loading ? (
              <ListSkeleton />
            ) : upcoming.length ? (
              <ul className="divide-y">
                {upcoming.map((loan) => (
                  <li key={loan.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium">{loan.equipmentName}</p>
                      <p className="truncate text-sm text-muted-foreground">{loan.teacherName}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {loan.isOverdue && <OverdueBadge />}
                      <span className={cn("text-xs", loan.isOverdue ? "font-medium text-red-700" : "text-muted-foreground")}>
                        {dueLabel(loan.agreedReturnDate)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CalendarClock} title="Sin préstamos activos" description="Todos los equipos están en el inventario." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  href,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  detail: ReactNode;
  href: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Link href={href} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card
        className={cn(
          "h-full transition-colors group-hover:border-foreground/20",
          tone === "warning" && "border-amber-300 bg-amber-50/60",
          tone === "danger" && "border-red-300 bg-red-50/60",
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            {label}
            <Icon
              className={cn(
                "h-4 w-4",
                tone === "warning" && "text-amber-600",
                tone === "danger" && "text-red-600",
              )}
              aria-hidden
            />
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">
            {value === undefined ? <Skeleton className="h-9 w-12" /> : value}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4 py-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
