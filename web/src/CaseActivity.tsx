import { useEffect, useId, useRef, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import {
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  PageNavigation,
  SuccessNotice,
} from "./components";
import { useResource } from "./resource";
import { formatTimestampUTC } from "./dateTime";
import { isCaseActivityPageForCase } from "./caseResponses";
import { caseActivityLabels, caseStatusLabels } from "./cases";
import type {
  CaseActivityEntry,
  CasePage,
  ReviewCase,
  useCaseDraft,
} from "./cases";

export function CaseSnapshot({
  record,
  caption,
}: {
  record: ReviewCase;
  caption: string;
}) {
  return (
    <div className="case-snapshot">
      <strong>
        {caption} · Sürüm {record.version}
      </strong>
      <dl className="case-facts">
        <div>
          <dt>Başlık</dt>
          <dd>{record.title}</dd>
        </div>
        <div>
          <dt>Sorumlu</dt>
          <dd>{record.responsible}</dd>
        </div>
        <div>
          <dt>Durum</dt>
          <dd>{caseStatusLabels[record.status]}</dd>
        </div>
        <div className="case-facts-wide">
          <dt>İnceleme özeti</dt>
          <dd>{record.summary}</dd>
        </div>
        {record.closureReason && (
          <div className="case-facts-wide">
            <dt>Kapatma gerekçesi</dt>
            <dd>{record.closureReason}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
export function CaseDraftFeedback({
  draft,
}: {
  draft: ReturnType<typeof useCaseDraft>;
}) {
  return (
    <>
      {draft.error && <FormError>{draft.error}</FormError>}
      {draft.needsReload && (
        <div className="info-strip" role="status">
          <div>
            <p>Dosyanın güncel durumu incelenmeden taslak gönderilemez.</p>
            <button
              className="btn secondary"
              type="button"
              disabled={draft.pending}
              onClick={() => void draft.reload()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {draft.pending ? "Dosya yükleniyor…" : "Güncel dosyayı yükle"}
            </button>
          </div>
        </div>
      )}
      {draft.notice && (
        <>
          <SuccessNotice>{draft.notice}</SuccessNotice>
          <CaseSnapshot
            record={draft.baseline}
            caption="Açık isteğinizle yüklenen dosya"
          />
        </>
      )}
    </>
  );
}

export default function CaseActivity({
  record,
  demo,
  onSessionExpired,
  refreshToken,
}: {
  record: ReviewCase;
  demo: boolean;
  onSessionExpired: () => void;
  refreshToken: number;
}) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const headingId = useId();
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const fixture: CaseActivityEntry = {
    id: "demo-case-created",
    caseId: record.id,
    version: 1,
    action: "created",
    reason: "",
    actorId: record.createdById,
    actor: record.createdBy,
    occurredAt: record.createdAt,
    before: null,
    after: {
      ...record,
      version: 1,
      status: "open",
      closedAt: null,
      closureReason: "",
      updatedAt: record.createdAt,
    },
  };
  const resource = useResource<CasePage<CaseActivityEntry>>(
    `/cases/${encodeURIComponent(record.id)}/activity?${params}`,
    demo,
    { items: [fixture], nextCursor: "" },
    onSessionExpired,
    (value) => isCaseActivityPageForCase(value, record.id),
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
  return (
    <section className="case-section" aria-labelledby={headingId}>
      <div className="case-section-heading">
        <h3 id={headingId}>
          <History size={18} aria-hidden="true" /> Dosya etkinlikleri
        </h3>
        <button
          className="btn secondary"
          type="button"
          disabled={resource.loading || !resource.matchesRequest}
          onClick={firstPage}
        >
          <RefreshCw
            size={15}
            className={resource.loading ? "spin" : ""}
            aria-hidden="true"
          />{" "}
          Yenile
        </button>
      </div>
      <p className="field-help">
        İşlem sırası, işlem anındaki kullanıcı adı ve gerekçeler saklanır. Dosya
        kararları varlık veya ağ erişimini değiştirmez.
      </p>
      {resource.loading || !resource.matchesRequest ? (
        <Loading label="Dosya etkinlikleri yükleniyor…" />
      ) : resource.error ? (
        <LoadError
          title="Dosya etkinlikleri alınamadı"
          message={resource.error}
          onRetry={() => void resource.refresh()}
        />
      ) : items.length ? (
        <ol className="case-activity-list">
          {items.map((entry) => (
            <li key={entry.id}>
              <div className="case-section-heading">
                <h4>{caseActivityLabels[entry.action]}</h4>
                <Badge tone="neutral">Sürüm {entry.version}</Badge>
              </div>
              <p className="case-meta">
                {entry.actor || "Ad bilgisi bulunmuyor"} ·{" "}
                <time dateTime={entry.occurredAt}>
                  {formatTimestampUTC(entry.occurredAt)}
                </time>
              </p>
              {demo && <Badge tone="neutral">Kurgusal örnek</Badge>}
              {entry.reason && <p className="case-reason">{entry.reason}</p>}
              <details>
                <summary>İşlem anındaki dosya bilgileri</summary>
                {entry.before && (
                  <CaseSnapshot record={entry.before} caption="İşlem öncesi" />
                )}
                <CaseSnapshot record={entry.after} caption="İşlem sonrası" />
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="Etkinlik kaydı yok">
          Bu dosya için etkinlik alınmadı.
        </Empty>
      )}
      {ready && (
        <PageNavigation
          page={history.length + 1}
          count={items.length}
          caption="Yalnız bu sayfanın kayıt sayısıdır; toplam değildir."
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
    </section>
  );
}
