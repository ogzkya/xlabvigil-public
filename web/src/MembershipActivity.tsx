import { useId, useRef, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Badge, Empty, LoadError, Loading, PageNavigation } from "./components";
import { demoMembershipEvidence } from "./evidenceFixtures";
import { severityLabels, severityTone, timestamp } from "./operations";
import { useResource } from "./resource";
import { isMembershipActivityPageResponse } from "./responseShape";
import type {
  Membership,
  MembershipActivityEntry,
  MembershipActivityPage,
} from "./types";

type ActivityKind = "all" | "membership" | "evidence";
type MembershipActivityProps = {
  membership: Membership;
  demo: boolean;
  refreshRevision: number;
  onSessionExpired: () => void;
};

const activityLabels: Record<MembershipActivityEntry["action"], string> = {
  "membership.created": "İnceleme üyeliği oluşturuldu",
  "membership.updated": "İnceleme üyeliği güncellendi",
  "membership.reviewed": "Gözden geçirme kaydedildi",
  "membership_evidence.attached": "Olay incelemeye iliştirildi",
  "membership_evidence.retracted": "Olay ilişkisi geri alındı",
};
const activityFilters: { value: ActivityKind; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "membership", label: "Üyelik değişiklikleri" },
  { value: "evidence", label: "Olay ilişkileri" },
];
const membershipFields = [
  { key: "reason", label: "İnceleme gerekçesi" },
  { key: "responsible", label: "İnceleme sorumlusu" },
  { key: "status", label: "Durum" },
  { key: "startsOn", label: "Başlangıç (UTC)" },
  { key: "endsOn", label: "Bitiş (UTC, dahil)" },
  { key: "reviewOn", label: "Gözden geçirme (UTC)" },
] as const;
type MembershipField = (typeof membershipFields)[number]["key"];

function fieldValue(membership: Membership, field: MembershipField) {
  const value = membership[field];
  if (field === "status") return value === "closed" ? "Kapatıldı" : "Açık";
  if (field === "startsOn" || field === "endsOn" || field === "reviewOn") {
    const parts = value.split("-");
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value || "Belirtilmedi";
  }
  return value || "Belirtilmedi";
}

function demoActivity(membership: Membership): MembershipActivityPage {
  const items: MembershipActivityEntry[] = [
    {
      id: `demo-membership-created:${membership.id}`,
      action: "membership.created",
      occurredAt: membership.createdAt,
      actorId: "demo-analyst",
      actor: "Örnek Analist",
      actorNameSource: "current_profile",
      version: membership.version,
      after: membership,
    },
  ];
  for (const reference of demoMembershipEvidence(membership.id, membership.entityId)) {
    const evidence = {
      id: reference.id,
      eventId: reference.eventId,
      title: reference.event.title,
      severity: reference.event.severity,
      eventOccurredAt: reference.event.occurredAt,
      originProduct: reference.event.originProduct,
      originEventId: reference.event.originEventId,
      provenance: reference.event.provenance,
      identityState: reference.event.identityState,
      reason: reference.reason,
    };
    items.push({
      id: `demo-evidence-attached:${reference.id}`,
      action: "membership_evidence.attached",
      occurredAt: reference.attachedAt,
      actorId: reference.attachedById,
      actor: reference.attachedBy,
      actorNameSource: "recorded",
      evidence,
    });
    if (reference.retractedAt) {
      items.push({
        id: `demo-evidence-retracted:${reference.id}`,
        action: "membership_evidence.retracted",
        occurredAt: reference.retractedAt,
        actorId: reference.retractedById,
        actor: reference.retractedBy,
        actorNameSource: "recorded",
        evidence: { ...evidence, reason: reference.retractionReason },
      });
    }
  }
  const actionOrder = {
    "membership.created": 0,
    "membership.updated": 1,
    "membership.reviewed": 1,
    "membership_evidence.attached": 2,
    "membership_evidence.retracted": 3,
  };
  items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || actionOrder[b.action] - actionOrder[a.action] || b.id.localeCompare(a.id));
  return { items, nextCursor: "" };
}

