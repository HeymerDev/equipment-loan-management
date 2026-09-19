"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Usuario actual y botón para cerrar sesión (Req 7.4). */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  if (!user) return null;

  async function handleLogout() {
    setLeaving(true);
    await logout();
    router.replace("/login");
  }

  return (
    <div className={cn("flex items-center gap-3", compact ? "justify-end" : "justify-between")}>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={user.email}>
            {user.email}
          </p>
          <p className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</p>
        </div>
      )}
      <Button
        variant="ghost"
        size={compact ? "sm" : "icon"}
        onClick={handleLogout}
        disabled={leaving}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        {leaving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <LogOut className="h-4 w-4" aria-hidden />
        )}
        {compact && <span className="ml-2">Salir</span>}
      </Button>
    </div>
  );
}
