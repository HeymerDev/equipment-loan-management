"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/domain/back-link";
import { EquipmentForm } from "@/components/domain/equipment-form";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { api } from "@/lib/api";
import { fetchCategories } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { EquipmentInput } from "@/lib/types";

export default function NewEquipmentPage() {
  const router = useRouter();
  const categories = useResource(fetchCategories, []);

  async function create(values: EquipmentInput) {
    await api.post("/equipment", values);
    router.push("/inventory?notice=created");
  }

  return (
    <div>
      <PageHeader
        back={<BackLink href="/inventory">Inventario</BackLink>}
        title="Registrar equipo"
        description="Todos los campos son obligatorios. El equipo queda disponible para préstamo en cuanto se registra."
      />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          {categories.error ? (
            <LoadError error={categories.error} onRetry={categories.reload} />
          ) : categories.loading || !categories.data ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : categories.data.length === 0 ? (
            <Alert variant="warning">
              <Tags aria-hidden />
              <AlertTitle>Primero crea una categoría</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>Todo equipo pertenece a una categoría, y todavía no hay ninguna.</p>
                <Button asChild size="sm" variant="outline" className="bg-background">
                  <Link href="/categories">Ir a categorías</Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <EquipmentForm
              categories={categories.data}
              submitLabel="Registrar equipo"
              cancelHref="/inventory"
              onSubmit={create}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