function MembershipChanges({ entry }: { entry: MembershipActivityEntry }) {
  const after = entry.after;
  if (!after) return <p className="field-help">Bu kayıtta üyelik sürümünün içeriği bulunmuyor.</p>;
  const changed = entry.action === "membership.updated" || entry.action === "membership.reviewed";
  const comparing = changed && !!entry.before;
  const fields = comparing
    ? membershipFields.filter(({ key }) => entry.before![key] !== after[key])
    : membershipFields;
  return (
    <>
      {changed && !entry.before && (
        <p className="field-help">
          Önceki sürüm bulunamadığı için alanlar karşılaştırılamıyor. Kaydedilen sürümün içeriği gösteriliyor.
        </p>
      )}
      {!fields.length ? (
        <p className="field-help">Bu sürümde gerekçe, sorumlu, durum ve inceleme tarihleri değişmedi.</p>
      ) : (
        <dl className="membership-activity-changes">
          {fields.map(({ key, label }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd className={comparing ? "membership-activity-comparison" : undefined}>
                {comparing && (
                  <div>
                    <span className="membership-activity-value-label">Önce</span>
                    <span className="membership-activity-value">{fieldValue(entry.before!, key)}</span>
                  </div>
                )}
                <div>
                  {comparing && <span className="membership-activity-value-label">Sonra</span>}
                  <span className="membership-activity-value">{fieldValue(after, key)}</span>
                </div>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

function ActivityEntry({ entry, demo }: { entry: MembershipActivityEntry; demo: boolean }) {
  const evidence = entry.evidence;
  const review = entry.review;
  const title = review
    ? review.decision === "close"
      ? "Gözden geçirme kararıyla üyelik kapatıldı"
      : "İncelemeye devam kararı kaydedildi"
    : activityLabels[entry.action];
  return (
    <li className="membership-activity-entry">
      <div className="membership-activity-entry-heading">
        <h4>{title}</h4>
        {entry.version !== undefined && <Badge tone="neutral">Sürüm {entry.version}</Badge>}
        {demo && <Badge tone="neutral">Kurgusal örnek</Badge>}
      </div>
      <p className="membership-activity-meta">
        <span>{entry.actor || "Ad bilgisi bulunmuyor"}</span>
        <span>İşlem zamanı: <time dateTime={entry.occurredAt}>{timestamp(entry.occurredAt)}</time></span>
      </p>
      {review && (
        <div className="membership-evidence-reason">
          <strong>Gözden geçirme gerekçesi</strong>
          <p>{review.reason}</p>
        </div>
      )}
      {entry.action.startsWith("membership.") && <MembershipChanges entry={entry} />}
      {evidence && (
        <div className="membership-activity-evidence">
          <div className="membership-activity-event-title">
            <strong>{evidence.title}</strong>
            <Badge tone={severityTone[evidence.severity]}>{severityLabels[evidence.severity]}</Badge>
          </div>
          <div className="membership-evidence-reason">
            <strong>{entry.action === "membership_evidence.retracted" ? "Geri alma gerekçesi" : "İliştirme gerekçesi"}</strong>
            <p>{evidence.reason}</p>
          </div>
        </div>
      )}
      <details className="membership-activity-details">
        <summary>İşlem ayrıntılarını göster</summary>
        <dl className="candidate-event-facts">
          <div>
            <dt>Görünen ad</dt>
            <dd>{entry.actorNameSource === "recorded" ? "İşlem sırasında kaydedilen ad" : "Kullanıcının güncel profil adı"}</dd>
          </div>
          {review?.decision === "continue" && (
            <div><dt>Sonraki gözden geçirme (UTC)</dt><dd>{review.nextReviewOn}</dd></div>
          )}
          {evidence && (
            <>
              <div><dt>Kaynak olayın zamanı</dt><dd><time dateTime={evidence.eventOccurredAt}>{timestamp(evidence.eventOccurredAt)}</time></dd></div>
              <div><dt>Kaynak ürünü</dt><dd>{evidence.originProduct || "Belirtilmedi"}</dd></div>
              <div><dt>Özgün olay kimliği</dt><dd>{evidence.originEventId || "Belirtilmedi"}</dd></div>
              <div><dt>Vigil olay kimliği</dt><dd>{evidence.eventId}</dd></div>
              <div><dt>Kimlik ilişkisi</dt><dd>{evidence.identityState === "candidate" ? "Aday varlık ilişkisi" : "Varlıkla eşleştirilmedi"}</dd></div>
              <div><dt>Veri kökeni</dt><dd>{evidence.provenance === "manual_import" ? "Manuel içe aktarım" : "Belirtilmedi"}</dd></div>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}

export default function MembershipActivity(props: MembershipActivityProps) {
  // Mutations and membership changes start a fresh page without moving focus.
  return <ActivityForMembership key={`${props.demo}:${props.membership.id}:${props.membership.version}:${props.refreshRevision}`} {...props} />;
}

function ActivityForMembership({ membership, demo, onSessionExpired }: MembershipActivityProps) {
  const [kind, setKind] = useState<ActivityKind>("all");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const params = new URLSearchParams({ limit: "20", kind });
  if (cursor) params.set("cursor", cursor);
  const resource = useResource<MembershipActivityPage>(
    `/memberships/${encodeURIComponent(membership.id)}/activity?${params}`,
    demo,
    demo ? demoActivity(membership) : { items: [], nextCursor: "" },
    onSessionExpired,
    isMembershipActivityPageResponse,
  );
  const ready = resource.matchesRequest && !resource.loading && !resource.error;
  const items = (resource.data?.items || []).filter((entry) =>
    !demo || kind === "all" || (kind === "membership" ? entry.action.startsWith("membership.") : entry.action.startsWith("membership_evidence.")),
  );

  function reloadFirstPage() {
    setHistory([]);
    if (cursor) setCursor("");
    else void resource.refresh();
  }

  return (
    <section className="membership-activity" aria-labelledby={headingId}>
      <div className="membership-activity-heading">
        <h3 id={headingId} ref={headingRef} tabIndex={-1}><History size={18} aria-hidden="true" /> İnceleme etkinlikleri</h3>
        <button className="btn secondary" type="button" disabled={resource.loading || !resource.matchesRequest} onClick={reloadFirstPage} aria-busy={resource.loading}>
          <RefreshCw size={14} className={resource.loading ? "spin" : ""} aria-hidden="true" /> {resource.loading ? "Yenileniyor…" : "Yenile"}
        </button>
      </div>
      <p className="field-help">
        Üyelik değişiklikleri ve olay ilişkileri, işlem zamanına göre yeniden eskiye sıralanır. Uygulama içinde saklanır; bağımsız, değiştirilemez arşiv değildir.
      </p>
      <p className="field-help">
        Olay iliştirme ve geri alma kayıtları analistin seçimini gösterir. Kaynak, kimlik veya tehdit doğrulaması anlamına gelmez.
      </p>
      {demo && <p className="field-help">Bu etkinlikler kurgusal önizleme verileridir; sunucuya kaydedilmez.</p>}
      <div className="membership-activity-filters" role="group" aria-label="Etkinlik türü">
        {activityFilters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={kind === filter.value}
            onClick={() => {
              if (filter.value === kind) return;
              setKind(filter.value);
              setCursor("");
              setHistory([]);
            }}
          >{filter.label}</button>
        ))}
      </div>
      {resource.loading || !resource.matchesRequest ? (
        <Loading label="İnceleme etkinlikleri yükleniyor…" />
      ) : resource.error ? (
        <LoadError title="İnceleme etkinlikleri alınamadı" message={resource.error} onRetry={() => void resource.refresh()} />
      ) : items.length ? (
        <ol className="membership-activity-list">
          {items.map((entry) => <ActivityEntry key={entry.id} entry={entry} demo={demo} />)}
        </ol>
      ) : (
        <Empty title={kind === "all" ? "Etkinlik kaydı bulunmuyor" : "Bu türde etkinlik bulunmuyor"}>
          {kind === "all" ? "Bu inceleme üyeliği için gösterilecek işlem kaydı yok." : "Diğer işlem türlerini görmek için Tümü filtresini seçebilirsiniz."}
        </Empty>
      )}
      {ready && (
        <PageNavigation
          page={history.length + 1}
          count={items.length}
          caption="Sayı bu sayfadaki etkinlikleri gösterir. Yenile, ilk sayfadaki son işlemleri getirir."
          previousDisabled={!history.length}
          nextDisabled={!resource.data?.nextCursor || demo}
          onPrevious={() => {
            headingRef.current?.focus();
            setCursor(history.at(-1) || "");
            setHistory((values) => values.slice(0, -1));
          }}
          onNext={() => {
            if (!resource.data?.nextCursor) return;
            headingRef.current?.focus();
            setHistory((values) => [...values, cursor]);
            setCursor(resource.data.nextCursor);
          }}
        />
      )}
    </section>
  );
}
