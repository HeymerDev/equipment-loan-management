"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Role = "ADMINISTRADOR" | "DOCENTE";

export interface DecodedUser {
  sub: string;   // userId
  email: string;
  role: Role;
  iat: number;
  exp: number;
}

// ─── Almacenamiento en memoria (módulo-level) ─────────────────────────────────
// Variable de módulo para que el cliente Axios también pueda leerla
// sin necesidad de React context (evita dependencias circulares).

let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string): void {
  _accessToken = token;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

/**
 * Decodifica el payload de un JWT sin verificar la firma.
 * La verificación real ocurre en el servidor (API Express).
 */
export function decodeToken(token: string): DecodedUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    // Convierte de base64url a base64 estándar y añade padding
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded);
    return JSON.parse(json) as DecodedUser;
  } catch {
    return null;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  accessToken: string | null;
  user: DecodedUser | null;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [accessToken, setToken] = useState<string | null>(null);

  const login = useCallback((token: string) => {
    setAccessToken(token);   // actualiza variable de módulo para Axios
    setToken(token);         // actualiza estado de React para re-renders
  }, []);

  const logout = useCallback(() => {
    clearAccessToken();
    setToken(null);
  }, []);

  const user = accessToken ? decodeToken(accessToken) : null;

  return (
    <AuthContext.Provider value={{ accessToken, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}
