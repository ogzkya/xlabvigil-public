import { useState } from "react";
import { Download } from "lucide-react";
import { ApiError } from "./api";
import { isRecord } from "./responseShape";

export type ExportResult = { ok: true; fileName: string } | { ok: false; message: string };

function fileNameFrom(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  const name = match?.[1]?.trim();
  return name && /^[\w.-]+\.csv$/.test(name) ? name : fallback;
}

// Exports are produced and audited by the server; the browser only saves the
// returned file. A failed export never falls back to the rows on screen.
export async function downloadExport(path: string): Promise<ExportResult> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) {
    let message = "Dışa aktarım tamamlanamadı.";
    let code = "request_failed";
    try {
      const body: unknown = await response.json();
      if (isRecord(body)) {
        if (typeof body.message === "string" && body.message) message = body.message;
        if (typeof body.code === "string") code = body.code;
      }
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(response.status, code, message);
  }
  const type = response.headers.get("Content-Type") || "";
  if (!type.startsWith("text/csv")) {
    throw new ApiError(response.status, "invalid_response", "Sunucudan CSV dosyası alınamadı.");
  }
  const blob = await response.blob();
  const fileName = fileNameFrom(response.headers.get("Content-Disposition"), "vigil-disa-aktarim.csv");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, fileName };
}

export default function ExportButton({
  path,
  demo,
  disabled = false,
  label = "CSV dışa aktar",
  onSessionExpired,
  onResult,
}: {
  path: string;
  demo: boolean;
  disabled?: boolean;
  label?: string;
  onSessionExpired: () => void;
  onResult: (result: ExportResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      onResult(await downloadExport(path));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onResult({ ok: false, message: (error as Error).message || "Dışa aktarım tamamlanamadı." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className="btn secondary"
      type="button"
      disabled={demo || disabled || busy}
      aria-busy={busy}
      title={demo ? "Kurgusal örnekte dışa aktarma kapalıdır." : "Uygulanan filtrelerle CSV indirir; işlem günlüğüne yazılır."}
      onClick={() => void run()}
    >
      <Download size={16} />
      {busy ? "Hazırlanıyor…" : label}
    </button>
  );
}
