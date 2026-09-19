import type { Role } from "@/lib/types";

/**
 * Qué rol abre cada área. Los grupos de rutas `(admin)` y `(docente)` no
 * aparecen en la URL, así que el rol se deduce del primer segmento.
 * Lo usan el middleware, los guards de layout y el login.
 */
export const ROLE_ROUTES: Record<Role, string[]> = {
  ADMINISTRADOR: ["/dashboard", "/inventory", "/requests", "/loans", "/history"],
  DOCENTE: ["/equipment", "/my-requests"],
};

/** Página de inicio de cada rol después de iniciar sesión. */
export const ROLE_HOME: Record<Role, string> = {
  ADMINISTRADOR: "/dashboard",
  DOCENTE: "/my-requests",
};

export const PUBLIC_ROUTES = ["/login", "/denied"];

const matches = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isRole(value: unknown): value is Role {
  return value === "ADMINISTRADOR" || value === "DOCENTE";
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((prefix) => matches(pathname, prefix));
}

/** Rol que exige la ruta, o `null` si no pertenece a ningún área protegida. */
export function requiredRole(pathname: string): Role | null {
  for (const role of Object.keys(ROLE_ROUTES) as Role[]) {
    if (ROLE_ROUTES[role].some((prefix) => matches(pathname, prefix))) return role;
  }
  return null;
}

/**
 * Destino tras iniciar sesión: la ruta pedida si el rol puede abrirla (y es
 * una ruta interna), si no la página de inicio del rol.
 */
export function landingPath(role: Role, requested?: string | null): string {
  if (requested && requested.startsWith("/") && !requested.startsWith("//")) {
    const pathname = requested.split(/[?#]/)[0] ?? requested;
    if (requiredRole(pathname) === role) return requested;
  }
  return ROLE_HOME[role];
}
