interface EquipmentHistoryPageProps {
  params: { id: string };
}

export default function EquipmentHistoryPage({ params }: EquipmentHistoryPageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Historial del Equipo</h1>
      <p className="text-muted-foreground mt-2">
        Equipo ID: {params.id} — Historial de eventos (por implementar)
      </p>
    </div>
  );
}
