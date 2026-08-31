import { type NextRequest, NextResponse } from "next/server";

// ─── Rutas públicas (no requieren autenticación) ─────────────────────────────

const PUBLIC_PATHS = ["/login", "/denied"];

// ─── Requisitos de rol por prefijo de ruta ────────────────────────────────────

const ROLE_REQUIREMENTS: Array<{ prefix: string; role: string }> = [
  { prefix: "/admin", role: "ADMINISTRADOR" },
  { prefix: "/docente", role: "DOCENTE" },
];

// ─── Decodificación de JWT (solo payload, sin verificar firma) ────────────────
// Se hace en el Edge Runtime con base64 puro — sin librerías de Node.
// La verificación criptográfica real ocurre en el API (Express).

interface JwtPayload {
  sub?: string;
  role?: string;
  exp?: number;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;

    // Convierte de base64url a base64 estándar
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    // Decodifica en el Edge Runtime
    const decoded = atob(base64);
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

function isTokenExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  // exp está en segundos
  return Date.now() / 1000 > payload.exp;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Permite rutas públicas sin autenticación
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Verifica la presencia del refresh token en la cookie
  // La existencia de esta cookie indica una sesión potencialmente activa.
  // El access token real vive solo en memoria del cliente, no en cookies.
  const refreshToken = request.cookies.get("refreshToken")?.value;

  if (!refreshToken) {
    // Requisito 7.1 y 7.8: redirigir a login si no hay sesión
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Decodifica el refresh token para obtener el rol
  // Nota: el refresh token también es un JWT firmado por el servidor
  const payload = decodeJwtPayload(refreshToken);

  if (!payload || isTokenExpired(payload)) {
    // Token inválido o expirado
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    const response = NextResponse.redirect(loginUrl);
    // Limpia la cookie inválida
    response.cookies.delete("refreshToken");
    return response;
  }

  const userRole = payload.role ?? "";

  // Verifica que el rol coincida con la ruta solicitada
  for (const { prefix, role } of ROLE_REQUIREMENTS) {
    if (pathname.startsWith(prefix) && userRole !== role) {
      // Requisito 7.2 y 7.3: redirigir a /denied si el rol no coincide
      return NextResponse.redirect(new URL("/denied", request.url));
    }
  }

  return NextResponse.next();
}

// ─── Configuración del matcher ────────────────────────────────────────────────

export const config = {
  matcher: [
    /*
     * Aplica el middleware a todas las rutas excepto:
     * - _next/static  (archivos estáticos)
     * - _next/image   (optimización de imágenes)
     * - favicon.ico
     * - archivos con extensión (e.g. .svg, .png)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
