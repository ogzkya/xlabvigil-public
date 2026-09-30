import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ClipboardCheck, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { api, ApiError } from "./api";
import { Badge, FormError, InlineError, SuccessNotice } from "./components";
import { useAlive, useResource } from "./resource";
import { isLatestReviewResponse, isMembershipRecord, isMembershipReviewResult } from "./responseShape";
import { utcToday } from "./types";
import { formatTimestampUTC } from "./dateTime";
import type { Membership, MembershipReviewDecision, MembershipReviewRecord, MembershipReviewResult } from "./types";

type LatestReviewResponse = { review: MembershipReviewRecord | null };

type MembershipReviewProps = {
  membership: Membership;
  demo: boolean;
  onSessionExpired: () => void;
  onMembershipChanged: (updated: Membership) => void;
  onPendingChange: (pending: boolean) => void;
  onDraftChange: (hasDraft: boolean) => void;
  writeBlocked?: boolean;
};
type PendingAction = "" | "submit" | "reload";

function tomorrowUTC() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function canonicalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default function MembershipReview(props: MembershipReviewProps) {
  // A refreshed version must preserve the analyst's in-progress decision.
  return <ReviewForMembership key={`${props.demo}:${props.membership.id}`} {...props} />;
}

function ReviewForMembership({
  membership,
  demo,
  onSessionExpired,
  onMembershipChanged,
  onPendingChange,
  onDraftChange,
  writeBlocked = false,
}: MembershipReviewProps) {
  const [opened, setOpened] = useState(false);
  const [baseline, setBaseline] = useState(membership);
  const [decision, setDecision] = useState<MembershipReviewDecision | "">("");
  const [reason, setReason] = useState("");
  const [nextReviewOn, setNextReviewOn] = useState("");
  const [pending, setPending] = useState<PendingAction>("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState("");
  const headingId = useId();
  const formId = useId();
  const decisionId = useId();
  const reasonId = useId();
  const reasonHelpId = useId();
  const dateId = useId();
  const dateHelpId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const baselineRef = useRef<HTMLHeadingElement>(null);
  const decisionRef = useRef<HTMLSelectElement>(null);
  const pendingRef = useRef<PendingAction>("");
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const alive = useAlive();
  const latest = useResource<LatestReviewResponse>(
    `/memberships/${encodeURIComponent(membership.id)}/reviews/latest`,
    demo,
    { review: null },
    onSessionExpired,
    isLatestReviewResponse,
  );
  const displayedVersion = useRef(membership.version);
  useEffect(() => {
    if (displayedVersion.current !== membership.version) {
      displayedVersion.current = membership.version;
      void latest.refresh();
    }
  }, [membership.version, latest.refresh]);
  const snapshot = opened ? baseline : membership;
  const today = utcToday();
  const canContinue = snapshot.endsOn > today;
  const closed = snapshot.status === "closed" || membership.status === "closed";
  const hasDraft = decision !== "" || reason !== "" || nextReviewOn !== "";
  const changedWhileEditing = opened && membership.version !== baseline.version;
  const reloadNeeded = conflict || unavailable || changedWhileEditing;
  const reasonLength = Array.from(reason.trim()).length;
  const nextDay = tomorrowUTC();
  const minimumReviewOn = snapshot.startsOn > nextDay ? snapshot.startsOn : nextDay;

  useEffect(() => {
    if (opened) decisionRef.current?.focus();
  }, [opened]);
  useEffect(() => onDraftChange(hasDraft), [hasDraft, onDraftChange]);
  useEffect(() => () => pendingCallback.current(false), []);

  function beginPending(action: Exclude<PendingAction, "">) {
    if (pendingRef.current) return false;
    pendingRef.current = action;
    setPending(action);
    pendingCallback.current(true);
    return true;
  }

  function finishPending() {
    if (!alive.current) return;
    pendingRef.current = "";
    setPending("");
    pendingCallback.current(false);
  }

  function openForm() {
    if (demo || pendingRef.current || (membership.status === "closed" && !hasDraft)) return;
    if (!hasDraft) {
      setBaseline(membership);
      setError("");
      setConflict(false);
      setUnavailable(false);
      setNotice("");
    }
    setOpened(true);
  }

  function hideForm() {
    if (pendingRef.current) return;
    setOpened(false);
    headingRef.current?.focus();
  }

  function discardForm() {
    if (pendingRef.current) return;
    setOpened(false);
    setDecision("");
    setReason("");
    setNextReviewOn("");
    setError("");
    setConflict(false);
    setUnavailable(false);
    setNotice("");
    headingRef.current?.focus();
  }

  function requestFailed(failure: unknown) {
    if (!alive.current) return;
    if (failure instanceof ApiError && failure.status === 401) {
      onSessionExpired();
      return;
    }
    if (failure instanceof ApiError && failure.code === "review_period_ended") {
      setError("Üyelik süresi yeni bir gözden geçirme tarihi için yeterli değil. Kapatma kararı seçebilir veya formu kapatıp üyelik tarihlerini düzenleyebilirsiniz. Gerekçe taslağınız korundu.");
      return;
    }
    if (failure instanceof ApiError && failure.status === 409) {
      setConflict(true);
      setError(`${failure.message} Karar ve gerekçe taslağınız korundu. Güncel kaydı yükleyip yeniden değerlendirin.`);
      return;
    }
    if (failure instanceof ApiError && failure.status === 404) {
      setUnavailable(true);
      setError("Üyelik kaydı alınamadı. Taslağınız korundu; kayıt yeniden yüklenene kadar karar gönderilemez.");
      return;
    }
    setError((failure as Error).message || "İşlem tamamlanamadı. Taslağınız korundu.");
  }

  async function reloadMembership() {
    if (demo || !beginPending("reload")) return;
    setError("");
    setNotice("");
    try {
      const updated = await api<Membership>(`/memberships/${encodeURIComponent(membership.id)}`, "GET", undefined, isMembershipRecord);
      if (!alive.current) return;
      setBaseline(updated);
      setConflict(false);
      setUnavailable(false);
      onMembershipChanged(updated);
      void latest.refresh();
      setNotice("Güncel kayıt yüklendi. Karar, gerekçe ve tarih taslağınız korundu; kaydı inceleyerek devam edin.");
      baselineRef.current?.focus();
    } catch (failure) {
      requestFailed(failure);
    } finally {
      finishPending();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || writeBlocked || pendingRef.current || !opened || reloadNeeded || closed) return;
    if (!decision) {
      setError("Gözden geçirme kararını seçin.");
      return;
    }
    if (reasonLength < 10 || reasonLength > 1000) {
      setError("Gözden geçirme gerekçesi 10–1000 karakter olmalıdır.");
      return;
    }
    if (decision === "continue" && (!canContinue || !canonicalDate(nextReviewOn) || nextReviewOn <= utcToday() || nextReviewOn < snapshot.startsOn || nextReviewOn > snapshot.endsOn)) {
      setError("Devam kararı için bugünden sonraki, üyeliğin başlangıç ve bitiş aralığında kalan bir UTC tarihi seçin. Uygun tarih yoksa kapatma kararı seçebilir veya üyelik tarihlerini düzenleyebilirsiniz.");
      return;
    }
    if (!beginPending("submit")) return;
    setError("");
    setNotice("");
    try {
      const result = await api<MembershipReviewResult>(
        `/memberships/${encodeURIComponent(membership.id)}/reviews`,
        "POST",
        {
          decision,
          reason: reason.trim(),
          expectedVersion: baseline.version,
          ...(decision === "continue" ? { nextReviewOn } : {}),
        },
        isMembershipReviewResult,
      );
      if (!alive.current) return;
      setBaseline(result.membership);
      // Invalidate any pre-submit read before it can replace the saved decision.
      void latest.refresh();
      onMembershipChanged(result.membership);
      setOpened(false);
      setDecision("");
      setReason("");
      setNextReviewOn("");
      setConflict(false);
      setUnavailable(false);
      setNotice(result.review.decision === "close" ? "Gözden geçirme kaydedildi ve inceleme üyeliği kapatıldı." : "Devam kararı ve sonraki gözden geçirme tarihi kaydedildi.");
      headingRef.current?.focus();
    } catch (failure) {
      requestFailed(failure);
    } finally {
      finishPending();
    }
  }

  return (
    <section className="membership-decision" aria-labelledby={headingId}>
      <div className="membership-decision-heading">
        <h3 id={headingId} ref={headingRef} tabIndex={-1}><ClipboardCheck size={18} aria-hidden="true" /> Gözden geçirme</h3>
        {hasDraft && <Badge tone="yellow">Kaydedilmemiş taslak</Badge>}
        {!demo && (!closed || opened || hasDraft) && (
          <button className="btn secondary" type="button" disabled={!!pending} aria-expanded={opened} aria-controls={formId} onClick={opened ? hideForm : openForm}>
            {opened ? "Formu kapat" : hasDraft ? "Taslağa dön" : "Gözden geçirmeyi kaydet"}
          </button>
        )}
      </div>
      <p className="field-help">Kararı ve bu değerlendirmeye ait gerekçeyi kaydedin. Mevcut üyelik gerekçesi korunur; karar etkinlik geçmişine eklenir.</p>
      {!opened && hasDraft && <p className="field-help" role="status">Karar taslağı bu pencerede korunuyor. Taslağa dönerek devam edebilirsiniz.</p>}
      <div className="membership-decision-context membership-decision-latest" aria-label="Son kaydedilmiş gözden geçirme kararı">
        <h4>Son kaydedilmiş karar</h4>
        {!latest.matchesRequest || latest.loading ? (
          <p role="status">Son karar yükleniyor…</p>
        ) : latest.error ? (
          <InlineError message="Son karar alınamadı." detail={latest.error} onRetry={() => void latest.refresh()} />
        ) : latest.data?.review ? (
          <dl>
            <div><dt>Karar</dt><dd>{latest.data.review.decision === "close" ? "Üyeliği kapat" : "İncelemeye devam et"}</dd></div>
            <div><dt>Kaydeden</dt><dd>{latest.data.review.actor}</dd></div>
            <div><dt>Zaman</dt><dd>{formatTimestampUTC(latest.data.review.reviewedAt)}</dd></div>
            <div className="membership-decision-latest-reason"><dt>Gerekçe</dt><dd>{latest.data.review.reason}</dd></div>
            {latest.data.review.nextReviewOn && <div><dt>Sonraki inceleme</dt><dd>{latest.data.review.nextReviewOn} UTC</dd></div>}
          </dl>
        ) : (
          <p>{demo ? "Kurgusal önizlemede karar kaydı yok." : "Bu üyelik için ayrı bir gözden geçirme kararı kaydedilmemiş."}</p>
        )}
      </div>
      {demo && <p className="field-help">Kurgusal önizleme salt okunurdur; gözden geçirme kararı kaydedilemez.</p>}
      {!opened && closed && <p className="field-help">Kapatılmış üyelik için yeni gözden geçirme kararı kaydedilemez.</p>}
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {opened && (
        <form id={formId} className="membership-decision-form" onSubmit={(event) => void submit(event)} aria-busy={!!pending}>
          <div className="membership-decision-context">
            <h4 ref={baselineRef} tabIndex={-1}>Esas alınan üyelik · Sürüm {baseline.version}</h4>
            <dl>
              <div><dt>Durum</dt><dd>{snapshot.status === "closed" ? "Kapatıldı" : "Açık"}</dd></div>
              <div><dt>Mevcut gözden geçirme (UTC)</dt><dd>{snapshot.reviewOn}</dd></div>
              <div><dt>Üyelik başlangıcı (UTC)</dt><dd>{snapshot.startsOn}</dd></div>
              <div><dt>Üyelik bitişi (UTC, dahil)</dt><dd>{snapshot.endsOn}</dd></div>
            </dl>
          </div>
          {closed && <div className="info-strip"><p>Üyelik kapatılmış. Taslağınız burada korunuyor; yeni karar gönderilemez.</p></div>}
          {!closed && !canContinue && <div className="info-strip"><p>Üyelik süresi, bugünden sonraki bir gözden geçirme tarihi için yeterli değil. Kapatma kararı seçebilir veya formu kapatıp üyelik tarihlerini düzenleyebilirsiniz.</p></div>}
          {changedWhileEditing && !error && <FormError>Üyelik bu form açıldıktan sonra değişti. Taslağınız korundu; güncel kaydı yükleyip tekrar inceleyin.</FormError>}
          <label htmlFor={decisionId}>Karar</label>
          <select ref={decisionRef} id={decisionId} value={decision} disabled={!!pending || closed} onChange={(event) => setDecision(event.target.value as MembershipReviewDecision | "")} required>
            <option value="" disabled>Karar seçin</option>
            <option value="continue" disabled={!canContinue}>İncelemeye devam et</option>
            <option value="close">Üyeliği kapat</option>
          </select>
          <label htmlFor={reasonId}>Gözden geçirme gerekçesi</label>
          <textarea id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} disabled={!!pending} readOnly={closed} rows={4} required aria-describedby={reasonHelpId} placeholder="Neyi değerlendirdiniz ve bu kararı neden verdiniz?" />
          <p id={reasonHelpId} className="field-help">10–1000 karakter · {reasonLength} karakter. Bu gerekçe, mevcut üyelik gerekçesinden ayrı saklanır.</p>
          {decision === "continue" && (
            <>
              <label htmlFor={dateId}>Sonraki gözden geçirme (UTC)</label>
              <input id={dateId} type="date" value={nextReviewOn} onChange={(event) => setNextReviewOn(event.target.value)} min={minimumReviewOn} max={snapshot.endsOn} disabled={!!pending || closed || !canContinue} required aria-describedby={dateHelpId} />
              <p id={dateHelpId} className="field-help">Bugünden sonraki bir UTC günü seçin. Tarih, üyeliğin başlangıcı ile bitişi arasında olmalıdır; üyelik süresi bu işlemle uzatılmaz.</p>
            </>
          )}
          {decision === "close" && <p className="field-help">Üyelik kapatılır; mevcut üyelik gerekçesi, iliştirilmiş olaylar ve işlem geçmişi saklanır. Bu karar hesap veya ağ erişimini değiştirmez.</p>}
          {error && <FormError>{error}</FormError>}
          {reloadNeeded && (
            <button className="btn secondary membership-decision-reload" type="button" disabled={!!pending} onClick={() => void reloadMembership()}>
              <RefreshCw size={16} className={pending === "reload" ? "spin" : ""} aria-hidden="true" /> {pending === "reload" ? "Güncel kayıt yükleniyor…" : "Güncel kaydı yükle"}
            </button>
          )}
          <div className="membership-decision-actions">
            <button className="btn secondary" type="button" disabled={!!pending} onClick={discardForm}>{hasDraft ? "Taslağı sil" : "Vazgeç"}</button>
            <button className="btn primary" type="submit" disabled={writeBlocked || !!pending || reloadNeeded || closed || (decision === "continue" && !canContinue)}>
              {pending === "submit" ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {pending === "submit" ? "Kaydediliyor…" : "Kararı kaydet"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
