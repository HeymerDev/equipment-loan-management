import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './categories.schema.js';

/** Public representation of an equipment category. */
export interface CategoryDto {
  id: string;
  name: string;
  /** Equipos activos que la usan; sirve para avisar antes de borrarla. */
  equipmentCount: number;
}

const DUPLICATE_NAME = 'Ya existe una categoría con ese nombre';

/** El nombre es único en el esquema: Prisma lo reporta como P2002. */
function isDuplicate(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

export class CategoriesService {
  /**
   * Returns the full category list, alphabetically ordered.
   * Categories are a small catalogue, so there is no pagination.
   */
  async listCategories(): Promise<CategoryDto[]> {
    const rows = await prisma.category.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { equipment: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });

    return rows.map(({ id, name, _count }) => ({
      id,
      name,
      equipmentCount: _count.equipment,
    }));
  }

  async createCategory(input: CreateCategoryInput): Promise<CategoryDto> {
    try {
      const category = await prisma.category.create({
        data: { name: input.name },
        select: { id: true, name: true },
      });
      return { ...category, equipmentCount: 0 };
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictError(DUPLICATE_NAME);
      throw err;
    }
  }

  /** Renombrar no afecta a los equipos: siguen apuntando al mismo id. */
  async updateCategory(
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryDto> {
    await this.getCategoryOrThrow(id);

    try {
      const category = await prisma.category.update({
        where: { id },
        data: { name: input.name },
        select: {
          id: true,
          name: true,
          _count: { select: { equipment: { where: { deletedAt: null } } } },
        },
      });
      return {
        id: category.id,
        name: category.name,
        equipmentCount: category._count.equipment,
      };
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictError(DUPLICATE_NAME);
      throw err;
    }
  }

  /**
   * Solo se borra una categoría que nadie usa. Cuenta también los equipos
   * retirados, porque su historial sigue mostrando la categoría.
   */
  async deleteCategory(id: string): Promise<void> {
    await this.getCategoryOrThrow(id);

    const equipmentCount = await prisma.equipment.count({
      where: { categoryId: id },
    });

    if (equipmentCount > 0) {
      throw new ConflictError(
        equipmentCount === 1
          ? 'La categoría tiene 1 equipo y no puede eliminarse'
          : `La categoría tiene ${equipmentCount} equipos y no puede eliminarse`,
      );
    }

    await prisma.category.delete({ where: { id } });
  }

  private async getCategoryOrThrow(id: string): Promise<{ id: string }> {
    const category = await prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) throw new NotFoundError('Categoría');
    return category;
  }
}

export const categoriesService = new CategoriesService();
