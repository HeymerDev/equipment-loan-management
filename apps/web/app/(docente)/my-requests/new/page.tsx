"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, AlertTriangle, CalendarDays, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/domain/back-link";
import { LoadError } from "@/components/domain/load-error";
import { PageHeader } from "@/components/domain/page-header";
import { api } from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { addDays, plural, todayUtc } from "@/lib/format";
import { fetchAllEquipment } from "@/lib/lookups";
import { useResource } from "@/lib/use-resource";
import type { Equipment, LoanRequestInput } from "@/lib/types";

/** Propósito obligatorio, máximo 500 caracteres (Req 2.1). */
const MAX_PURPOSE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

type Field = keyof LoanRequestInput;
type Errors = Partial<Record<Field, string>>;

/** Las mismas reglas que aplica la API, para avisar antes de enviar (Req 2.1, 2.3, 2.4). */
function validate(values: LoanRequestInput, today: string): Errors {
  const errors: Errors = {};
  if (!values.equipmentId) errors.equipmentId = "Selecciona el equipo que necesitas";
  if (!values.purpose) errors.purpose = "El propósito es requerido";
  else if (values.purpose.length > MAX_PURPOSE) errors.purpose = "El propósito no puede exceder 500 caracteres";
  if (!values.startDate) errors.startDate = "La fecha de inicio es requerida";
  else if (values.startDate < today) errors.startDate = "La fecha de inicio no puede ser en el pasado";
  if (!values.returnDate) errors.returnDate = "La fecha de devolución es requerida";
  else if (values.startDate && values.returnDate <= values.startDate)
    errors.returnDate = "La fecha de devolución debe ser posterior a la fecha de inicio";
  return errors;
}

// La página se prerenderiza estática: la query solo se lee en el cliente.
export default function NewRequestPage() {
  return (
    <Suspense>
      <NewRequest />
    </Suspense>
  );
}

function NewRequest() {
  const preselected = useSearchParams().get("equipmentId") ?? "";
  const catalog = useResource((signal) => fetchAllEquipment(signal, "DISPONIBLE"), []);

  return (
    <div>
      <PageHeader
        back={<BackLink href="/my-requests">Mis solicitudes</BackLink>}
        title="Nueva solicitud"
        description="Todos los campos son obligatorios. El administrador revisará tu solicitud y verás su respuesta en Mis solicitudes."
      />
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          {catalog.error ? (
            <LoadError error={catalog.error} onRetry={catalog.reload} />
          ) : catalog.loading || !catalog.data ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : catalog.data.length === 0 ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden />
              <AlertTitle>No hay equipos disponibles</AlertTitle>
              <AlertDescription>Todos los equipos están prestados en este momento. Vuelve a intentarlo más tarde.</AlertDescription>
            </Alert>
          ) : (
            <RequestForm equipment={catalog.data} preselected={preselected} onEquipmentGone={catalog.reload} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RequestForm({
  equipment,
  preselected,
  onEquipmentGone,
}: {
  equipment: Equipment[];
  preselected: string;
  onEquipmentGone: () => void;
}) {
  const router = useRouter();
  const today = todayUtc();
  // Un enlace del catálogo puede quedar viejo si el equipo se prestó mientras tanto.
  const preselectedFound = preselected === "" || equipment.some((item) => item.id === preselected);

  const [values, setValues] = useState<LoanRequestInput>({
    equipmentId: preselectedFound ? preselected : "",
    purpose: "",
    startDate: today,
    returnDate: addDays(today, 1),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const purpose = values.purpose.trim();
  const days =
    values.startDate && values.returnDate > values.startDate
      ? Math.round((Date.parse(values.returnDate) - Date.parse(values.startDate)) / DAY_MS) + 1
      : null;

  function update(field: Field, value: string) {
    setValues((current) => {
      const next = { ...current, [field]: value };
      // Mover el inicio más allá de la devolución arrastra la devolución al día siguiente.
      if (field === "startDate" && value && next.returnDate <= value) next.returnDate = addDays(value, 1);
      return next;
    });
    setErrors((current) => ({ ...current, [field]: undefined, ...(field === "startDate" && { returnDate: undefined }) }));
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const body = { ...values, purpose };
    const found = validate(body, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await api.post("/loan-requests", body);
      router.push("/my-requests?notice=created");
    } catch (err) {
      const info = parseApiError(err);
      if (info.code === "CONFLICT") {
        // El equipo ya tiene un préstamo que se cruza con esas fechas (Req 2.5).
        setFormError(`${info.message}. Prueba con otras fechas o con otro equipo.`);
      } else if (info.status === 404) {
        setErrors({ equipmentId: "Este equipo ya no está en el inventario. Elige otro." });
        setValues((current) => ({ ...current, equipmentId: "" }));
        onEquipmentGone();
      } else if (Object.keys(info.fieldErrors).length > 0) {
        setErrors(info.fieldErrors as Errors);
      } else {
        setFormError(info.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {!preselectedFound && (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>El equipo que elegiste ya no está disponible. Selecciona otro de la lista.</AlertDescription>
        </Alert>
      )}

      <FormField id="equipmentId" label="Equipo" error={errors.equipmentId}>
        <NativeSelect
          value={values.equipmentId}
          onChange={(e) => update("equipmentId", e.target.value)}
          disabled={submitting}
        >
          <option value="" disabled>
            Selecciona un equipo
          </option>
          {equipment.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.categoryName}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <FormField
        id="purpose"
        label="Propósito"
        error={errors.purpose}
        hint="Para qué clase o actividad lo necesitas."
        counter={{ value: purpose.length, max: MAX_PURPOSE }}
      >
        <Textarea
          value={values.purpose}
          onChange={(e) => update("purpose", e.target.value)}
          rows={4}
          placeholder="Presentación del proyecto de ciencias con el grupo 10-B"
          disabled={submitting}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="startDate" label="Fecha de inicio" error={errors.startDate}>
          <Input
            type="date"
            value={values.startDate}
            min={today}
            onChange={(e) => update("startDate", e.target.value)}
            disabled={submitting}
          />
        </FormField>
        <FormField id="returnDate" label="Fecha de devolución" error={errors.returnDate}>
          <Input
            type="date"
            value={values.returnDate}
            min={values.startDate ? addDays(values.startDate, 1) : undefined}
            onChange={(e) => update("returnDate", e.target.value)}
            disabled={submitting}
          />
        </FormField>
      </div>

      {days !== null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" aria-hidden />
          Préstamo de {plural(days, "día", "días")}, contando el de inicio y el de devolución.
        </p>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" type="button">
          <Link href="/my-requests">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Enviar solicitud
        </Button>
      </div>
    </form>
  );
}
