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
    if (!target) return [];
    return [{ source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` }];
  },
};

module.exports = nextConfig;
