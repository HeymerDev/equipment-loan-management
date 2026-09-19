import { api } from "@/lib/api";
import type {
  Category,
  Equipment,
  EquipmentStatus,
  Item,
  Paginated,
  UserSummary,
} from "@/lib/types";

/** Datos de referencia que varias pantallas usan para nombrar ids y llenar filtros. */

export async function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  const response = await api.get<Item<Category[]>>("/categories", { signal });
  return response.data.data;
}

/** Solo administradores. */
export async function fetchUsers(signal?: AbortSignal): Promise<UserSummary[]> {
  const response = await api.get<Item<UserSummary[]>>("/users", { signal });
  return response.data.data;
}

/** Todo el inventario activo (50 por página, como máximo 40 páginas). */
export async function fetchAllEquipment(
  signal?: AbortSignal,
  status?: EquipmentStatus,
): Promise<Equipment[]> {
  const items: Equipment[] = [];
  for (let page = 1; page <= 40; page++) {
    const response = await api.get<Paginated<Equipment>>("/equipment", {
      params: { page, limit: 50, status },
      signal,
    });
    items.push(...response.data.data);
    if (items.length >= response.data.meta.total || response.data.data.length === 0) break;
  }
  return items;
}

export function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]));
}
