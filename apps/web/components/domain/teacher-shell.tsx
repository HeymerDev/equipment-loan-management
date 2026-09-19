"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Laptop, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/domain/user-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/my-requests", label: "Mis solicitudes", icon: ClipboardList },
  { href: "/equipment", label: "Catálogo", icon: Laptop },
];

/** Estructura del área docente: barra superior con navegación y acceso a nueva solicitud. */
export function TeacherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/my-requests" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Laptop className="h-4 w-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">Préstamo de equipos</span>
          </Link>

          <nav aria-label="Principal" className="flex items-center gap-1">
            {NAV.map((item) => {
              // "Nueva solicitud" tiene su propio botón; no marca "Mis solicitudes".
              const active =
                item.href === "/my-requests"
                  ? pathname === "/my-requests"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/my-requests/new">
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                Nueva solicitud
              </Link>
            </Button>
            <UserMenu compact />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
