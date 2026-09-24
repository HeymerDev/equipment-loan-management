"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  History,
  Inbox,
  Laptop,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PendingRequestsBadge } from "@/components/domain/pending-requests";
import { UserMenu } from "@/components/domain/user-menu";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de solicitudes pendientes (Req 2.6). */
  pendingBadge?: boolean;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventario", icon: Laptop },
  { href: "/requests", label: "Solicitudes", icon: Inbox, pendingBadge: true },
  { href: "/loans", label: "Préstamos", icon: ArrowLeftRight },
  { href: "/history", label: "Historial", icon: History },
  { href: "/users", label: "Usuarios", icon: Users },
];

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Laptop className="h-4 w-4" aria-hidden />
      </span>
      Préstamo de equipos
    </Link>
  );
}

/** Estructura del área de administración: barra lateral en escritorio, barra superior en móvil. */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/30 md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r bg-background md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex h-16 items-center border-b px-5">
          <Brand />
        </div>
        <nav aria-label="Principal" className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
                {item.pendingBadge && <PendingRequestsBadge />}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <UserMenu />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Brand />
            <UserMenu compact />
          </div>
          <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-2 pb-2">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  {item.label}
                  {item.pendingBadge && <PendingRequestsBadge className="ml-1" />}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
