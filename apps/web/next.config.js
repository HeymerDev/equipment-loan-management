/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpilar el paquete shared del monorepo
  transpilePackages: ["@equipment-loan/shared"],
};

module.exports = nextConfig;
