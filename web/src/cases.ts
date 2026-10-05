import { useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useAlive } from "./resource";
import { isCaseRecord } from "./caseResponses";
import type { SecurityEvent } from "./operations";

export type ReviewCase = {
  id: string;
  title: string;
  summary: string;
  responsible: string;
  status: "open" | "closed";
  version: number;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  createdBy: string;
  closedAt: string | null;
  closureReason: string;
};
export type CasePage<T> = { items: T[]; nextCursor: string };
export type CaseAction = "note" | "close" | "reopen";
export type CaseActivityEntry = {
  id: string;
  caseId: string;
  version: number;
  action:
    | "created"
    | "updated"
    | "noted"
    | "closed"
    | "reopened"
    | "event_attached"
    | "event_retracted";
  reason: string;
  actorId: string;
  actor: string;
  occurredAt: string;
  before: ReviewCase | null;
  after: ReviewCase;
};
export type CaseEventEvidence = {
  id: string;
  caseId: string;
  eventId: string;
  reason: string;
  status: "attached" | "retracted";
  attachedBy: string;
  attachedById: string;
  attachedAt: string;
  retractedBy: string;
  retractedById: string;
  retractedAt: string | null;
  retractionReason: string;
  event: SecurityEvent;
};
export type CaseActionResult = {
  case: ReviewCase;
  activity: CaseActivityEntry;
};
export type CaseEvidenceResult = {
  case: ReviewCase;
  evidence: CaseEventEvidence;
};

export const caseStatusLabels = { open: "Açık", closed: "Kapalı" };
export const caseActivityLabels: Record<CaseActivityEntry["action"], string> = {
  created: "Dosya oluşturuldu",
  updated: "Dosya bilgileri düzenlendi",
  noted: "İnceleme notu eklendi",
  closed: "Dosya gerekçeyle kapatıldı",
  reopened: "Dosya gerekçeyle yeniden açıldı",
  event_attached: "Kaynak olayı iliştirildi",
  event_retracted: "Olay ilişkisi geri alındı",
};
export const caseActionLabels: Record<CaseAction, string> = {
  note: "İnceleme notu ekle",
  close: "Dosyayı kapat",
  reopen: "Dosyayı yeniden aç",
};
export function validCaseText(value: string, min: number, max: number) {
  const length = Array.from(value.trim()).length;
  return length >= min && length <= max;
}
export const demoCases: ReviewCase[] = [
  {
    id: "d35a8ae9-c5bc-48d5-920e-390d1acba99d",
    title: "Örnek erişim incelemesi",
    summary:
      "Kaynak olaylarının elle değerlendirilmesi için kurgusal inceleme dosyası.",
    responsible: "Örnek inceleme ekibi",
    status: "open",
    version: 1,
    createdAt: "2026-10-03T09:00:00Z",
    updatedAt: "2026-10-03T09:00:00Z",
    createdById: "demo-analyst",
    createdBy: "Örnek analist",
    closedAt: null,
    closureReason: "",
  },
];

// A form keeps the version it was opened with. Background refreshes never
// silently adopt a newer write version or clear the analyst's draft.
export function useCaseDraft(
  current: ReviewCase,
  demo: boolean,
  onSessionExpired: () => void,
  onChanged: (value: ReviewCase) => void,
) {
  const [baseline, setBaseline] = useState(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const alive = useAlive();
  const needsReload = conflict || current.version !== baseline.version;
  function fail(failure: unknown) {
    if (!alive.current) return;
    if (
      failure instanceof ApiError &&
      (failure.status === 401 || failure.status === 403)
    ) {
      onSessionExpired();
      return;
    }
    if (
      failure instanceof ApiError &&
      (failure.status === 409 || failure.status === 404)
    )
      setConflict(true);
    setError(
      `${(failure as Error).message || "İşlem tamamlanamadı."} Taslağınız korundu.`,
    );
  }
  async function reload() {
    if (demo || lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const value = await api<ReviewCase>(
        `/cases/${encodeURIComponent(baseline.id)}`,
        "GET",
        undefined,
        (result) => isCaseRecord(result) && result.id === baseline.id,
      );
      if (!alive.current) return;
      setBaseline(value);
      setConflict(false);
      setNotice(
        "Güncel dosya yüklendi. Yazdığınız alanlar korunuyor; aşağıdaki sürümü inceleyerek devam edin.",
      );
      onChanged(value);
    } catch (failure) {
      fail(failure);
    } finally {
      if (alive.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function run(write: (baseline: ReviewCase) => Promise<ReviewCase>) {
    if (demo || lock.current || needsReload) return false;
    lock.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const value = await write(baseline);
      if (!alive.current) return false;
      onChanged(value);
      return true;
    } catch (failure) {
      fail(failure);
      return false;
    } finally {
      if (alive.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  return {
    baseline,
    pending,
    error,
    setError,
    needsReload,
    notice,
    reload,
    run,
  };
}
