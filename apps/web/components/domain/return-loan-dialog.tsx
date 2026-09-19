"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { parseApiError } from "@/lib/api-error";
import { daysFromToday, formatDay, plural } from "@/lib/format";
import type { Loan } from "@/lib/types";

/** Observaciones opcionales, máximo 500 caracteres (Req 4.2). */
const MAX_NOTES = 500;

interface ReturnLoanDialogProps {
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
  onReturn: (loan: Loan, returnNotes: string | undefined) => Promise<void>;
}

export function ReturnLoanDialog({ loan, onOpenChange, onReturn }: ReturnLoanDialogProps) {
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (loan) {
      setNotes("");
      setFieldError(undefined);
      setFormError(null);
    }
  }, [loan]);

  const length = notes.trim().length;
  // Se cuenta por día: devolver el día pactado no es un retraso.
  const daysLate = loan ? Math.max(0, -daysFromToday(loan.agreedReturnDate)) : 0;

  async function submit() {
    if (!loan) return;
    setFormError(null);
    if (length > MAX_NOTES) {
      setFieldError("Las observaciones no pueden exceder 500 caracteres");
      return;
    }

    setPending(true);
    try {
      await onReturn(loan, length > 0 ? notes.trim() : undefined);
      onOpenChange(false);
    } catch (err) {
      const info = parseApiError(err);
      if (info.fieldErrors.returnNotes) setFieldError(info.fieldErrors.returnNotes);
      else setFormError(info.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={loan !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar devolución</DialogTitle>
          <DialogDescription>
            {loan && (
              <>
                <strong className="text-foreground">{loan.equipmentName}</strong> ({loan.equipmentSerialNumber}),
                prestado a {loan.teacherName}. Volverá a estar disponible en el inventario.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {loan && daysLate > 0 && (
          <Alert variant="warning">
            <AlertTriangle aria-hidden />
            <AlertDescription>
              La devolución pactada era el {formatDay(loan.agreedReturnDate)}: se registrará con{" "}
              {plural(daysLate, "día", "días")} de retraso.
            </AlertDescription>
          </Alert>
        )}

        <FormField
          id="returnNotes"
          label="Observaciones (opcional)"
          error={fieldError}
          hint="Estado del equipo al recibirlo, accesorios faltantes…"
          counter={{ value: length, max: MAX_NOTES }}
        >
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setFieldError(undefined);
            }}
            rows={3}
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
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Registrar devolución
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
