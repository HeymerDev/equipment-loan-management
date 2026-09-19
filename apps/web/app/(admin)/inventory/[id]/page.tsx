"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, History, SearchX } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/domain/back-link";
import { EmptyState } from "@/components/domain/empty-state";
import { EquipmentForm } from "@/components/domain/equipment-form";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { EquipmentStatusBadge } from "@/components/domain/status-badges";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { fetchCategories } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { Equipment, EquipmentInput, Item } from "@/lib/types";

export default function EquipmentDetailPage({ params }: { params: { id: string } }) {
  const [saved, setSaved] = useState<Equipment | null>(null);

  const resource = useResource(
    async (signal) => {
      const [equipment, categories] = await Promise.all([
        api.get<Item<Equipment>>(`/equipment/${params.id}`, { signal }).then((response) => response.data.data),
        fetchCategories(signal),
      ]);
      return { equipment, categories };
    },
    [params.id],
  );

  const equipment = saved ?? resource.data?.equipment;

  async function save(values: EquipmentInput) {
    const response = await api.patch<Item<Equipment>>(`/equipment/${params.id}`, values);
    setSaved(response.data.data);
  }

  const back = <BackLink href="/inventory">Inventario</BackLink>;

  if (resource.error) {
    if (parseApiError(resource.error).status === 404) {
      return (
        <div>
          <PageHeader back={back} title="Equipo no encontrado" />
          <Card>
            <EmptyState
              icon={SearchX}
              title="Este equipo no existe o fue eliminado del inventario"
              description="Su historial sigue disponible."
              action={
                <Button asChild variant="outline">
                  <Link href={`/inventory/${params.id}/history`}>Ver historial</Link>
                </Button>
              }
            />
          </Card>
        </div>
      );
    }
    return (
      <div>
        <PageHeader back={back} title="Editar equipo" />
        <LoadError error={resource.error} onRetry={resource.reload} />
      </div>
    );
  }

  if (!equipment || !resource.data) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full max-w-3xl" />
      </div>
    );
  }

  const initial: EquipmentInput = {
    name: equipment.name,
    serialNumber: equipment.serialNumber,
    description: equipment.description,
    categoryId: equipment.categoryId,
  };

  return (
    <div>
      <PageHeader
        back={back}
        title={equipment.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EquipmentStatusBadge status={equipment.status} />
            <span>
              Registrado el {formatDateTime(equipment.createdAt)} · última modificación el{" "}
              {formatDateTime(equipment.updatedAt)}
            </span>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/inventory/${equipment.id}/history`}>
              <History className="mr-1 h-4 w-4" aria-hidden />
              Ver historial
            </Link>
          </Button>
        }
      />

      {saved && (
        <Alert variant="success" className="mb-4 max-w-3xl">
          <CheckCircle2 aria-hidden />
          <AlertDescription>Cambios guardados. Quedaron registrados en el historial del equipo.</AlertDescription>
        </Alert>
      )}

      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <EquipmentForm
            // Tras guardar, el formulario parte de los valores nuevos.
            key={equipment.updatedAt}
            categories={resource.data.categories}
            initial={initial}
            submitLabel="Guardar cambios"
            cancelHref="/inventory"
            onSubmit={save}
          />
        </CardContent>
      </Card>
    </div>
  );
}
