import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({ page, limit, total, onPageChange, disabled }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row">
      <p aria-live="polite">
        {total === 0 ? "Sin resultados" : `Mostrando ${from}–${to} de ${total}`}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={disabled || page <= 1}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
            Anterior
          </Button>
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={disabled || page >= pages}
          >
            Siguiente
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
