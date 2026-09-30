import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "./api";
import CandidateEvents from "./CandidateEvents";
import {
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  PageNavigation,
  SuccessNotice,
} from "./components";
import { demoMembershipEvidence } from "./evidenceFixtures";
import {
  categoryLabels,
  severityLabels,
  severityTone,
  timestamp,
} from "./operations";
import type { SecurityEvent } from "./operations";
import { useAlive, useResource } from "./resource";
import { isMembershipEvidencePageResponse } from "./responseShape";
import type { MembershipEventEvidence } from "./types";

type EvidencePage = { items: MembershipEventEvidence[]; nextCursor: string };
type EvidencePanelProps = {
  membershipId: string;
  entityId: string;
  demo: boolean;
  onSessionExpired: () => void;
  onChanged?: () => void;
  writeBlocked?: boolean;
};

function validReason(reason: string) {
  const length = Array.from(reason.trim()).length;
  return length >= 10 && length <= 1000;
}

export default function EvidencePanel(props: EvidencePanelProps) {
  return <EvidenceForMembership key={`${props.demo}:${props.membershipId}`} {...props} />;
}

function EvidenceForMembership({
  membershipId,
  entityId,
  demo,
  onSessionExpired,
  onChanged,
  writeBlocked = false,
}: EvidencePanelProps) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);
  const [attachReason, setAttachReason] = useState("");
  const [retractingId, setRetractingId] = useState("");
  const [retractionReason, setRetractionReason] = useState("");
  const [pending, setPending] = useState<"attach" | "retract" | "">("");
  const [mutationError, setMutationError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [conflictReloading, setConflictReloading] = useState(false);
  const [duplicateEventId, setDuplicateEventId] = useState("");
  const [notice, setNotice] = useState("");
  const attachReasonId = useId();
  const retractionReasonId = useId();
  const attachReasonRef = useRef<HTMLTextAreaElement>(null);
  const retractionReasonRef = useRef<HTMLTextAreaElement>(null);
  const attachTrigger = useRef<HTMLElement | null>(null);
  const retractTrigger = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alive = useAlive();
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const path = `/memberships/${encodeURIComponent(membershipId)}/event-evidence?${params}`;
  const demoPage: EvidencePage = {
    items: demo ? demoMembershipEvidence(membershipId, entityId) : [],
    nextCursor: "",
  };
  const evidence = useResource<EvidencePage>(
    path,
    demo,
    demoPage,
    onSessionExpired,
    isMembershipEvidencePageResponse,
  );
  const items = evidence.data?.items || [];
  const ready = evidence.matchesRequest && !evidence.loading && !evidence.error;
  const duplicateSelectedEvent = !!selectedEvent && duplicateEventId === selectedEvent.id;

  useEffect(() => {
    if (selectedEvent) attachReasonRef.current?.focus();
  }, [selectedEvent?.id]);
  useEffect(() => {
    if (retractingId) retractionReasonRef.current?.focus();
  }, [retractingId]);
  useEffect(() => {
    if (!conflictReloading || evidence.loading || !evidence.matchesRequest) return;
    setConflictReloading(false);
    if (!evidence.error) {
      setConflict(false);
      setMutationError("");
    }
  }, [conflictReloading, evidence.loading, evidence.matchesRequest, evidence.error]);

  function reloadAfterConflict() {
    setConflictReloading(true);
    void evidence.refresh();
  }

  function selectEvent(event: SecurityEvent) {
    if (pending) return;
    if (selectedEvent?.id === event.id) {
      setSelectedEvent(null);
      setAttachReason("");
      setDuplicateEventId("");
      if (attachTrigger.current?.isConnected) attachTrigger.current.focus();
      else headingRef.current?.focus();
      return;
    }
    if (conflict || !ready || selectedEvent || retractingId) return;
    setMutationError("");
    setNotice("");
    setDuplicateEventId("");
    setRetractingId("");
    setRetractionReason("");
    attachTrigger.current = document.activeElement as HTMLElement | null;
    setSelectedEvent(event);
    setAttachReason("");
  }

  function selectRetraction(id: string) {
    if (pending) return;
    if (retractingId === id) {
      setRetractingId("");
      setRetractionReason("");
      if (retractTrigger.current?.isConnected) retractTrigger.current.focus();
      else headingRef.current?.focus();
      return;
    }
    if (conflict || !ready || selectedEvent || retractingId) return;
    setMutationError("");
    setNotice("");
    setSelectedEvent(null);
    setAttachReason("");
    retractTrigger.current = document.activeElement as HTMLElement | null;
    setRetractingId(id);
    setRetractionReason("");
  }

  function mutationFailed(error: unknown) {
    if (!alive.current) return;
    if (error instanceof ApiError && error.status === 401) {
      onSessionExpired();
      return;
    }
    if (error instanceof ApiError && error.status === 409) {
      setConflict(true);
      if (error.code === "evidence_duplicate" && selectedEvent) {
        setDuplicateEventId(selectedEvent.id);
      }
      setMutationError(
        `${error.message} Yazdığınız gerekçe korundu; listeyi yenileyip durumu inceleyin.`,
      );
      return;
    }
    setMutationError((error as Error).message);
  }

  function refreshAfterMutation(resetPage: boolean) {
    if (resetPage && cursor) {
      setCursor("");
      setHistory([]);
    } else {
      void evidence.refresh();
    }
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || writeBlocked || pending || conflict || !ready || !selectedEvent) return;
    if (!validReason(attachReason)) {
      setMutationError("Gerekçe 10–1000 karakter olmalıdır.");
      return;
    }
    setPending("attach");
    setMutationError("");
    setConflict(false);
    try {
      await api<unknown>(
        `/memberships/${encodeURIComponent(membershipId)}/event-evidence`,
        "POST",
        { eventId: selectedEvent.id, reason: attachReason.trim() },
      );
      if (!alive.current) return;
      headingRef.current?.focus();
      setSelectedEvent(null);
      setAttachReason("");
      setDuplicateEventId("");
      setNotice(
        "Olay incelemeye iliştirildi. Bu işlem kaynak veya kimlik doğrulaması anlamına gelmez.",
      );
      refreshAfterMutation(true);
      onChanged?.();
    } catch (error) {
      mutationFailed(error);
    } finally {
      if (alive.current) setPending("");
    }
  }

  async function retract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || writeBlocked || pending || conflict || !ready || !retractingId) return;
    if (!validReason(retractionReason)) {
      setMutationError("Geri alma gerekçesi 10–1000 karakter olmalıdır.");
      return;
    }
    setPending("retract");
    setMutationError("");
    setConflict(false);
    try {
      await api<unknown>(
        `/memberships/${encodeURIComponent(membershipId)}/event-evidence/${encodeURIComponent(retractingId)}/retract`,
        "POST",
        { reason: retractionReason.trim() },
      );
      if (!alive.current) return;
      headingRef.current?.focus();
      setRetractingId("");
      setRetractionReason("");
      setNotice("İlişki geri alındı; gerekçe ve işlem geçmişi saklandı.");
      refreshAfterMutation(false);
      onChanged?.();
    } catch (error) {
      mutationFailed(error);
    } finally {
      if (alive.current) setPending("");
    }
  }

  const mutationFeedback = mutationError && (
    <FormError>
      {mutationError}
      {conflict && (
        <button
          className="link-btn"
          type="button"
          disabled={conflictReloading}
          onClick={reloadAfterConflict}
        >
          {conflictReloading ? "Liste yenileniyor…" : "Listeyi yenile"}
        </button>
      )}
    </FormError>
  );

  return (
    <>
      <section
        className="membership-evidence"
        aria-label="İncelemeye iliştirilen kaynak olayları"
      >
        <div className="candidate-events-heading">
          <h3 className="membership-evidence-heading" ref={headingRef} tabIndex={-1}>
            İncelemeye iliştirilen kaynak olayları
          </h3>
          <span>20 kayıt / sayfa</span>
        </div>
        <p className="field-help">
          Bir analistin bu olayı inceleme kaydıyla ilgili bulduğunu gösterir. Kaynağın,
          kimliğin veya tehdidin doğrulandığını göstermez. Geri alınan ilişkiler ve
          gerekçeleri geçmişte görünür. Kapalı üyeliğe sonradan iliştirmek üyeliği
          yeniden açmaz.
        </p>
        {demo && (
          <p className="field-help membership-evidence-demo">
            Önizleme ilişkileri tümüyle kurgusaldır ve sunucuya kaydedilmez.
          </p>
        )}
        {notice && <SuccessNotice>{notice}</SuccessNotice>}
        {mutationError && !selectedEvent && !retractingId && mutationFeedback}
        {evidence.loading || !evidence.matchesRequest ? (
          <Loading label="İliştirilen olaylar yükleniyor…" />
        ) : evidence.error ? (
          <LoadError
            title="İliştirilen olaylar alınamadı"
            message={evidence.error}
            onRetry={() =>
              conflict ? reloadAfterConflict() : void evidence.refresh()
            }
          />
        ) : items.length ? (
          <ul className="membership-evidence-list">
            {items.map((item) => (
              <li className="candidate-event membership-evidence-item" key={item.id}>
                <div className="candidate-event-top">
                  {demo && <Badge tone="neutral">Kurgusal örnek</Badge>}
                  <Badge tone={item.retractedAt ? "slate" : "teal"}>
                    {item.retractedAt ? "Geri alındı" : "İliştirildi"}
                  </Badge>
                  <Badge tone={severityTone[item.event.severity]}>
                    {severityLabels[item.event.severity]}
                  </Badge>
                  <span>{categoryLabels[item.event.category]}</span>
                </div>
                <h4>{item.event.title}</h4>
                {item.event.summary && <p>{item.event.summary}</p>}
                <dl className="candidate-event-facts">
                  <div>
                    <dt>Olay zamanı</dt>
                    <dd>{timestamp(item.event.occurredAt)}</dd>
                  </div>
                  <div>
                    <dt>Alınma zamanı</dt>
                    <dd>{timestamp(item.event.receivedAt)}</dd>
                  </div>
                  <div>
                    <dt>Kaynak ürünü</dt>
                    <dd>{item.event.originProduct || "Belirtilmedi"}</dd>
                  </div>
                  <div>
                    <dt>Kaynak kayıt kimliği</dt>
                    <dd>{item.event.externalId}</dd>
                  </div>
                  <div>
                    <dt>İliştiren</dt>
                    <dd>{item.attachedBy}</dd>
                  </div>
                  <div>
                    <dt>İliştirme zamanı</dt>
                    <dd>{timestamp(item.attachedAt)}</dd>
                  </div>
                </dl>
                <div className="membership-evidence-reason">
                  <strong>Analistin iliştirme gerekçesi</strong>
                  <p>{item.reason}</p>
                </div>
                {item.retractedAt && (
                  <div className="membership-evidence-reason retracted">
                    <strong>
                      Geri alma · {item.retractedBy || "Bilinmeyen kullanıcı"} ·{" "}
                      {timestamp(item.retractedAt)}
                    </strong>
                    <p>{item.retractionReason}</p>
                  </div>
                )}
                <details className="candidate-event-more">
                  <summary>Kaynak ayrıntılarını göster</summary>
                  <dl className="candidate-event-facts">
                    <div>
                      <dt>Hesap / özne</dt>
                      <dd>{item.event.subject || "Belirtilmedi"}</dd>
                    </div>
                    <div>
                      <dt>Cihaz</dt>
                      <dd>{item.event.device || "Belirtilmedi"}</dd>
                    </div>
                    <div>
                      <dt>Kaynak IP</dt>
                      <dd>{item.event.sourceIp || "Belirtilmedi"}</dd>
                    </div>
                    <div>
                      <dt>Özgün olay kimliği</dt>
                      <dd>{item.event.originEventId || "Belirtilmedi"}</dd>
                    </div>
                    <div>
                      <dt>Bağlantı kimliği</dt>
                      <dd>{item.event.connectionId}</dd>
                    </div>
                    <div>
                      <dt>Veri kökeni</dt>
                      <dd>Manuel içe aktarım</dd>
                    </div>
                  </dl>
                </details>
                {!demo && !item.retractedAt && (
                  <div className="candidate-event-actions">
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={
                        !!pending ||
                        conflict ||
                        !ready ||
                        !!selectedEvent ||
                        (!!retractingId && retractingId !== item.id)
                      }
                      aria-expanded={retractingId === item.id}
                      onClick={() => selectRetraction(item.id)}
                    >
                      {retractingId === item.id
                        ? "Geri alma formunu kapat"
                        : "İlişkiyi geri al"}
                    </button>
                  </div>
                )}
                {retractingId === item.id && (
                  <form
                    className="evidence-reason-form"
                    onSubmit={(event) => void retract(event)}
                    aria-busy={pending === "retract"}
                  >
                    {item.retractedAt && (
                      <div className="info-strip">
                        <p>
                          Bu ilişki başka bir işlemde geri alınmış. Taslağınız burada
                          korunuyor; yukarıdaki geri alma kaydını inceleyip formu kapatın.
                        </p>
                      </div>
                    )}
                    <label htmlFor={retractionReasonId}>Geri alma gerekçesi</label>
                    <textarea
                      ref={retractionReasonRef}
                      id={retractionReasonId}
                      value={retractionReason}
                      onChange={(event) => setRetractionReason(event.target.value)}
                      disabled={!!pending}
                      readOnly={!!item.retractedAt}
                      rows={3}
                      required
                      placeholder="Bu ilişkinin neden geri alındığını yazın."
                    />
                    <p className="field-help">10–1000 karakter. Önceki ilişki ve gerekçesi silinmez.</p>
                    {mutationFeedback}
                    <div className="evidence-form-actions">
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={!!pending}
                        onClick={() => selectRetraction(item.id)}
                      >
                        Vazgeç
                      </button>
                      <button
                        className="btn primary"
                        type="submit"
                        disabled={writeBlocked || !!pending || conflict || !ready || !!item.retractedAt}
                      >
                        {pending === "retract" ? "Geri alınıyor…" : "Gerekçeyle geri al"}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title={demo ? "Önizlemede iliştirilmiş olay yok" : "Henüz olay iliştirilmedi"}>
            {demo
              ? "Örnek veriler kalıcı inceleme ilişkisi oluşturmaz."
              : "Aşağıdaki aday olaylardan ilgili olanı, analist gerekçesiyle incelemeye iliştirebilirsiniz. Boş liste, risk bulunmadığını göstermez."}
          </Empty>
        )}
        {ready && (
          <PageNavigation
            page={history.length + 1}
            count={items.length}
            caption="Sayı yalnız bu sayfadaki ilişkileri gösterir; toplam değildir."
            previousDisabled={!history.length || !!pending || conflict || !!selectedEvent || !!retractingId}
            nextDisabled={!evidence.data?.nextCursor || demo || !!pending || conflict || !!selectedEvent || !!retractingId}
            onPrevious={() => {
              setRetractingId("");
              setRetractionReason("");
              setCursor(history.at(-1) || "");
              setHistory((values) => values.slice(0, -1));
            }}
            onNext={() => {
              setRetractingId("");
              setRetractionReason("");
              setHistory((values) => [...values, cursor]);
              setCursor(evidence.data!.nextCursor);
            }}
          />
        )}
      </section>
      <CandidateEvents
        entityId={entityId}
        demo={demo}
        onSessionExpired={onSessionExpired}
        onSelectEvent={demo ? undefined : selectEvent}
        selectedEventId={selectedEvent?.id}
        selectionDisabled={!!pending || conflict || !ready || !!retractingId}
        pageNavigationDisabled={!!selectedEvent || !!pending || conflict}
        selectedAction={
          selectedEvent && (
            <form
              className="evidence-reason-form"
              onSubmit={(event) => void attach(event)}
              aria-busy={pending === "attach"}
            >
              {duplicateSelectedEvent && !conflict && (
                <div className="info-strip">
                  <p>
                    Sunucu bu olayın incelemeye zaten iliştirildiğini bildirdi. Taslağınız
                    burada korunuyor; yukarıdaki sayfalı ilişki kayıtlarını inceleyin
                    veya formu kapatın.
                  </p>
                </div>
              )}
              <label htmlFor={attachReasonId}>İliştirme gerekçesi</label>
              <textarea
                ref={attachReasonRef}
                id={attachReasonId}
                value={attachReason}
                onChange={(event) => setAttachReason(event.target.value)}
                disabled={!!pending}
                readOnly={duplicateSelectedEvent && !conflict}
                rows={3}
                required
                placeholder="Bu olayın inceleme kaydıyla ilgisini açıklayın."
              />
              <p className="field-help">
                10–1000 karakter. İliştirme kaynak, kimlik veya tehdit doğrulaması değildir.
              </p>
              {mutationFeedback}
              <div className="evidence-form-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!!pending}
                  onClick={() => selectEvent(selectedEvent)}
                >
                  Vazgeç
                </button>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={writeBlocked || !!pending || conflict || !ready || duplicateSelectedEvent}
                >
                  {pending === "attach" ? "İliştiriliyor…" : "Gerekçeyle iliştir"}
                </button>
              </div>
            </form>
          )
        }
      />
    </>
  );
}
