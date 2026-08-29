import { EquipmentStatus } from '../enums.js';

/** Public representation of a piece of equipment. */
export interface EquipmentDto {
  id: string;
  name: string;
  serialNumber: string;
  description: string;
  status: EquipmentStatus;
  categoryId: string;
  categoryName: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Request body for POST /equipment. */
export interface CreateEquipmentDto {
  name: string;
  serialNumber: string;
  description: string;
  categoryId: string;
}

/**
 * Request body for PATCH /equipment/:id.
 * All fields are optional — only provided fields are updated.
 */
export interface UpdateEquipmentDto {
  name?: string;
  serialNumber?: string;
  description?: string;
  categoryId?: string;
}
