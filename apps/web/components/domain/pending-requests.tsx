"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LoanRequest, Paginated } from "@/lib/types";

/** Cada 30 s: una solicitud nueva llega al administrador en menos de 60 s (Req 2.6, 3.5). */
export const POLL_INTERVAL_MS = 30_000;

interface PendingRequestsValue {
  /** Solicitudes en estado PENDIENTE; `null` hasta la primera respuesta. */
  count: number | null;
  /** Consulta de inmediato, p. ej. tras aprobar o rechazar. */
  refresh: () => void;
}

const PendingRequestsContext = createContext<PendingRequestsValue>({
  count: null,
  refresh: () => undefined,
});

/**
 * Consulta periódicamente cuántas solicitudes esperan revisión. Pausa mientras
 * la pestaña está oculta y consulta en cuanto vuelve a verse.
 */
export function PendingRequestsProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState<number | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      const response = await api.get<Paginated<LoanRequest>>("/loan-requests", {
        params: { status: "PENDIENTE", limit: 1 },
      });
      setCount(response.data.meta.total);
    } catch {
      // Se conserva el último valor conocido; la próxima consulta reintenta.
    }
  }, []);

  useEffect(() => {
    void fetchCount();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchCount();
    }, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void fetchCount();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchCount]);

  const value = useMemo(
    () => ({ count, refresh: () => void fetchCount() }),
    [count, fetchCount],
  );

  return <PendingRequestsContext.Provider value={value}>{children}</PendingRequestsContext.Provider>;
}

export function usePendingRequests(): PendingRequestsValue {
  return useContext(PendingRequestsContext);
}

/** Contador para la navegación; no se muestra cuando no hay pendientes. */
export function PendingRequestsBadge({ className }: { className?: string }) {
  const { count } = usePendingRequests();
  if (!count) return null;

  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold tabular-nums text-white",
        className,
      )}
      aria-label={`${count} ${count === 1 ? "solicitud pendiente" : "solicitudes pendientes"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
