interface EquipmentDetailPageProps {
  params: { id: string };
}

export default function EquipmentDetailPage({ params }: EquipmentDetailPageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Detalle del Equipo</h1>
      <p className="text-muted-foreground mt-2">
        Equipo ID: {params.id} — Detalle y edición (por implementar)
      </p>
    </div>
  );
}
