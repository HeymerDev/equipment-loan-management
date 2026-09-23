"use client";

import { useState } from "react";
import Link from "next/link";
import { Laptop, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/domain/empty-state";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { plural } from "@/lib/format";
import { fetchAllEquipment } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Catálogo de equipos que se pueden solicitar ahora mismo. */
export default function EquipmentCatalogPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  // Solo los disponibles: un equipo prestado no puede aprobarse hasta que vuelva.
  const catalog = useResource((signal) => fetchAllEquipment(signal, "DISPONIBLE"), []);

  const items = catalog.data ?? [];
  const categories = [...new Map(items.map((item) => [item.categoryId, item.categoryName])).entries()].sort(
    ([, a], [, b]) => a.localeCompare(b, "es"),
  );

  const needle = normalize(query.trim());
  const visible = items.filter(
    (item) =>
      (!category || item.categoryId === category) &&
      (!needle || normalize(`${item.name} ${item.description} ${item.categoryName}`).includes(needle)),
  );
  const filtering = needle !== "" || category !== "";

  return (
    <div>
      <PageHeader
        title="Catálogo de equipos"
        description={
          catalog.data
            ? `${plural(items.length, "equipo disponible", "equipos disponibles")} para solicitar.`
            : "Equipos disponibles para solicitar."
        }
      />

      {catalog.data && items.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o descripción"
              aria-label="Buscar equipos"
              className="pl-9"
            />
          </div>
          <div className="sm:w-56">
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categories.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}

      {catalog.error ? (
        <LoadError error={catalog.error} onRetry={catalog.reload} />
      ) : catalog.loading || !catalog.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((card) => (
            <Skeleton key={card} className="h-40 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Laptop}
            title={filtering ? "Ningún equipo coincide con la búsqueda" : "No hay equipos disponibles ahora"}
            description={
              filtering
                ? "Prueba con otras palabras o con otra categoría."
                : "Todos los equipos están prestados. Vuelve a consultar más tarde."
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <li key={item.id}>
              <Card className="flex h-full flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 pt-5">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {item.categoryName}
                    </p>
                    <h2 className="font-semibold leading-tight">{item.name}</h2>
                    <p className="font-mono text-xs text-muted-foreground">{item.serialNumber}</p>
                  </div>
                  <p className="line-clamp-3 flex-1 text-sm text-muted-foreground" title={item.description}>
                    {item.description}
                  </p>
                  <Button asChild size="sm" className="w-full">
                    <Link href={`/my-requests/new?equipmentId=${item.id}`}>
                      <Plus className="mr-1 h-4 w-4" aria-hidden />
                      Solicitar
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
