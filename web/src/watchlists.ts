import type { BadgeTone } from "./design";
import { entityLabels } from "./types";
import type { Entity, EntityKind, Group, Membership, Workspace } from "./types";

export type ReviewAlertKind =
  "expired" | "review_due" | "red_priority" | "review_upcoming";
export type ReviewAlertFilter = "all" | ReviewAlertKind;
export type WatchlistEntityKind = "all" | EntityKind;
export type WatchlistSelection = { q: string; entityKind: WatchlistEntityKind };
export const watchlistEntityKinds: WatchlistEntityKind[] = [
  "all",
  "person",
  "account",
  "device",
  "service",
  "application",
];
export const watchlistEntityKindLabels: Record<WatchlistEntityKind, string> = {
  all: "Tüm varlık türleri",
  ...entityLabels,
};
export function validWatchlistQuery(value: string) {
  const length = Array.from(value.trim()).length;
  return length === 0 || (length >= 3 && length <= 120);
}
export function normalizeWatchlistSelection(
  selection: Partial<WatchlistSelection>,
): WatchlistSelection {
  return {
    q: (selection.q || "").trim(),
    entityKind: selection.entityKind || "all",
  };
}
export function matchesDemoWatchlistSelection(
  entry: WatchlistEntry,
  selection: WatchlistSelection,
) {
  if (
    selection.entityKind !== "all" &&
    entry.entity.kind !== selection.entityKind
  )
    return false;
  const q = selection.q.trim().toLowerCase();
  return (
    !q ||
    [
      entry.entity.name,
      entry.entity.identifier,
      entry.entity.department,
      entry.group.name,
      entry.membership.reason,
      entry.membership.responsible,
    ].some((field) => field.toLowerCase().includes(q))
  );
}
export function encodeWatchlistSearchKey(q: string) {
  const bytes = new TextEncoder().encode(q.trim());
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export type WatchlistEntry = {
  membership: Membership;
  entity: Entity;
  group: Group;
};
export type WatchlistPage = {
  items: WatchlistEntry[];
  nextCursor: string;
  total: number;
  activeCount: number;
};
export type WatchlistAlert = { kind: ReviewAlertKind; record: WatchlistEntry };
export type WatchlistOverview = {
  asOf: string;
  generatedAt: string;
  selection: WatchlistSelection;
  red: WatchlistPage;
  yellow: WatchlistPage;
  alerts: {
    items: WatchlistAlert[];
    nextCursor: string;
    total: number;
    filter: ReviewAlertFilter;
    counts: Record<ReviewAlertKind, number>;
  };
  sourceNotifications: { unreadCount: number };
};
export type WatchlistCursor = {
  version: 2;
  scope: "red" | "yellow" | "alerts";
  asOf: string;
  filter: "" | ReviewAlertFilter;
  reviewOn: string;
  id: string;
  rank: number;
  searchKey: string;
  entityKind: WatchlistEntityKind;
};
export type WatchlistRequest = {
  limit: number;
  alertKind: ReviewAlertFilter;
  redCursor?: string;
  yellowCursor?: string;
  alertCursor?: string;
  q?: string;
  entityKind?: WatchlistEntityKind;
};
export const reviewAlertKinds: ReviewAlertKind[] = [
  "expired",
  "review_due",
  "red_priority",
  "review_upcoming",
];
export const reviewAlertLabels: Record<ReviewAlertFilter, string> = {
  all: "Tümü",
  expired: "Süresi dolmuş",
  review_due: "İnceleme tarihi gelmiş",
  red_priority: "Kırmızı öncelik",
  review_upcoming: "Önümüzdeki 7 gün",
};
export const reviewAlertTone: Record<ReviewAlertKind, BadgeTone> = {
  expired: "orange",
  review_due: "yellow",
  red_priority: "red",
  review_upcoming: "neutral",
};
export const reviewAlertRank: Record<ReviewAlertKind, number> = {
  expired: 1,
  review_due: 2,
  red_priority: 3,
  review_upcoming: 4,
};
export function addUTCDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function watchlistMembershipState(membership: Membership, asOf: string) {
  if (membership.status === "closed") return "closed";
  if (membership.endsOn < asOf) return "expired";
  if (membership.startsOn > asOf) return "scheduled";
  return "active";
}
export function classifyWatchlistAlert(
  record: WatchlistEntry,
  asOf: string,
): ReviewAlertKind | null {
  const membership = record.membership;
  if (membership.status !== "active" || membership.startsOn > asOf) return null;
  if (membership.endsOn < asOf) return "expired";
  if (membership.reviewOn <= asOf) return "review_due";
  if (record.group.color === "red" && membership.active) return "red_priority";
  if (membership.reviewOn <= addUTCDays(asOf, 7)) return "review_upcoming";
  return null;
}
export function encodeWatchlistCursor(cursor: WatchlistCursor) {
  return btoa(
    JSON.stringify({
      version: cursor.version,
      scope: cursor.scope,
      asOf: cursor.asOf,
      filter: cursor.filter,
      reviewOn: cursor.reviewOn,
      id: cursor.id,
      rank: cursor.rank,
      searchKey: cursor.searchKey,
      entityKind: cursor.entityKind,
    }),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function compareWatchlistEntries(a: WatchlistEntry, b: WatchlistEntry) {
  const first = `${a.membership.reviewOn}\u0000${a.membership.id}`;
  const second = `${b.membership.reviewOn}\u0000${b.membership.id}`;
  return first < second ? -1 : first > second ? 1 : 0;
}
export function demoWatchlistOverview(
  workspace: Workspace,
  unreadCount: number,
  request: WatchlistRequest,
  asOf: string,
  generatedAt = new Date().toISOString(),
): WatchlistOverview {
  const selection = normalizeWatchlistSelection(request);
  const entities = new Map(
    workspace.entities.map((entity) => [entity.id, entity]),
  );
  const groups = new Map(workspace.groups.map((group) => [group.id, group]));
  const entries = workspace.memberships
    .flatMap((membership) => {
      const entity = entities.get(membership.entityId);
      const group = groups.get(membership.groupId);
      if (!entity || !group || membership.status !== "active") return [];
      return [
        {
          entity,
          group,
          membership: {
            ...membership,
            active: membership.startsOn <= asOf && membership.endsOn >= asOf,
          },
        },
      ];
    })
    .filter((entry) => matchesDemoWatchlistSelection(entry, selection))
    .sort(compareWatchlistEntries);
  function page<T>(
    items: T[],
    cursor: string | undefined,
    scope: WatchlistCursor["scope"],
    entry: (item: T) => WatchlistEntry,
    rank: (item: T) => number,
  ) {
    let start = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(
          atob(cursor.replaceAll("-", "+").replaceAll("_", "/")),
        ) as WatchlistCursor;
        const index = items.findIndex(
          (item) => entry(item).membership.id === decoded.id,
        );
        start = index < 0 ? 0 : index + 1;
      } catch {
        start = 0;
      }
    }
    const visible = items.slice(start, start + request.limit);
    const last = visible.at(-1);
    const nextCursor =
      last && start + visible.length < items.length
        ? encodeWatchlistCursor({
            version: 2,
            scope,
            asOf,
            filter: scope === "alerts" ? request.alertKind : "",
            reviewOn: entry(last).membership.reviewOn,
            id: entry(last).membership.id,
            rank: rank(last),
            searchKey: encodeWatchlistSearchKey(selection.q),
            entityKind: selection.entityKind,
          })
        : "";
    return { items: visible, nextCursor, total: items.length };
  }
  function list(
    color: "red" | "yellow",
    cursor: string | undefined,
  ): WatchlistPage {
    const matching = entries.filter((entry) => entry.group.color === color);
    return {
      ...page(
        matching,
        cursor,
        color,
        (entry) => entry,
        () => 0,
      ),
      activeCount: matching.filter((entry) => entry.membership.active).length,
    };
  }
  const alerts = entries
    .flatMap((record) => {
      const kind = classifyWatchlistAlert(record, asOf);
      return kind ? [{ kind, record }] : [];
    })
    .sort(
      (a, b) =>
        reviewAlertRank[a.kind] - reviewAlertRank[b.kind] ||
        compareWatchlistEntries(a.record, b.record),
    );
  const counts = Object.fromEntries(
    reviewAlertKinds.map((kind) => [
      kind,
      alerts.filter((alert) => alert.kind === kind).length,
    ]),
  ) as Record<ReviewAlertKind, number>;
  const filtered = alerts.filter(
    (alert) => request.alertKind === "all" || alert.kind === request.alertKind,
  );
  return {
    asOf,
    generatedAt,
    selection,
    red: list("red", request.redCursor),
    yellow: list("yellow", request.yellowCursor),
    alerts: {
      ...page(
        filtered,
        request.alertCursor,
        "alerts",
        (alert) => alert.record,
        (alert) => reviewAlertRank[alert.kind],
      ),
      filter: request.alertKind,
      counts,
    },
    sourceNotifications: { unreadCount },
  };
}
