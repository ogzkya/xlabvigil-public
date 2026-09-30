import { useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Empty,
  LoadError,
  Loading,
  PageNavigation,
} from "./components";
import { demoEvents } from "./demoFixtures";
import {
  categoryLabels,
  severityLabels,
  severityTone,
  timestamp,
} from "./operations";
import type { SecurityEvent } from "./operations";
import { useResource } from "./resource";
import { isEventPageResponse } from "./responseShape";

type CandidateEventPage = { items: SecurityEvent[]; nextCursor: string };
type CandidateEventsProps = {
  entityId: string;
  demo: boolean;
  onSessionExpired: () => void;
  onSelectEvent?: (event: SecurityEvent) => void;
  selectedEventId?: string;
  selectedAction?: ReactNode;
  selectionDisabled?: boolean;
  pageNavigationDisabled?: boolean;
};

export default function CandidateEvents(props: CandidateEventsProps) {
  // A different entity starts with its own first page and demo fixture.
  return <CandidateEventsForEntity key={`${props.demo}:${props.entityId}`} {...props} />;
}

function CandidateEventsForEntity({
  entityId,
  demo,
  onSessionExpired,
  onSelectEvent,
  selectedEventId,
  selectedAction,
  selectionDisabled = false,
  pageNavigationDisabled = false,
}: CandidateEventsProps) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const demoPage: CandidateEventPage = {
    items: demoEvents.filter(
      (event) =>
        event.entityId === entityId && event.identityState === "candidate",
    ),
    nextCursor: "",
  };
  const resource = useResource<CandidateEventPage>(
    `/entities/${encodeURIComponent(entityId)}/candidate-events?${params}`,
    demo,
    demoPage,
    onSessionExpired,
    isEventPageResponse,
  );
  const items = resource.data?.items || [];
  const ready = resource.matchesRequest && !resource.loading && !resource.error;

  return (
    <section className="candidate-events" aria-label="Varlıkla aday ilişkili olaylar">
      <div className="candidate-events-heading">
        <h3>Aday kaynak olayları</h3>
        <span>20 kayıt / sayfa</span>
      </div>
      <div className="info-strip">
        <p>
          Bu olaylar manuel aktarımda bu varlıkla aday olarak ilişkilendirildi.
          İlişki doğrulanmış kimlik, grup üyeliği veya inceleme dosyası kanıtı
          sayılmaz.
        </p>
      </div>
      {resource.loading || !resource.matchesRequest ? (
        <Loading label="Aday olaylar yükleniyor…" />
      ) : resource.error ? (
        <LoadError
          title="Aday olaylar alınamadı"
          message={resource.error}
          onRetry={() => void resource.refresh()}
        />
      ) : items.length ? (
        <ul className="candidate-events-list">
          {items.map((event) => (
            <li className="candidate-event" key={event.id}>
              <div className="candidate-event-top">
                <Badge tone={severityTone[event.severity]}>
                  {severityLabels[event.severity]}
                </Badge>
                <span>{categoryLabels[event.category]}</span>
              </div>
              <h4>{event.title}</h4>
              {event.summary && <p>{event.summary}</p>}
              <dl className="candidate-event-facts">
                <div>
                  <dt>Olay zamanı</dt>
                  <dd>{timestamp(event.occurredAt)}</dd>
                </div>
                <div>
                  <dt>Alınma zamanı</dt>
                  <dd>{timestamp(event.receivedAt)}</dd>
                </div>
                <div>
                  <dt>Özgün ürün</dt>
                  <dd>{event.originProduct || "Belirtilmedi"}</dd>
                </div>
                <div>
                  <dt>Aktarım kimliği</dt>
                  <dd>{event.externalId}</dd>
                </div>
              </dl>
              <details className="candidate-event-more">
                <summary>Kaynak ayrıntılarını göster</summary>
                <dl className="candidate-event-facts">
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
                  <div>
                    <dt>Bağlantı kimliği</dt>
                    <dd>{event.connectionId}</dd>
                  </div>
                  <div>
                    <dt>Veri kökeni</dt>
                    <dd>Manuel içe aktarım</dd>
                  </div>
                </dl>
              </details>
              {onSelectEvent && (
                <div className="candidate-event-actions">
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={
                      selectionDisabled ||
                      (!!selectedEventId && selectedEventId !== event.id)
                    }
                    aria-expanded={selectedEventId === event.id}
                    onClick={() => onSelectEvent(event)}
                  >
                    {selectedEventId === event.id
                      ? "Gerekçe formunu kapat"
                      : "İncelemeye iliştir"}
                  </button>
                </div>
              )}
              {selectedEventId === event.id && selectedAction}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Bu varlık için aday olay yok">
          Bu varlıkla manuel aktarımda aday olarak ilişkilendirilmiş bir olay
          bulunmuyor. Bu durum kaynakların izlendiğini veya risk bulunmadığını
          göstermez.
        </Empty>
      )}
      {ready && (
        <PageNavigation
          page={history.length + 1}
          count={items.length}
          caption="Sayı yalnız bu sayfadaki aday olayları gösterir; toplam değildir."
          previousDisabled={!history.length || pageNavigationDisabled}
          nextDisabled={!resource.data?.nextCursor || demo || pageNavigationDisabled}
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
