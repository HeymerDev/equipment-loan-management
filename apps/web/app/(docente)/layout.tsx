import type { ReactNode } from "react";

/**
 * Layout del área de docente.
 * El guard de rol se aplica en middleware.ts comprobando la cookie refreshToken.
 * Este layout puede añadir navegación, etc. en tareas futuras.
 */
export default function DocenteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Navegación del docente se implementará en tareas posteriores */}
      <main>{children}</main>
    </div>
  );
}
