import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  id: string;
  label: string;
  /** Mensaje de error; también marca el control como inválido. */
  error?: string;
  hint?: React.ReactNode;
  /** Contador de caracteres, p. ej. `{ value: 37, max: 100 }`. */
  counter?: { value: number; max: number };
  className?: string;
  children: React.ReactElement;
}

/**
 * Etiqueta + control + mensaje. Conecta el control con su etiqueta y con el
 * mensaje de error para lectores de pantalla (`aria-invalid`, `aria-describedby`).
 */
export function FormField({ id, label, error, hint, counter, className, children }: FormFieldProps) {
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error ?? hint);
  const overLimit = counter !== undefined && counter.value > counter.max;

  const control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": hasMessage ? messageId : undefined,
  });

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {(hasMessage || counter) && (
        <div className="flex items-start justify-between gap-3 text-xs">
          <p id={messageId} className={error ? "text-destructive" : "text-muted-foreground"}>
            {error ?? hint}
          </p>
          {counter && (
            <span
              className={cn(
                "shrink-0 tabular-nums",
                overLimit ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              {counter.value}/{counter.max}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
