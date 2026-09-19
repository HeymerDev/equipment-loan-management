import axios from "axios";
import { api } from "@/lib/api";

/**
 * Con `responseType: "blob"` los errores de la API también llegan como Blob;
 * se convierten al JSON `{ error: {...} }` para que `parseApiError` los lea.
 */
async function withReadableBody(error: unknown): Promise<unknown> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await error.response.data.text()) as unknown;
    } catch {
      // Cuerpo no JSON: queda el mensaje genérico.
    }
  }
  return error;
}

/**
 * Abre el comprobante del préstamo en una pestaña nueva, en el visor del
 * navegador listo para imprimir (Req 6.2). La API exige el access token, así
 * que el PDF se descarga con el cliente autenticado y se muestra como blob.
 *
 * La pestaña se abre antes de la petición, todavía dentro del clic, para que
 * el navegador no la bloquee como ventana emergente.
 */
export async function openVoucher(loanId: string): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = "Generando comprobante…";
    tab.document.body.innerHTML =
      '<p style="font-family: system-ui, sans-serif; padding: 2rem; color: #475569">Generando comprobante…</p>';
  }

  try {
    const response = await api.get<Blob>(`/loans/${loanId}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    throw await withReadableBody(error);
  }
}
