"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryDialog } from "@/components/domain/category-dialog";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { fetchCategories } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { Category, Item } from "@/lib/types";

export default function CategoriesPage() {
  const [editing, setEditing] = useState<{ open: boolean; category: Category | null }>({
    open: false,
    category: null,
  });
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useResource(fetchCategories, []);

  async function save(name: string) {
    const target = editing.category;
    if (target) {
      await api.patch<Item<Category>>(`/categories/${target.id}`, { name });
      setNotice(`«${target.name}» ahora se llama «${name}».`);
    } else {
      await api.post<Item<Category>>("/categories", { name });
      setNotice(`Categoría «${name}» creada. Ya puedes asignarla a un equipo.`);
    }
    list.reload();
  }

  async function remove(category: Category) {
    await api.delete(`/categories/${category.id}`);
    setNotice(`Categoría «${category.name}» eliminada.`);
    list.reload();
  }

  const categories = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Categorías"
        description="Clasifican los equipos del inventario. Cada equipo pertenece a una."
        actions={
          <Button onClick={() => setEditing({ open: true, category: null })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Nueva categoría
          </Button>
        }
      />

      {notice && (
        <Alert variant="success" className="mb-4 pr-12">
          <CheckCircle2 aria-hidden />
          <AlertDescription>{notice}</AlertDescription>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="absolute right-3 top-3 rounded p-1 text-emerald-700 hover:bg-emerald-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </Alert>
      )}

      <Card>
        {list.error ? (
          <div className="p-4">
            <LoadError error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="Aún no hay categorías"
            description="Crea la primera para poder registrar equipos."
            action={
              <Button onClick={() => setEditing({ open: true, category: null })}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                Nueva categoría
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead>Equipos</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={list.refreshing ? "opacity-60" : undefined}>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell>
                    {category.equipmentCount > 0 ? (
                      <Link href="/inventory" className="text-muted-foreground hover:underline">
                        {plural(category.equipmentCount, "equipo", "equipos")}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Sin equipos</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing({ open: true, category })}
                        title="Renombrar"
                        aria-label={`Renombrar ${category.name}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setToDelete(category)}
                        disabled={category.equipmentCount > 0}
                        title={
                          category.equipmentCount > 0
                            ? "No se puede eliminar: tiene equipos"
                            : "Eliminar"
                        }
                        aria-label={`Eliminar ${category.name}`}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CategoryDialog
        open={editing.open}
        category={editing.category}
        onOpenChange={(open) => setEditing((current) => ({ ...current, open }))}
        onSubmit={save}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="¿Eliminar esta categoría?"
        description={
          toDelete && (
            <>
              <strong className="text-foreground">{toDelete.name}</strong> dejará de aparecer al
              registrar equipos. Ningún equipo la usa, así que no se pierde nada más.
            </>
          )
        }
        confirmLabel="Eliminar categoría"
        variant="destructive"
        onConfirm={() => (toDelete ? remove(toDelete) : Promise.resolve())}
      />
    </div>
  );
}
