import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  FolderKanban,
  Network,
  Shield,
  ShieldAlert,
  Siren,
  Users,
} from "lucide-react";
import { Badge, dateLabel, InlineError } from "./components";
import { formatDateUTC } from "./dateTime";
import { buildDashboard, dayTotal, isDashboardResponse, severityOrder, TREND_DAYS } from "./dashboardSummary";
import type { DashboardSummary, TrendDay } from "./dashboardSummary";
import { demoConnections, demoEvents } from "./demoFixtures";
import { demoCases } from "./cases";
import { severityLabels } from "./eventCatalog";
import { useResource } from "./resource";
import { ReviewScheduleBadge } from "./ReviewQueue";
import {
  classifyMembershipReview,
  compareMembershipReview,
  reviewNeedsAttention,
} from "./reviewSchedule";
import type { ReviewBucket, ReviewQueueFilter } from "./reviewSchedule";
import { colorLabels, entityLabels, membershipState } from "./types";
import type { Color, EntityKind, Group, Membership, Page, Workspace } from "./types";

type DashboardProps = {
  workspace: Workspace;
  demo: boolean;
  today: string;
  onNavigate: (page: Page) => void;
  onOpenReviewQueue: (filter?: ReviewQueueFilter) => void;
  onOpenActiveMemberships: () => void;
  onOpenMembership: (membership: Membership) => void;
  onOpenGroup: (group: Group) => void;
  onSessionExpired: () => void;
  createAction: (kind: "entity" | "group" | "membership", label: string) => ReactNode;
};

