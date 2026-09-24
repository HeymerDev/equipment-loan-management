"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CHANGE_PASSWORD_ROUTE } from "@/lib/routes";
import type { Role } from "@/lib/types";

/**
 * Segunda línea tras el middleware: el middleware solo ve la cookie; aquí ya
 * se conoce la sesión real (access token). Solo muestra el contenido al rol
 * indicado — sin sesión va al login y con otro rol a acceso denegado.
 */
export function RoleGuard({ role, children }: { role: Role; children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    } else if (status === "signed-out") {
      router.replace("/login");
    } else if (status === "authenticated") {
      if (!user) router.replace("/login");
      // La contraseña temporal solo abre la pantalla para reemplazarla.
      else if (user.mustChangePassword) router.replace(CHANGE_PASSWORD_ROUTE);
      else if (user.role !== role) router.replace("/denied");
    }
  }, [status, user, role, pathname, router]);

  if (status !== "authenticated" || !user || user.mustChangePassword || user.role !== role) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando…
      </div>
    );
  }

  return <>{children}</>;
}
