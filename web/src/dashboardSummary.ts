import { severityLabels } from "./eventCatalog.ts";
import type { Severity } from "./eventCatalog.ts";
import { isRecord } from "./responseShape.ts";

export const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info"];
export const TREND_DAYS = 14;

export type SeverityCounts = Record<Severity, number>;
export type TrendDay = SeverityCounts & { day: string };
export type DashboardSummary = {
  generatedAt: string;
  eventTrend: TrendDay[];
  eventSeverityTotals: SeverityCounts;
  eventTotal: number;
  cases: { open: number; closed: number };
  sourceCount: number;
};

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isSeverityCounts(value: unknown): value is SeverityCounts {
  return isRecord(value) && Object.keys(severityLabels).every((key) => isCount(value[key]));
}
function isUtcDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// The trend must be exactly 14 consecutive UTC days, oldest first, so a
// truncated or reordered response cannot render as a quiet fortnight.
export function isDashboardResponse(value: unknown): boolean {
  if (!isRecord(value) || typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return false;
  const trend = value.eventTrend;
  if (!Array.isArray(trend) || trend.length !== TREND_DAYS) return false;
  let previous = "";
  for (const day of trend) {
    if (!isSeverityCounts(day)) return false;
    const label = (day as Record<string, unknown>).day;
    if (!isUtcDay(label)) return false;
    if (previous && addDays(previous, 1) !== label) return false;
    previous = label;
  }
  const cases = value.cases;
  return isSeverityCounts(value.eventSeverityTotals) && isCount(value.eventTotal) &&
    isRecord(cases) && isCount(cases.open) && isCount(cases.closed) && isCount(value.sourceCount);
}

export function addDays(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function dayTotal(day: SeverityCounts) {
  return severityOrder.reduce((sum, key) => sum + day[key], 0);
}

// The read-only sample has no server; derive the same shape from its fixtures
// using the real UTC window, even when that window holds no sample events.
export function buildDashboard(
  today: string,
  events: { occurredAt: string; severity: string }[],
  cases: { status: string }[],
  sourceCount: number,
): DashboardSummary {
  const first = addDays(today, -(TREND_DAYS - 1));
  const trend: TrendDay[] = Array.from({ length: TREND_DAYS }, (_, i) => ({ day: addDays(first, i), ...emptySeverityCounts() }));
  const totals = emptySeverityCounts();
  for (const event of events) {
    if (!(event.severity in totals)) continue;
    const severity = event.severity as Severity;
    totals[severity]++;
    const day = new Date(event.occurredAt).toISOString().slice(0, 10);
    const slot = trend.find((item) => item.day === day);
    if (slot) slot[severity]++;
  }
  return {
    generatedAt: new Date().toISOString(),
    eventTrend: trend,
    eventSeverityTotals: totals,
    eventTotal: events.length,
    cases: {
      open: cases.filter((item) => item.status === "open").length,
      closed: cases.filter((item) => item.status === "closed").length,
    },
    sourceCount,
  };
}
