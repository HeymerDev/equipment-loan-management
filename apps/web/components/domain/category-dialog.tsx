"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { parseApiError } from "@/lib/api-error";
import type { Category } from "@/lib/types";

/** Mismo límite que valida la API. */
export const CATEGORY_NAME_MAX = 50;

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La categoría a renombrar, o `null` para crear una nueva. */
  category: Category | null;
  onSubmit: (name: string) => Promise<void>;
}

/** Alta y renombrado de una categoría. */
export function CategoryDialog({ open, onOpenChange, category, onSubmit }: CategoryDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setError(undefined);
      setFormError(null);
    }
  }, [open, category]);

  const clean = name.trim();
  const editing = category !== null;
  const unchanged = editing && clean === category.name;

  async function submit() {
    setFormError(null);
    if (!clean) {
      setError("El nombre es requerido");
      return;
    }
    if (clean.length > CATEGORY_NAME_MAX) {
      setError(`El nombre no puede exceder ${CATEGORY_NAME_MAX} caracteres`);
      return;
    }

    setPending(true);
    try {
      await onSubmit(clean);
      onOpenChange(false);
    } catch (err) {
      const info = parseApiError(err);
      // El único conflicto posible es otra categoría con el mismo nombre.
      if (info.code === "CONFLICT") setError(info.message);
      else if (info.fieldErrors.name) setError(info.fieldErrors.name);
      else setFormError(info.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Renombrar categoría" : "Nueva categoría"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Los equipos de esta categoría conservan su clasificación; solo cambia el nombre."
              : "Agrupa los equipos para encontrarlos y filtrarlos más rápido."}
          </DialogDescription>
        </DialogHeader>

        <FormField
          id="categoryName"
          label="Nombre"
          error={error}
          counter={{ value: clean.length, max: CATEGORY_NAME_MAX }}
        >
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            placeholder="Proyección"
            disabled={pending}
          />
        </FormField>

        {formError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || unchanged}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {editing ? "Guardar nombre" : "Crear categoría"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
