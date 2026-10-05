import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link2, Search } from "lucide-react";
import { api } from "./api";
import {
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  PageNavigation,
  SuccessNotice,
} from "./components";
import FormModal from "./FormModal";
import { CaseDraftFeedback } from "./CaseActivity";
import {
  isCaseEvidencePageForCase,
  isCaseEvidenceWriteResult,
} from "./caseResponses";
import { useCaseDraft, validCaseText } from "./cases";
import type {
  CaseEventEvidence,
  CaseEvidenceResult,
  CasePage,
  ReviewCase,
} from "./cases";
import { useListSearch } from "./listSearch";
import { useResource } from "./resource";
import { isEventPageResponse } from "./responseShape";
import {
  categoryLabels,
  severityLabels,
  severityTone,
  timestamp,
} from "./operations";
import type { SecurityEvent } from "./operations";

type CaseEvidenceProps = {
  record: ReviewCase;
  demo: boolean;
  onSessionExpired: () => void;
  refreshToken: number;
  onChanged: (value: ReviewCase) => void;
  writeBlocked: boolean;
};
function EventContext({ event }: { event: SecurityEvent }) {
  return (
    <div className="case-event-context">
      <div className="case-section-heading">
        <strong>{event.title}</strong>
        <Badge tone={severityTone[event.severity]}>
          {severityLabels[event.severity]}
        </Badge>
      </div>
      {event.summary && <p>{event.summary}</p>}
      <dl className="case-facts">
        <div>
          <dt>Kategori</dt>
          <dd>{categoryLabels[event.category]}</dd>
        </div>
        <div>
          <dt>Kaynak ürünü</dt>
          <dd>{event.originProduct || "Belirtilmedi"}</dd>
        </div>
        <div>
          <dt>Kaynak kayıt kimliği</dt>
          <dd>{event.externalId}</dd>
        </div>
        <div>
          <dt>Olay zamanı (UTC)</dt>
          <dd>{timestamp(event.occurredAt)}</dd>
        </div>
        <div>
          <dt>Alınma zamanı (UTC)</dt>
          <dd>{timestamp(event.receivedAt)}</dd>
        </div>
        <div>
          <dt>Kimlik bağlamı</dt>
          <dd>
            {event.identityState === "candidate"
              ? "Aday varlık ilişkisi; doğrulanmadı"
              : "Varlıkla eşleştirilmedi"}
          </dd>
        </div>
      </dl>
      <details>
        <summary>Hesap ve cihaz bağlamını göster</summary>
        <dl className="case-facts">
          <div>
            <dt>Hesap / özne</dt>
            <dd>{event.subject || "Belirtilmedi"}</dd>
          </div>
          <div>
            <dt>Cihaz</dt>
            <dd>{event.device || "Belirtilmedi"}</dd>
          </div>
          <div>
            <dt>Kaynak IP</dt>
            <dd>{event.sourceIp || "Belirtilmedi"}</dd>
          </div>
          <div>
            <dt>Özgün olay kimliği</dt>
            <dd>{event.originEventId || "Belirtilmedi"}</dd>
          </div>
        </dl>
      </details>
      <p className="field-help">
        Manuel içe aktarım kaydıdır; kaynak, kimlik veya tehdit doğrulaması
        anlamına gelmez.
      </p>
    </div>
  );
}

