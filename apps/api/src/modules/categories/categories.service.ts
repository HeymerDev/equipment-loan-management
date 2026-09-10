import { prisma } from "../../config/prisma.js";

/** Public representation of an equipment category. */
export interface CategoryDto {
  id: string;
  name: string;
}

export class CategoriesService {
  /**
   * Returns the full category list, alphabetically ordered.
   * Categories are a small, closed catalogue (seeded), so there is no pagination.
   */
  async listCategories(): Promise<CategoryDto[]> {
    return prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
}

export const categoriesService = new CategoriesService();
