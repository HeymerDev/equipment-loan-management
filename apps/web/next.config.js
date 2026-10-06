/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpilar el paquete shared del monorepo
  transpilePackages: ["@equipment-loan/shared"],

  /**
   * En producción la web reenvía /api/v1/* a la API. Así el navegador habla
   * con un solo dominio y la cookie de sesión que pone la API queda en el de
   * la web, donde el middleware puede leerla. Sin esto, con la API en otro
   * dominio, el middleware nunca ve la sesión y devuelve siempre al login.
   *
   * API_PROXY_TARGET es la URL base de la API, sin /api/v1 (p. ej.
   * https://mi-api.onrender.com). Se lee al compilar. En local queda vacía y
   * la web llama directo a http://localhost:3001.
   */
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.trim().replace(/\/+$/, "");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";

    // Una URL relativa solo funciona si hay a dónde reenviarla; si no, la web
    // se llamaría a sí misma y cada petición daría 404. Mejor fallar el build.
    if (apiUrl.startsWith("/") && !target) {
      throw new Error(
        `NEXT_PUBLIC_API_URL es "${apiUrl}" pero falta API_PROXY_TARGET. ` +
          "Defínela con la URL base de la API (p. ej. https://mi-api.onrender.com) y vuelve a compilar.",
      );
    }

    if (!target) return [];
    console.log(`[next.config] /api/v1/* se reenvía a ${target}/api/v1/*`);
    return [{ source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` }];
  },
};

module.exports = nextConfig;
