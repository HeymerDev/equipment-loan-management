"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { ROLE_HOME } from "@/lib/routes";

/** Pantalla de acceso denegado (Req 7.3). */
export default function DeniedPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function switchAccount() {
    await logout();
    router.replace("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md space-y-5 rounded-lg border bg-background p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <ShieldX className="h-6 w-6 text-red-600" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Acceso denegado</h1>
          <p className="text-sm text-muted-foreground">
            No tienes permisos para realizar esta acción ni para ver esta sección.
            {user && ` Tu cuenta tiene el rol de ${ROLE_LABEL[user.role].toLowerCase()}.`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {user ? (
            <>
              <Button asChild>
                <Link href={ROLE_HOME[user.role]}>Ir a mi inicio</Link>
              </Button>
              <Button variant="outline" onClick={switchAccount}>
                Cambiar de cuenta
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link href="/login">Iniciar sesión</Link>
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