export default function CaseEvidence({
  record,
  demo,
  onSessionExpired,
  refreshToken,
  onChanged,
  writeBlocked,
}: CaseEvidenceProps) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [retracting, setRetracting] = useState<CaseEventEvidence | null>(null);
  const [notice, setNotice] = useState("");
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const resource = useResource<CasePage<CaseEventEvidence>>(
    `/cases/${encodeURIComponent(record.id)}/event-evidence?${params}`,
    demo,
    { items: [], nextCursor: "" },
    onSessionExpired,
    (value) => isCaseEvidencePageForCase(value, record.id),
  );
  const identity = useRef({ version: record.version, refreshToken });
  function firstPage() {
    setHistory([]);
    if (cursor) setCursor("");
    else void resource.refresh();
  }
  useEffect(() => {
    if (
      identity.current.version === record.version &&
      identity.current.refreshToken === refreshToken
    )
      return;
    identity.current = { version: record.version, refreshToken };
    firstPage();
  }, [record.version, refreshToken]);
  const ready = resource.matchesRequest && !resource.loading && !resource.error;
  const items = resource.data?.items || [];
  function changed(value: ReviewCase) {
    onChanged(value);
    firstPage();
  }
  return (
    <section
      className="case-section"
      aria-label="Dosyaya iliştirilen kaynak olayları"
    >
      <div className="case-section-heading">
        <h3>
          <Link2 size={18} aria-hidden="true" /> İliştirilen kaynak olayları
        </h3>
        {!demo && record.status === "open" && (
          <button
            className="btn secondary"
            type="button"
            disabled={writeBlocked || !ready}
            onClick={() => setAttaching(true)}
          >
            Olay seç ve iliştir
          </button>
        )}
      </div>
      <p className="field-help">
        İlişki, olayın bu incelemede insan tarafından ilgili bulunduğunu
        gösterir. Kimlik eşleşmesini veya tehdidi doğrulamaz; varlık, grup ve
        üyelik kaydı değişmez.
      </p>
      {record.status === "closed" && (
        <p className="field-help">
          Dosya kapalı; olay ilişkilerini değiştirmek için önce dosyayı
          gerekçeyle yeniden açın.
        </p>
      )}
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {resource.loading || !resource.matchesRequest ? (
        <Loading label="Dosyanın olay ilişkileri yükleniyor…" />
      ) : resource.error ? (
        <LoadError
          title="Olay ilişkileri alınamadı"
          message={resource.error}
          onRetry={() => void resource.refresh()}
        />
      ) : items.length ? (
        <ul className="case-evidence-list">
          {items.map((item) => (
            <li key={item.id}>
              <Badge tone={item.status === "attached" ? "neutral" : "slate"}>
                {item.status === "attached" ? "İliştirildi" : "Geri alındı"}
              </Badge>
              <EventContext event={item.event} />
              <strong>İliştirme gerekçesi</strong>
              <p className="case-reason">{item.reason}</p>
              <p className="case-meta">
                {item.attachedBy} · {timestamp(item.attachedAt)}
              </p>
              {item.retractedAt ? (
                <div className="case-snapshot">
                  <strong>Geri alma gerekçesi</strong>
                  <p className="case-reason">{item.retractionReason}</p>
                  <p className="case-meta">
                    {item.retractedBy} · {timestamp(item.retractedAt)}
                  </p>
                </div>
              ) : (
                !demo &&
                record.status === "open" && (
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={writeBlocked || !ready}
                    onClick={() => setRetracting(item)}
                  >
                    İlişkiyi gerekçeyle geri al
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title={
            demo
              ? "Kurgusal dosyada iliştirilmiş olay yok"
              : "Henüz kaynak olayı iliştirilmedi"
          }
        >
          {demo
            ? "Kurgusal önizleme salt okunurdur; olay ilişkisi eklenemez. Boş liste tehdit veya risk bulunmadığını göstermez."
            : "İlgili olayı elle seçip gerekçeyle dosyaya iliştirin. Boş liste, tehdit veya risk bulunmadığını göstermez."}
        </Empty>
      )}
      {ready && (
        <PageNavigation
          page={history.length + 1}
          count={items.length}
          caption="Sayı bu sayfadaki ilişkiler içindir; toplam değildir."
          previousDisabled={!history.length}
          nextDisabled={demo || !resource.data?.nextCursor}
          onPrevious={() => {
            setCursor(history.at(-1) || "");
            setHistory((values) => values.slice(0, -1));
          }}
          onNext={() => {
            setHistory((values) => [...values, cursor]);
            setCursor(resource.data!.nextCursor);
          }}
        />
      )}
      {attaching && (
        <CaseEvidenceForm
          record={record}
          demo={demo}
          onSessionExpired={onSessionExpired}
          refreshToken={refreshToken}
          onChanged={changed}
          writeBlocked={writeBlocked || !ready}
          onClose={() => setAttaching(false)}
          onSaved={() => {
            setAttaching(false);
            setNotice(
              "Kaynak olayı gerekçeyle iliştirildi; doğrulama sonucu oluşturulmadı.",
            );
          }}
        />
      )}
      {retracting && (
        <CaseEvidenceForm
          evidence={
            items.find((item) => item.id === retracting.id) || retracting
          }
          record={record}
          demo={demo}
          onSessionExpired={onSessionExpired}
          refreshToken={refreshToken}
          onChanged={changed}
          writeBlocked={writeBlocked || !ready}
          onClose={() => setRetracting(null)}
          onSaved={() => {
            setRetracting(null);
            setNotice(
              "Olay ilişkisi geri alındı; önceki gerekçe ve geçmiş saklandı.",
            );
          }}
        />
      )}
    </section>
  );
}

function CaseEvidenceForm({
  record,
  evidence,
  demo,
  onSessionExpired,
  onChanged,
  onClose,
  onSaved,
  writeBlocked,
}: CaseEvidenceProps & {
  evidence?: CaseEventEvidence;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<SecurityEvent | null>(
    evidence?.event || null,
  );
  const [reason, setReason] = useState("");
  const draft = useCaseDraft(record, demo, onSessionExpired, onChanged);
  const allowed =
    draft.baseline.status === "open" &&
    (!evidence || evidence.status === "attached");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writeBlocked || !allowed || !selected) return;
    if (!validCaseText(reason, 10, 1000)) {
      draft.setError("İlişki gerekçesi 10–1000 karakter olmalıdır.");
      return;
    }
    const success = await draft.run(async (baseline) => {
      const path = `/cases/${encodeURIComponent(baseline.id)}/event-evidence${evidence ? `/${encodeURIComponent(evidence.id)}/retract` : ""}`;
      const result = await api<CaseEvidenceResult>(
        path,
        "POST",
        {
          reason: reason.trim(),
          expectedVersion: baseline.version,
          ...(!evidence ? { eventId: selected.id } : {}),
        },
        (value) =>
          isCaseEvidenceWriteResult(value, baseline.id, baseline.version) &&
          value.evidence.eventId === selected.id &&
          (evidence
            ? value.evidence.id === evidence.id &&
              value.evidence.status === "retracted"
            : value.evidence.status === "attached"),
      );
      return result.case;
    });
    if (success) onSaved();
  }
  return (
    <FormModal
      title={
        evidence ? "Olay ilişkisini geri al" : "Kaynak olayını dosyaya iliştir"
      }
      subtitle={`Esas alınan dosya · Sürüm ${draft.baseline.version}`}
      onClose={onClose}
      closeDisabled={draft.pending}
      wide
      hasUnsavedChanges={!evidence && !!selected}
    >
      {(requestClose) => (
        <form
          className="editor-form"
          onSubmit={(event) => void submit(event)}
          aria-busy={draft.pending}
        >
          <fieldset disabled={draft.pending}>
            {!evidence && (
              <EventPicker
                onSessionExpired={onSessionExpired}
                selected={selected}
                onSelect={setSelected}
                disabled={draft.pending || draft.needsReload || !allowed}
              />
            )}
            {selected && <EventContext event={selected} />}
            <label>
              {evidence ? "Geri alma gerekçesi" : "İliştirme gerekçesi"}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={10}
                maxLength={2000}
                rows={4}
              />
              <span className="field-help">
                10–1000 karakter. Kaynak olayı silinmez; dosya ilişkisi ve
                gerekçeler geçmişte saklanır.
              </span>
            </label>
            {writeBlocked && (
              <FormError>
                Güncel dosya ve ilişkiler alınana kadar gönderme durduruldu;
                taslak korunuyor.
              </FormError>
            )}
            {!allowed && (
              <FormError>
                Güncel durum bu ilişki işlemine izin vermiyor. Taslağınız
                korundu.
              </FormError>
            )}
            <CaseDraftFeedback draft={draft} />
          </fieldset>
          <footer className="modal-actions">
            <button
              className="btn secondary"
              type="button"
              disabled={draft.pending}
              onClick={requestClose}
            >
              Vazgeç
            </button>
            <button
              className="btn primary"
              type="submit"
              disabled={
                demo ||
                writeBlocked ||
                draft.pending ||
                draft.needsReload ||
                !allowed ||
                !selected
              }
            >
              {draft.pending
                ? "Kaydediliyor…"
                : evidence
                  ? "Gerekçeyle geri al"
                  : "Gerekçeyle iliştir"}
            </button>
          </footer>
        </form>
      )}
    </FormModal>
  );
}

function EventPicker({
  onSessionExpired,
  selected,
  onSelect,
  disabled,
}: {
  onSessionExpired: () => void;
  selected: SecurityEvent | null;
  onSelect: (event: SecurityEvent | null) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const search = useListSearch(query, false, () => {
    setCursor("");
    setHistory([]);
  });
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (search.submittedSearch) params.set("q", search.submittedSearch);
  const resource = useResource<CasePage<SecurityEvent>>(
    `/events?${params}`,
    false,
    { items: [], nextCursor: "" },
    onSessionExpired,
    isEventPageResponse,
  );
  const ready =
    resource.matchesRequest &&
    !resource.loading &&
    !resource.error &&
    !search.invalid &&
    !search.pending;
  const items = resource.data?.items || [];
  return (
    <div className="case-event-picker">
      <label>
        <Search size={16} aria-hidden="true" /> Kaynak olaylarında ara
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          placeholder="Başlık, hesap veya kaynak kaydı · en az 3 karakter"
          maxLength={240}
          autoComplete="off"
        />
      </label>
      {selected && (
        <button
          className="btn secondary"
          type="button"
          disabled={disabled}
          onClick={() => onSelect(null)}
        >
          Olay seçimini kaldır
        </button>
      )}
      {search.invalid ? (
        <p className="field-help" role="status">
          Arama için 3–120 karakter kullanın veya alanı temizleyin.
        </p>
      ) : search.pending ? (
        <Loading label="Olay araması hazırlanıyor…" />
      ) : resource.loading || !resource.matchesRequest ? (
        <Loading label="Seçilebilen kaynak olayları yükleniyor…" />
      ) : resource.error ? (
        <LoadError
          title="Kaynak olayları alınamadı"
          message={resource.error}
          onRetry={() => void resource.refresh()}
        />
      ) : items.length ? (
        <ul className="case-picker-list">
          {items.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{event.title}</strong>
                <span className="case-meta">
                  {event.originProduct || "Kaynak belirtilmedi"} ·{" "}
                  {event.externalId} · {timestamp(event.occurredAt)}
                </span>
              </div>
              <button
                className="btn secondary"
                type="button"
                disabled={disabled}
                aria-pressed={selected?.id === event.id}
                onClick={() => onSelect(event)}
              >
                {selected?.id === event.id ? "Seçildi" : "Bu olayı seç"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Seçilebilen olay bulunamadı">
          Aramayı değiştirin veya Olaylar sayfasında kaynağınızdan alınmış
          kayıtları içe aktarın.
        </Empty>
      )}
      {ready && (
        <PageNavigation
          page={history.length + 1}
          count={items.length}
          caption="Tüm aktarılmış olaylar sunucuda aranır; iliştirme elle yapılır."
          previousDisabled={disabled || !history.length}
          nextDisabled={disabled || !resource.data?.nextCursor}
          onPrevious={() => {
            setCursor(history.at(-1) || "");
            setHistory((values) => values.slice(0, -1));
          }}
          onNext={() => {
            setHistory((values) => [...values, cursor]);
            setCursor(resource.data!.nextCursor);
          }}
        />
      )}
    </div>
  );
}
