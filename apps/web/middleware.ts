import { NextResponse, type NextRequest } from "next/server";
import { ROLE_HOME, isPublicRoute, isRole, requiredRole } from "@/lib/routes";

/** Cookie HttpOnly con el refresh token que emite la API al iniciar sesión. */
const SESSION_COOKIE = "refreshToken";

interface SessionClaims {
  role?: unknown;
  exp?: unknown;
}

/**
 * Lee el payload del refresh token sin verificar la firma. El middleware solo
 * decide a qué pantalla va cada quien; la autorización real la hace la API en
 * cada petición, así que una cookie manipulada no da acceso a ningún dato.
 */
function readClaims(token: string): SessionClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as SessionClaims;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicRoute(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? readClaims(token) : null;
  const expired = typeof claims?.exp === "number" && claims.exp * 1000 <= Date.now();

  // Sin sesión: al login, recordando a dónde se quería ir (Req 7.1, 7.8).
  if (!claims || expired) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("redirect", `${pathname}${search}`);
    const response = NextResponse.redirect(login);
    if (token) response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // Sesiones anteriores a que el token llevara el rol: los guards de cada
  // layout completan la verificación con el access token.
  const role = isRole(claims.role) ? claims.role : null;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(role ? ROLE_HOME[role] : "/login", request.url));
  }

  // Área de otro rol: pantalla de acceso denegado (Req 7.2, 7.3).
  const needed = requiredRole(pathname);
  if (needed && role && role !== needed) {
    return NextResponse.redirect(new URL("/denied", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Todo excepto los archivos estáticos de Next y las imágenes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
