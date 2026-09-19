import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/access-token";
import type { Item } from "@/lib/types";

// ─── Instancia base ───────────────────────────────────────────────────────────

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // envía la cookie refreshToken
  headers: { "Content-Type": "application/json" },
});

// ─── Request interceptor — adjunta el access token ────────────────────────────

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

// ─── Renovación del access token ──────────────────────────────────────────────

/**
 * Endpoints del propio flujo de autenticación: un 401 en ellos es la respuesta
 * definitiva (credenciales incorrectas, sesión vencida) y nunca debe disparar
 * otra renovación — de lo contrario la petición quedaría esperando para siempre.
 */
const AUTH_ENDPOINTS = ["/auth/login", "/auth/refresh", "/auth/logout"];

const isAuthEndpoint = (url?: string): boolean =>
  url !== undefined && AUTH_ENDPOINTS.some((endpoint) => url.endsWith(endpoint));

let refreshInFlight: Promise<string> | null = null;

/**
 * Pide un access token nuevo con la cookie HttpOnly del refresh token.
 * Las peticiones que fallan a la vez comparten una sola renovación.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post<Item<{ accessToken: string }>>("/auth/refresh")
      .then((response) => {
        const token = response.data.data.accessToken;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// ─── Response interceptor — renueva el token en 401 y reintenta una vez ───────

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error;

    const config = error.config as RetriableConfig | undefined;
    if (!config || config._retried || isAuthEndpoint(config.url)) throw error;
    config._retried = true;

    try {
      const token = await refreshAccessToken();
      config.headers.set("Authorization", `Bearer ${token}`);
      return await api(config);
    } catch {
      // La sesión terminó: el AuthProvider lo detecta y los guards de ruta
      // llevan al usuario al login.
      clearAccessToken();
      throw error;
    }
  },
);

export default api;
