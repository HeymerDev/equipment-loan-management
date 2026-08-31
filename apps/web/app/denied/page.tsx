import Link from "next/link";

export default function DeniedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-destructive">Acceso Denegado</h1>
        <p className="text-muted-foreground">
          No tiene permisos para acceder a esta sección.
        </p>
        <Link
          href="/login"
          className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    </div>
  );
}
