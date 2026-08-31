import type { ReactNode } from "react";

/**
 * Layout del área de administrador.
 * El guard de rol se aplica en middleware.ts comprobando la cookie refreshToken.
 * Este layout puede añadir navegación, sidebar, etc. en tareas futuras.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Navegación del administrador se implementará en tareas posteriores */}
      <main>{children}</main>
    </div>
  );
}
