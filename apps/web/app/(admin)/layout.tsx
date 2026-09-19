import type { ReactNode } from "react";
import { AdminShell } from "@/components/domain/admin-shell";
import { PendingRequestsProvider } from "@/components/domain/pending-requests";
import { RoleGuard } from "@/components/domain/role-guard";

/**
 * Área de administración. El middleware ya filtró por la cookie de sesión;
 * `RoleGuard` confirma el rol con la sesión real antes de mostrar nada, y la
 * consulta periódica de pendientes solo corre para administradores.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard role="ADMINISTRADOR">
      <PendingRequestsProvider>
        <AdminShell>{children}</AdminShell>
      </PendingRequestsProvider>
    </RoleGuard>
  );
}