function Kpi({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: "neutral" | "red" | "yellow";
  onClick: () => void;
}) {
  return (
    <button className={`dash-kpi ${tone}`} type="button" onClick={onClick}>
      <span className="dash-kpi-head">
        <span className="dash-kpi-icon">{icon}</span>
        {label}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function Card({
  title,
  caption,
  action,
  className = "",
  children,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`dash-card ${className}`} aria-labelledby={id}>
      <header>
        <div>
          <h2 id={id}>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

type BarRow = { key: string; label: string; value: number; tone: string; onClick?: () => void };

// Labeled horizontal bars: the text label and count carry the meaning; the
// fill color only repeats it.
function BarList({ rows, total, caption }: { rows: BarRow[]; total: number; caption: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <table className="dash-bars">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((row) => {
          const label = row.onClick ? (
            <button type="button" className="dash-bar-link" onClick={row.onClick}>
              {row.label}
            </button>
          ) : (
            row.label
          );
          const share = total ? Math.round((row.value / total) * 100) : 0;
          return (
            <tr key={row.key}>
              <th scope="row">{label}</th>
              <td className="dash-bar-cell" aria-hidden="true">
                <span className="dash-bar-track">
                  <span
                    className={`dash-bar-fill ${row.tone}`}
                    style={{ width: `${row.value ? Math.max(2, (row.value / max) * 100) : 0}%` }}
                  />
                </span>
              </td>
              <td className="dash-bar-value">
                {row.value}
                <small>{total ? ` · %${share}` : ""}</small>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
}

function roundedTopBar(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, height, width / 2);
  return `M${x},${y + height}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${width - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + height}Z`;
}

function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => value <= m * 4) ?? magnitude * 10;
  return step * 4;
}

// Single-series daily totals; the hover tooltip and the table carry the
// per-severity breakdown so the bars stay one hue.
function TrendChart({ trend }: { trend: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Draw in real pixels so axis text keeps its size on narrow screens.
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = width < 420 ? 170 : 200;
  const labelEvery = width < 420 ? 4 : width < 620 ? 2 : 1;
  const pad = { top: 12, right: 8, bottom: 26, left: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const totals = trend.map(dayTotal);
  const max = niceMax(Math.max(...totals));
  const slot = plotW / trend.length;
  const barW = Math.min(22, slot * 0.56);
  const ticks = [0, max / 2, max];
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;
  const active = hover === null ? null : trend[hover];
  return (
    <div className="dash-trend" ref={box}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Son ${TREND_DAYS} günde günlük olay sayısı`} onMouseLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick} className="dash-axis">
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </text>
          </g>
        ))}
        {trend.map((day, index) => {
          const total = totals[index];
          const x = pad.left + slot * index + (slot - barW) / 2;
          const h = (total / max) * plotH;
          return (
            <g key={day.day}>
              {total > 0 && (
                <path className={`dash-trend-bar ${hover === index ? "active" : ""}`} d={roundedTopBar(x, pad.top + plotH - h, barW, h, 4)} />
              )}
              {(trend.length - 1 - index) % labelEvery === 0 && (
                <text className="dash-axis-label" x={x + barW / 2} y={height - 8} textAnchor="middle">
                  {shortDay(day.day)}
                </text>
              )}
              <rect
                className="dash-hit"
                x={pad.left + slot * index}
                y={pad.top}
                width={slot}
                height={plotH}
                onMouseEnter={() => setHover(index)}
              />
            </g>
          );
        })}
      </svg>
      {active && hover !== null && (
        <div
          className="dash-tooltip"
          style={{ left: `${((pad.left + slot * hover + slot / 2) / width) * 100}%` }}
          role="presentation"
        >
          <strong>{formatDateUTC(active.day, true)}</strong>
          <span>{totals[hover]} olay</span>
          {severityOrder.filter((key) => active[key] > 0).map((key) => (
            <span key={key} className="dash-tooltip-row">
              <i className={`dash-swatch ${key}`} aria-hidden="true" />
              {severityLabels[key]}: {active[key]}
            </span>
          ))}
        </div>
      )}
      <div className="sr-only">
      <table>
        <caption>Günlük olay sayıları, olay zamanına göre UTC</caption>
        <thead>
          <tr>
            <th scope="col">Gün</th>
            <th scope="col">Toplam</th>
            {severityOrder.map((key) => (
              <th scope="col" key={key}>{severityLabels[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trend.map((day, index) => (
            <tr key={day.day}>
              <th scope="row">{formatDateUTC(day.day, true)}</th>
              <td>{totals[index]}</td>
              {severityOrder.map((key) => (
                <td key={key}>{day[key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const reviewRows: { bucket: ReviewBucket; filter: ReviewQueueFilter; label: string; tone: string }[] = [
  { bucket: "overdue", filter: "overdue", label: "Geciken", tone: "priority-orange" },
  { bucket: "today", filter: "today", label: "Bugün", tone: "priority-yellow" },
  { bucket: "expired", filter: "expired", label: "Süresi doldu, açık", tone: "priority-orange" },
  { bucket: "upcoming", filter: "upcoming", label: "7 gün içinde", tone: "series" },
];

export default function Dashboard({
  workspace,
  demo,
  today,
  onNavigate,
  onOpenReviewQueue,
  onOpenActiveMemberships,
  onOpenMembership,
  onOpenGroup,
  onSessionExpired,
  createAction,
}: DashboardProps) {
  const summary = useResource<DashboardSummary>(
    "/dashboard",
    demo,
    buildDashboard(today, demoEvents, demoCases, demoConnections.length),
    onSessionExpired,
    isDashboardResponse,
  );
  const groupById = new Map(workspace.groups.map((g) => [g.id, g]));
  const entityById = new Map(workspace.entities.map((e) => [e.id, e]));
  const open = workspace.memberships.filter((m) => m.active && membershipState(m) === "active");
  const buckets = new Map<ReviewBucket, number>();
  for (const m of workspace.memberships) {
    const bucket = classifyMembershipReview(m, today);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }
  const due = workspace.memberships
    .filter((m) => reviewNeedsAttention(classifyMembershipReview(m, today)))
    .sort(compareMembershipReview);
  const red = open.filter((m) => groupById.get(m.groupId)?.color === "red");
  const priorityRows: BarRow[] = (["red", "orange", "yellow", "slate"] as Color[]).map((color) => ({
    key: color,
    label: color === "slate" ? "Özel gruplar" : colorLabels[color],
    value: open.filter((m) => groupById.get(m.groupId)?.color === color).length,
    tone: `priority-${color}`,
  }));
  const kindRows: BarRow[] = (Object.keys(entityLabels) as EntityKind[]).map((kind) => ({
    key: kind,
    label: entityLabels[kind],
    value: workspace.entities.filter((e) => e.kind === kind).length,
    tone: "series",
  }));
  const groupCounts = workspace.groups
    .map((group) => ({ group, count: open.filter((m) => m.groupId === group.id).length }))
    .sort((a, b) => b.count - a.count || a.group.name.localeCompare(b.group.name, "tr"))
    .slice(0, 5);
  const data = summary.data;
  const trendTotal = data ? data.eventTrend.reduce((sum, day) => sum + dayTotal(day), 0) : 0;

  if (!workspace.entities.length && !workspace.groups.length) {
    return (
      <div className="dash">
        <section className="dash-onboarding">
          <h2>Çalışma alanını kurun</h2>
          <p>Kayıtlar boş başlar. Üç adımda ilk incelemeyi başlatın.</p>
          <ol>
            <li>
              <strong>Varlıkları ekleyin</strong>
              <span>Personel, hesap, cihaz, servis ve uygulamaları kaydedin.</span>
              {createAction("entity", "Varlık ekle")}
            </li>
            <li>
              <strong>İzleme grubu oluşturun</strong>
              <span>Sarı, turuncu, kırmızı veya kuruma özel bir grup seçin.</span>
              {createAction("group", "Grup oluştur")}
            </li>
            <li>
              <strong>İncelemeyi başlatın</strong>
              <span>Varlığı gerekçe, sorumlu ve tarihlerle gruba ekleyin.</span>
            </li>
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="dash-kpis">
        <Kpi label="Kayıtlı varlık" value={workspace.entities.length} detail="Manuel kayıt, doğrulama bekler" icon={<Users size={16} />} onClick={() => onNavigate("entities")} />
        <Kpi label="Etkin üyelik" value={open.length} detail="Bir varlık birden çok grupta olabilir" icon={<Shield size={16} />} onClick={onOpenActiveMemberships} />
        <Kpi label="Kırmızı öncelik" value={red.length} detail="Etkin üyelik satırı" icon={<ShieldAlert size={16} />} tone="red" onClick={() => onNavigate("watchlists")} />
        <Kpi label="İşlem bekleyen" value={due.length} detail="Geciken, bugün ve süresi dolan" icon={<CalendarClock size={16} />} tone="yellow" onClick={() => onOpenReviewQueue()} />
        <Kpi
          label="Açık dosya"
          value={data ? data.cases.open : summary.error ? "!" : "…"}
          detail={data ? `${data.cases.closed} kapalı dosya` : summary.error ? "Sayı alınamadı" : "Yükleniyor"}
          icon={<FolderKanban size={16} />}
          onClick={() => onNavigate("cases")}
        />
      </div>

      <div className="dash-grid">
        <Card
          className="span-2"
          title="Güvenlik olayları"
          caption={`Son ${TREND_DAYS} gün · olay zamanı, UTC`}
          action={<button className="link-btn" type="button" onClick={() => onNavigate("events")}>Olaylar <ArrowRight size={14} /></button>}
        >
          {summary.error ? (
            <InlineError message="Olay özeti alınamadı." detail={summary.error} onRetry={() => void summary.refresh()} />
          ) : !data ? (
            <div className="dash-skeleton" aria-hidden="true" />
          ) : (
            <>
              <div className="dash-hero">
                <strong>{trendTotal}</strong>
                <span>olay son {TREND_DAYS} günde · toplam {data.eventTotal} kayıt</span>
              </div>
              {trendTotal ? (
                <TrendChart trend={data.eventTrend} />
              ) : (
                <p className="dash-empty">
                  Son {TREND_DAYS} günde olay zamanı olan kayıt yok. Canlı toplama kapalıdır; olaylar manuel JSON aktarımıyla gelir.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Önem dağılımı" caption="Tüm aktarılmış olaylar">
          {data ? (
            <BarList
              caption="Olayların önem derecesine göre dağılımı"
              total={data.eventTotal}
              rows={severityOrder.map((key) => ({ key, label: severityLabels[key], value: data.eventSeverityTotals[key], tone: `severity-${key}` }))}
            />
          ) : summary.error ? (
            <p className="dash-empty">Önem dağılımı alınamadı.</p>
          ) : (
            <div className="dash-skeleton short" aria-hidden="true" />
          )}
          <p className="dash-note">Önem derecesi olayı sınıflar; kişi hakkında karar değildir.</p>
        </Card>

        <Card
          title="İnceleme takvimi"
          caption="Açık üyelikler · UTC gün sınırı"
          action={<button className="link-btn" type="button" onClick={() => onOpenReviewQueue()}>İş listesi <ArrowRight size={14} /></button>}
        >
          <div className="dash-schedule">
            {reviewRows.map((row) => (
              <button key={row.bucket} type="button" className="dash-schedule-item" onClick={() => onOpenReviewQueue(row.filter)}>
                <i className={`dash-swatch ${row.tone}`} aria-hidden="true" />
                <span>{row.label}</span>
                <strong>{buckets.get(row.bucket) || 0}</strong>
              </button>
            ))}
          </div>
          {due.length ? (
            <ul className="dash-due">
              {due.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => onOpenMembership(m)}>
                    <span className="dash-item-text">
                      <strong>{entityById.get(m.entityId)?.name || "Varlık"}</strong>
                      <small>{groupById.get(m.groupId)?.name} · {dateLabel(m.reviewOn)} · {m.responsible}</small>
                    </span>
                    <ReviewScheduleBadge membership={m} today={today} />
                    <ChevronRight size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-empty">İşlem bekleyen inceleme yok.</p>
          )}
        </Card>

        <Card title="Öncelik dağılımı" caption="Etkin üyelik satırları; kişi sayısı değildir">
          <BarList caption="Etkin üyeliklerin grup rengine göre dağılımı" total={open.length} rows={priorityRows} />
          <p className="dash-note">Renk inceleme önceliğidir; tehdit kararı değildir.</p>
        </Card>

        <Card
          title="İzleme grupları"
          caption="Etkin üyelik sayısına göre"
          action={<button className="link-btn" type="button" onClick={() => onNavigate("groups")}>Tümü <ArrowRight size={14} /></button>}
        >
          {groupCounts.length ? (
            <ul className="dash-groups">
              {groupCounts.map(({ group, count }) => (
                <li key={group.id}>
                  <button type="button" onClick={() => onOpenGroup(group)}>
                    <i className={`dash-swatch priority-${group.color}`} aria-hidden="true" />
                    <span className="dash-item-text">
                      <strong>{group.name}</strong>
                      <small>{colorLabels[group.color]}</small>
                    </span>
                    <Badge tone={count ? "slate" : "neutral"}>{count}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-empty">Henüz izleme grubu yok.</p>
          )}
        </Card>

        <Card title="Varlık türleri" caption={`${workspace.entities.length} kayıt`}>
          <BarList caption="Varlıkların türe göre dağılımı" total={workspace.entities.length} rows={kindRows} />
        </Card>

        <Card title="Kaynaklar" caption="Yapılandırma ve aktarım">
          <div className="dash-sources">
            <div>
              <Network size={18} />
              <span>
                <strong>{data ? data.sourceCount : "…"}</strong>
                <small>kayıtlı kaynak profili</small>
              </span>
            </div>
            <div>
              <Siren size={18} />
              <span>
                <strong>{data ? data.eventTotal : "…"}</strong>
                <small>aktarılmış olay</small>
              </span>
            </div>
          </div>
          <p className="dash-note">Canlı toplama kapalıdır. Profil kaydı bağlantı kanıtı değildir.</p>
          <button className="link-btn" type="button" onClick={() => onNavigate("sources")}>
            Kaynakları aç <ArrowRight size={14} />
          </button>
        </Card>
      </div>
    </div>
  );
}
