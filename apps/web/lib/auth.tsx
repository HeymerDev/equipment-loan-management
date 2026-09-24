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
import { api, refreshAccessToken } from "@/lib/api";
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
  subscribeAccessToken,
} from "@/lib/access-token";
import { isRole } from "@/lib/routes";
import type { Item, Role } from "@/lib/types";

// ─── Sesión ───────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  /** La cuenta sigue con la contraseña temporal del administrador. */
  mustChangePassword: boolean;
}

/**
 * - `loading`: comprobando si la cookie de sesión sigue viva.
 * - `authenticated`: hay un access token en memoria.
 * - `unauthenticated`: no hay sesión, o expiró.
 * - `signed-out`: el usuario cerró sesión a propósito.
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "signed-out";

/** Lee el payload del JWT sin verificar la firma (eso lo hace la API). */
export function decodeSession(token: string): SessionUser | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const claims = JSON.parse(atob(padded)) as {
      sub?: unknown;
      email?: unknown;
      role?: unknown;
      mustChangePassword?: unknown;
    };
    if (typeof claims.sub !== "string" || typeof claims.email !== "string" || !isRole(claims.role)) {
      return null;
    }
    return {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      mustChangePassword: claims.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** Inicia sesión y devuelve el usuario; rechaza con el error de la API. */
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [status, setStatus] = useState<AuthStatus>(() =>
    getAccessToken() ? "authenticated" : "loading",
  );

  // Sigue al token: lo emite el login, lo renueva el interceptor, lo borra el logout.
  useEffect(
    () =>
      subscribeAccessToken((next) => {
        setToken(next);
        setStatus(next ? "authenticated" : "unauthenticated");
      }),
    [],
  );

  // Al cargar la app el token en memoria se perdió: si la cookie HttpOnly sigue
  // viva, la sesión se restaura sin volver a pedir credenciales.
  useEffect(() => {
    if (getAccessToken()) return;
    let active = true;
    refreshAccessToken().catch(() => {
      if (active) setStatus("unauthenticated");
    });
    return () => {
      active = false;
    };
  }, []);

  const user = useMemo(() => (token ? decodeSession(token) : null), [token]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post<Item<{ accessToken: string }>>("/auth/login", {
      email,
      password,
    });
    const accessToken = response.data.data.accessToken;
    const session = decodeSession(accessToken);
    if (!session) throw new Error("La sesión recibida no es válida");
    setAccessToken(accessToken);
    return session;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // La sesión local termina igual aunque la API no responda.
    }
    clearAccessToken();
    setStatus("signed-out");
  }, []);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return context;
}
