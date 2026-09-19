import { AlertCircle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { parseApiError } from "@/lib/api-error";

interface LoadErrorProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

/** Error al cargar datos, con la opción de reintentar. */
export function LoadError({ error, onRetry, title = "No se pudo cargar la información" }: LoadErrorProps) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{parseApiError(error).message}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="border-destructive/40">
            <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden />
            Reintentar
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
