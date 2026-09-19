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
import { Textarea } from "@/components/ui/textarea";
import { parseApiError } from "@/lib/api-error";
import { formatPeriod } from "@/lib/format";
import type { LoanRequest } from "@/lib/types";

/** Límites del motivo de rechazo (Req 3.3, 3.4). */
const MIN = 10;
const MAX = 500;
const LENGTH_MESSAGE = "El motivo de rechazo debe tener entre 10 y 500 caracteres";

interface RejectRequestDialogProps {
  request: LoanRequest | null;
  onOpenChange: (open: boolean) => void;
  onReject: (request: LoanRequest, reason: string) => Promise<void>;
}

export function RejectRequestDialog({ request, onOpenChange, onReject }: RejectRequestDialogProps) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (request) {
      setReason("");
      setFieldError(undefined);
      setFormError(null);
    }
  }, [request]);

  const length = reason.trim().length;

  async function submit() {
    if (!request) return;
    setFormError(null);
    if (length < MIN || length > MAX) {
      setFieldError(LENGTH_MESSAGE);
      return;
    }

    setPending(true);
    try {
      await onReject(request, reason.trim());
      onOpenChange(false);
    } catch (err) {
      const info = parseApiError(err);
      if (info.fieldErrors.rejectionReason) setFieldError(info.fieldErrors.rejectionReason);
      else setFormError(info.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar solicitud</DialogTitle>
          <DialogDescription>
            {request && (
              <>
                {request.teacherName} pidió <strong className="text-foreground">{request.equipmentName}</strong> del{" "}
                {formatPeriod(request.startDate, request.returnDate)}. El docente verá este motivo.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <FormField
          id="rejectionReason"
          label="Motivo del rechazo"
          error={fieldError}
          hint="Entre 10 y 500 caracteres."
          counter={{ value: length, max: MAX }}
        >
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setFieldError(undefined);
            }}
            rows={4}
            placeholder="Ej.: el equipo está reservado para mantenimiento esa semana."
            disabled={pending}
            autoFocus
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
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Rechazar solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
