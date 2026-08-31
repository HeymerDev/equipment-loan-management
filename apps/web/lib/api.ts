import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { getAccessToken, setAccessToken, clearAccessToken } from "@/lib/auth";

// ─── Instancia base ───────────────────────────────────────────────────────────

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // envía cookie refreshToken en cada petición
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Request interceptor — adjunta el access token ────────────────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// ─── Lógica de reintento con renovación de token ──────────────────────────────

// Marca interna para evitar bucles de reintento infinitos
const RETRY_FLAG = "_retry";

type RetryableConfig = AxiosRequestConfig & { [RETRY_FLAG]?: boolean };

// Cola de peticiones en espera mientras se renueva el token
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

function onTokenRefreshed(newToken: string) {
  refreshQueue.forEach((resolve) => resolve(newToken));
  refreshQueue = [];
}

// ─── Response interceptor — renueva el token en 401 ─────────────────────────

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as RetryableConfig | undefined;

    // Solo intentamos renovar si es 401 y no hemos reintentado ya
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest[RETRY_FLAG]
    ) {
      return Promise.reject(error);
    }

    originalRequest[RETRY_FLAG] = true;

    // Si ya hay una renovación en curso, encolamos la petición
    if (isRefreshing) {
      return new Promise<string>((resolve) => {
        refreshQueue.push(resolve);
      }).then((newToken) => {
        if (originalRequest.headers) {
          (originalRequest.headers as Record<string, string>)[
            "Authorization"
          ] = `Bearer ${newToken}`;
        }
        return api(originalRequest);
      });
    }

    isRefreshing = true;

    try {
      // El refresh token viaja automáticamente en la cookie HttpOnly
      const { data } = await api.post<{ data: { accessToken: string } }>(
        "/auth/refresh",
      );
      const newToken = data.data.accessToken;

      setAccessToken(newToken);
      onTokenRefreshed(newToken);

      if (originalRequest.headers) {
        (originalRequest.headers as Record<string, string>)[
          "Authorization"
        ] = `Bearer ${newToken}`;
      }

      return api(originalRequest);
    } catch {
      // El refresh falló — limpiamos el token y redirigimos al login
      clearAccessToken();
      refreshQueue = [];

      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }

      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
