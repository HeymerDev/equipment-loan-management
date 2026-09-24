"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { api, refreshAccessToken } from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { decodeSession, useAuth } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/routes";

/** Mismo mínimo que valida la API. */
const MIN_LENGTH = 8;

type Field = "currentPassword" | "newPassword" | "confirmPassword";
type Errors = Partial<Record<Field, string>>;

/**
 * Cambio de contraseña. Es obligatorio para las cuentas que un administrador
 * acaba de crear: hasta hacerlo, la API cierra el resto de los endpoints.
 */
export default function ChangePasswordPage() {
  const { status, user } = useAuth();
  const router = useRouter();

  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated" || status === "signed-out") router.replace("/login");
  }, [status, router]);

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  function validate(): Errors {
    const found: Errors = {};
    if (!values.currentPassword) found.currentPassword = "Ingresa tu contraseña actual";
    if (!values.newPassword) found.newPassword = "Ingresa la nueva contraseña";
    else if (values.newPassword.length < MIN_LENGTH)
      found.newPassword = `La nueva contraseña debe tener al menos ${MIN_LENGTH} caracteres`;
    else if (values.newPassword === values.currentPassword)
      found.newPassword = "La nueva contraseña debe ser distinta de la actual";
    if (values.confirmPassword !== values.newPassword)
      found.confirmPassword = "Las contraseñas no coinciden";
    return found;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // El token en memoria todavía dice que la contraseña es temporal: se
      // renueva para que la API vuelva a abrir el resto de la aplicación.
      const session = decodeSession(await refreshAccessToken());
      router.replace(ROLE_HOME[session?.role ?? user?.role ?? "DOCENTE"]);
    } catch (err) {
      const info = parseApiError(err);
      if (Object.keys(info.fieldErrors).length > 0) setErrors(info.fieldErrors as Errors);
      else setFormError(info.message);
      setSubmitting(false);
    }
  }

  const forced = user?.mustChangePassword === true;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-background p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <KeyRound className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold">Cambia tu contraseña</h1>
          <p className="text-sm text-muted-foreground">
            {forced
              ? "Tu cuenta se creó con una contraseña temporal. Elige una propia para empezar a usar el sistema."
              : "Elige una contraseña nueva. Se cerrarán tus demás sesiones."}
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FormField
            id="currentPassword"
            label={forced ? "Contraseña temporal" : "Contraseña actual"}
            error={errors.currentPassword}
          >
            <Input
              type="password"
              autoComplete="current-password"
              value={values.currentPassword}
              onChange={(e) => update("currentPassword", e.target.value)}
              disabled={submitting}
            />
          </FormField>

          <FormField
            id="newPassword"
            label="Nueva contraseña"
            error={errors.newPassword}
            hint={`Al menos ${MIN_LENGTH} caracteres.`}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={values.newPassword}
              onChange={(e) => update("newPassword", e.target.value)}
              disabled={submitting}
            />
          </FormField>

          <FormField id="confirmPassword" label="Repite la nueva contraseña" error={errors.confirmPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(e) => update("confirmPassword", e.target.value)}
              disabled={submitting}
            />
          </FormField>

          {formError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Guardar contraseña
          </Button>
        </form>
      </div>
    </main>
  );
}
