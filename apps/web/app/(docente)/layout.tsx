import type { ReactNode } from "react";
import { RoleGuard } from "@/components/domain/role-guard";
import { TeacherShell } from "@/components/domain/teacher-shell";

/**
 * Área docente. El middleware ya filtró por la cookie de sesión; `RoleGuard`
 * confirma el rol con la sesión real antes de mostrar nada.
 */
export default function DocenteLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard role="DOCENTE">
      <TeacherShell>{children}</TeacherShell>
    </RoleGuard>
  );
}
