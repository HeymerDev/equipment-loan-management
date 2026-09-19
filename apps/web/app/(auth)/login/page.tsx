"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Laptop, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { parseApiError } from "@/lib/api-error";
import { useAuth } from "@/lib/auth";
import { landingPath } from "@/lib/routes";

interface LoginPageProps {
  searchParams: { redirect?: string | string[] };
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const router = useRouter();
  const { status, user, login } = useAuth();
  const redirect = typeof searchParams.redirect === "string" ? searchParams.redirect : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Una sesión restaurada (cookie vigente) no necesita volver a iniciar sesión.
  useEffect(() => {
    if (status === "authenticated" && user) router.replace(landingPath(user.role, redirect));
  }, [status, user, redirect, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Ingresa tu correo y tu contraseña.");
      return;
    }

    setSubmitting(true);
    try {
      const signedIn = await login(email.trim(), password);
      router.replace(landingPath(signedIn.role, redirect));
    } catch (err) {
      // La API responde el mismo mensaje sin importar qué dato falló (Req 7.7).
      setError(parseApiError(err).message);
      setSubmitting(false);
    }
  }

  const checkingSession = status === "loading" || status === "authenticated";

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Laptop className="h-6 w-6" aria-hidden />
          Préstamo de equipos
        </div>
        <div className="max-w-md space-y-3">
          <p className="text-3xl font-semibold leading-tight">
            Los equipos de la institución, siempre a la mano del aula.
          </p>
          <p className="text-primary-foreground/70">
            Solicita laptops, proyectores y tablets, sigue el estado de tus préstamos y
            registra cada devolución.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">Uso exclusivo del personal docente y administrativo.</p>
      </aside>

      <main className="flex items-center justify-center bg-muted/40 p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 font-semibold lg:hidden">
              <Laptop className="h-5 w-5" aria-hidden />
              Préstamo de equipos
            </div>
            <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
            <CardDescription>Ingresa con tu correo institucional.</CardDescription>
          </CardHeader>
          <CardContent>
            {checkingSession ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Verificando sesión…
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <FormField id="email" label="Correo electrónico">
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@colegio.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    autoFocus
                  />
                </FormField>
                <FormField id="password" label="Contraseña">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  {submitting ? "Ingresando…" : "Ingresar"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
