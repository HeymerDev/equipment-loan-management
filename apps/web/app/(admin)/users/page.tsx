"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, UserPlus, Users, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { NewUserDialog } from "@/components/domain/new-user-dialog";
import { PageHeader } from "@/components/domain/page-header";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { fetchUsers } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { CreatedUser, Item, UserInput } from "@/lib/types";

export default function UsersPage() {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);

  const list = useResource(fetchUsers, []);

  async function create(values: UserInput) {
    const response = await api.post<Item<CreatedUser>>("/users", values);
    setCreated(response.data.data);
    list.reload();
  }

  const users = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Docentes y administradores con acceso al sistema."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="mr-1 h-4 w-4" aria-hidden />
            Registrar usuario
          </Button>
        }
      />

      {created && <TemporaryPassword created={created} onDismiss={() => setCreated(null)} />}

      <Card>
        {list.error ? (
          <div className="p-4">
            <LoadError error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} title="Aún no hay usuarios registrados" />
        ) : (
          <>
            <div className="border-b p-4 text-sm text-muted-foreground">
              {plural(users.length, "usuario", "usuarios")}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={list.refreshing ? "opacity-60" : undefined}>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.fullName}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "ADMINISTRADOR" ? "info" : "neutral"}>
                        {ROLE_LABEL[user.role]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Card>

      <NewUserDialog open={creating} onOpenChange={setCreating} onCreate={create} />
    </div>
  );
}

/** La contraseña temporal solo llega una vez: el aviso se queda hasta cerrarlo. */
function TemporaryPassword({
  created,
  onDismiss,
}: {
  created: CreatedUser;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles queda a la vista para copiarla a mano.
    }
  }

  return (
    <Alert variant="success" className="mb-4 pr-12">
      <KeyRound aria-hidden />
      <AlertTitle>{created.user.fullName} ya puede entrar</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Entrégale estos datos. La contraseña no se vuelve a mostrar, y el sistema le pedirá
          cambiarla al entrar.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-background px-2 py-1 font-mono text-sm">
            {created.user.email}
          </code>
          <code className="rounded bg-background px-2 py-1 font-mono text-sm">
            {created.temporaryPassword}
          </code>
          <Button size="sm" variant="outline" onClick={copy} className="bg-background">
            {copied ? (
              <Check className="mr-1 h-4 w-4" aria-hidden />
            ) : (
              <Copy className="mr-1 h-4 w-4" aria-hidden />
            )}
            {copied ? "Copiada" : "Copiar contraseña"}
          </Button>
        </div>
      </AlertDescription>
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 rounded p-1 text-emerald-700 hover:bg-emerald-100"
        aria-label="Cerrar aviso"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </Alert>
  );
}
