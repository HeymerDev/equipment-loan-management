"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** Primera carga, todavía sin datos. */
  loading: boolean;
  /** Recarga en curso mostrando los datos anteriores. */
  refreshing: boolean;
  reload: () => void;
}

interface State<T> {
  data: T | undefined;
  error: unknown;
  pending: boolean;
}

/**
 * Carga datos al montar y cada vez que cambian `deps`. Cancela la petición
 * anterior (AbortSignal) para que una respuesta vieja nunca pise a una nueva,
 * y conserva los datos previos durante las recargas para evitar parpadeos.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): Resource<T> {
  const [state, setState] = useState<State<T>>({ data: undefined, error: null, pending: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, error: null, pending: true }));

    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: null, pending: false });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState((previous) => ({ data: previous.data, error, pending: false }));
        }
      },
    );

    return () => controller.abort();
    // `load` se recrea en cada render; las dependencias reales son `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    data: state.data,
    error: state.error,
    loading: state.pending && state.data === undefined,
    refreshing: state.pending && state.data !== undefined,
    reload,
  };
}
