import { isRecord } from "./responseShape";
import type { Workspace } from "./types";
import { isUTCCalendarDay } from "./watchlistResponses";
import { demoWatchlistOverview, reviewAlertKinds } from "./watchlists";
import type { ReviewAlertKind } from "./watchlists";

export type WarningSummary = {
  asOf: string;
  generatedAt: string;
  alerts: {
    total: number;
    counts: Record<ReviewAlertKind, number>;
  };
  sourceNotifications: { unreadCount: number };
};

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function utcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.match(
    /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?Z$/,
  );
  return (
    !!parts &&
    isUTCCalendarDay(parts[1]) &&
    Number(parts[2]) <= 23 &&
    Number(parts[3]) <= 59 &&
    Number(parts[4]) <= 59 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

export function isWarningSummary(value: unknown): value is WarningSummary {
  if (
    !isRecord(value) ||
    !isUTCCalendarDay(value.asOf) ||
    !utcInstant(value.generatedAt) ||
    value.generatedAt.slice(0, 10) !== value.asOf ||
    !isRecord(value.alerts) ||
    !count(value.alerts.total) ||
    !isRecord(value.alerts.counts) ||
    Object.keys(value.alerts.counts).length !== reviewAlertKinds.length ||
    !isRecord(value.sourceNotifications) ||
    !count(value.sourceNotifications.unreadCount)
  )
    return false;

  let total = 0;
  for (const kind of reviewAlertKinds) {
    if (!Object.hasOwn(value.alerts.counts, kind)) return false;
    const amount = value.alerts.counts[kind];
    if (!count(amount) || !Number.isSafeInteger(total + amount)) return false;
    total += amount;
  }
  return total === value.alerts.total;
}

// The overview classifier counts the whole unfiltered fixture before paging.
export function demoWarningSummary(
  workspace: Workspace,
  unreadCount: number,
  asOf: string,
  generatedAt = new Date().toISOString(),
): WarningSummary {
  const overview = demoWatchlistOverview(
    workspace,
    unreadCount,
    { limit: 1, alertKind: "all" },
    asOf,
    generatedAt,
  );
  return {
    asOf: overview.asOf,
    generatedAt: overview.generatedAt,
    alerts: {
      total: overview.alerts.total,
      counts: { ...overview.alerts.counts },
    },
    sourceNotifications: {
      unreadCount: overview.sourceNotifications.unreadCount,
    },
  };
}
