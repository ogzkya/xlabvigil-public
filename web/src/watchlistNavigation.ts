import type { ReviewAlertFilter } from "./watchlists";

export type WatchlistEntryIntent = {
  serial: number;
  alertKind: ReviewAlertFilter;
};

export function nextWatchlistEntryIntent(
  current: WatchlistEntryIntent | null,
  alertKind: ReviewAlertFilter,
): WatchlistEntryIntent {
  return { serial: (current?.serial ?? 0) + 1, alertKind };
}
