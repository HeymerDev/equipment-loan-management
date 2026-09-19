import { AlertTriangle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  EQUIPMENT_STATUS_LABEL,
  LOAN_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
} from "@/lib/labels";
import type { EquipmentStatus, LoanRequestStatus, LoanStatus } from "@/lib/types";

type Variant = NonNullable<BadgeProps["variant"]>;

const EQUIPMENT_VARIANT: Record<EquipmentStatus, Variant> = {
  DISPONIBLE: "success",
  PRESTADO: "warning",
};

const REQUEST_VARIANT: Record<LoanRequestStatus, Variant> = {
  PENDIENTE: "warning",
  APROBADA: "success",
  RECHAZADA: "destructive",
  CANCELADA: "neutral",
};

const LOAN_VARIANT: Record<LoanStatus, Variant> = {
  ACTIVO: "info",
  FINALIZADO: "neutral",
};

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  return <Badge variant={EQUIPMENT_VARIANT[status]}>{EQUIPMENT_STATUS_LABEL[status]}</Badge>;
}

export function RequestStatusBadge({ status }: { status: LoanRequestStatus }) {
  return <Badge variant={REQUEST_VARIANT[status]}>{REQUEST_STATUS_LABEL[status]}</Badge>;
}

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  return <Badge variant={LOAN_VARIANT[status]}>{LOAN_STATUS_LABEL[status]}</Badge>;
}

export function OverdueBadge() {
  return (
    <Badge variant="destructive">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Vencido
    </Badge>
  );
}
