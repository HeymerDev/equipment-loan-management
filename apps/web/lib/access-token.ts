/**
 * The access token lives only in memory (never in localStorage) — Req 7.
 *
 * It is kept at module level so the Axios client can read it without React,
 * and it notifies subscribers so the AuthProvider re-renders whenever the
 * token is issued, renewed by the interceptor, or cleared.
 */

type Listener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function subscribeAccessToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
