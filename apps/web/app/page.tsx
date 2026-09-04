import { redirect } from "next/navigation";

/**
 * Ruta raíz: redirige al login.
 * El middleware protegerá las rutas autenticadas.
 */
export default function RootPage() {
  redirect("/login");
}
