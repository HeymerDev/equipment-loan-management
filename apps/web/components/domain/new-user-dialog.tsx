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
import { NativeSelect } from "@/components/ui/native-select";
import { parseApiError } from "@/lib/api-error";
import { ROLE_LABEL } from "@/lib/labels";
import type { Role, UserInput } from "@/lib/types";

/** Límites de la API. */
const LIMITS = { fullName: 100, email: 255 } as const;

const EMPTY: UserInput = { fullName: "", email: "", role: "DOCENTE" };
const ROLES: Role[] = ["DOCENTE", "ADMINISTRADOR"];

type Field = keyof UserInput;
type Errors = Partial<Record<Field, string>>;

function validate(values: UserInput): Errors {
  const errors: Errors = {};
  if (!values.fullName) errors.fullName = "El nombre es requerido";
  else if (values.fullName.length > LIMITS.fullName)
    errors.fullName = "El nombre no puede exceder 100 caracteres";
  if (!values.email) errors.email = "El email es requerido";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = "El email no es válido";
  return errors;
}

interface NewUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registra la cuenta; si rechaza, el diálogo muestra el error. */
  onCreate: (values: UserInput) => Promise<void>;
}

/** Alta de una cuenta de docente o de administrador. */
export function NewUserDialog({ open, onOpenChange, onCreate }: NewUserDialogProps) {
  const [values, setValues] = useState<UserInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(EMPTY);
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  async function submit() {
    const clean: UserInput = {
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      role: values.role,
    };
    const found = validate(clean);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      await onCreate(clean);
      onOpenChange(false);
    } catch (err) {
      const info = parseApiError(err);
      // El único conflicto posible es un email ya registrado.
      if (info.code === "CONFLICT") setErrors({ email: info.message });
      else if (Object.keys(info.fieldErrors).length > 0) setErrors(info.fieldErrors as Errors);
      else setFormError(info.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar usuario</DialogTitle>
          <DialogDescription>
            El sistema genera una contraseña temporal que verás una sola vez. Entrégasela a la
            persona: tendrá que cambiarla la primera vez que entre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField
            id="fullName"
            label="Nombre completo"
            error={errors.fullName}
            counter={{ value: values.fullName.trim().length, max: LIMITS.fullName }}
          >
            <Input
              value={values.fullName}
              onChange={(e) => update("fullName", e.target.value)}
              placeholder="María Fernanda Ruiz"
              disabled={pending}
            />
          </FormField>

          <FormField id="email" label="Email" error={errors.email} hint="Con este correo inicia sesión.">
            <Input
              type="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="maria.ruiz@colegio.edu"
              autoComplete="off"
              disabled={pending}
            />
          </FormField>

          <FormField id="role" label="Rol" error={errors.role}>
            <NativeSelect
              value={values.role}
              onChange={(e) => update("role", e.target.value)}
              disabled={pending}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          {values.role === "ADMINISTRADOR" && (
            <p className="text-sm text-muted-foreground">
              Un administrador gestiona el inventario, aprueba solicitudes y puede registrar a
              otras personas.
            </p>
          )}

          {formError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
