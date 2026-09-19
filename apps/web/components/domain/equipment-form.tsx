"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { parseApiError } from "@/lib/api-error";
import type { Category, EquipmentInput } from "@/lib/types";

/** Límites de la API (Req 1.1, 1.7). */
export const EQUIPMENT_LIMITS = { name: 100, serialNumber: 50, description: 500 } as const;

type Field = keyof EquipmentInput;
type Errors = Partial<Record<Field, string>>;

export const EMPTY_EQUIPMENT: EquipmentInput = {
  name: "",
  serialNumber: "",
  description: "",
  categoryId: "",
};

function trimmed(values: EquipmentInput): EquipmentInput {
  return {
    name: values.name.trim(),
    serialNumber: values.serialNumber.trim(),
    description: values.description.trim(),
    categoryId: values.categoryId,
  };
}

function validate(values: EquipmentInput): Errors {
  const errors: Errors = {};
  if (!values.name) errors.name = "El nombre es requerido";
  else if (values.name.length > EQUIPMENT_LIMITS.name) errors.name = "El nombre no puede exceder 100 caracteres";
  if (!values.categoryId) errors.categoryId = "Selecciona una categoría";
  if (!values.serialNumber) errors.serialNumber = "El número de serie es requerido";
  else if (values.serialNumber.length > EQUIPMENT_LIMITS.serialNumber)
    errors.serialNumber = "El número de serie no puede exceder 50 caracteres";
  if (!values.description) errors.description = "La descripción es requerida";
  else if (values.description.length > EQUIPMENT_LIMITS.description)
    errors.description = "La descripción no puede exceder 500 caracteres";
  return errors;
}

interface EquipmentFormProps {
  categories: Category[];
  initial?: EquipmentInput;
  submitLabel: string;
  cancelHref: string;
  /** Guarda en la API; si rechaza, el formulario muestra el error junto al campo. */
  onSubmit: (values: EquipmentInput) => Promise<void>;
}

/** Formulario de registro y edición de equipos. */
export function EquipmentForm({ categories, initial = EMPTY_EQUIPMENT, submitLabel, cancelHref, onSubmit }: EquipmentFormProps) {
  const [values, setValues] = useState<EquipmentInput>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clean = trimmed(values);
  const dirty = (Object.keys(clean) as Field[]).some((field) => clean[field] !== initial[field]);

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found = validate(clean);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await onSubmit(clean);
    } catch (err) {
      const info = parseApiError(err);
      if (info.code === "CONFLICT") {
        // El único conflicto posible al guardar es el número de serie repetido (Req 1.6).
        setErrors({ serialNumber: info.message });
      } else if (Object.keys(info.fieldErrors).length > 0) {
        setErrors(info.fieldErrors as Errors);
      } else {
        setFormError(info.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="name"
          label="Nombre"
          error={errors.name}
          counter={{ value: values.name.trim().length, max: EQUIPMENT_LIMITS.name }}
        >
          <Input
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Laptop Lenovo ThinkPad T14"
            disabled={submitting}
          />
        </FormField>

        <FormField id="categoryId" label="Categoría" error={errors.categoryId}>
          <NativeSelect
            value={values.categoryId}
            onChange={(e) => update("categoryId", e.target.value)}
            disabled={submitting}
          >
            <option value="" disabled>
              Selecciona una categoría
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField
          id="serialNumber"
          label="Número de serie"
          error={errors.serialNumber}
          hint="Debe ser único en todo el inventario."
          counter={{ value: values.serialNumber.trim().length, max: EQUIPMENT_LIMITS.serialNumber }}
        >
          <Input
            value={values.serialNumber}
            onChange={(e) => update("serialNumber", e.target.value)}
            placeholder="PF-3K9X2L"
            className="font-mono"
            autoComplete="off"
            disabled={submitting}
          />
        </FormField>
      </div>

      <FormField
        id="description"
        label="Descripción"
        error={errors.description}
        counter={{ value: values.description.trim().length, max: EQUIPMENT_LIMITS.description }}
      >
        <Textarea
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          rows={4}
          placeholder="Estado, accesorios incluidos, ubicación habitual…"
          disabled={submitting}
        />
      </FormField>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" type="button">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
        <Button type="submit" disabled={submitting || !dirty}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
