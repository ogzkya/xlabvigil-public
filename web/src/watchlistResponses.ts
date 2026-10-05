import {
  isEntityRecord,
  isGroupRecord,
  isMembershipRecord,
  isRecord,
} from "./responseShape";
import {
  classifyWatchlistAlert,
  compareWatchlistEntries,
  encodeWatchlistCursor,
  encodeWatchlistSearchKey,
  normalizeWatchlistSelection,
  reviewAlertKinds,
  reviewAlertRank,
  validWatchlistQuery,
  watchlistEntityKinds,
} from "./watchlists";
import type {
  ReviewAlertFilter,
  WatchlistCursor,
  WatchlistEntry,
  WatchlistOverview,
  WatchlistRequest,
  WatchlistSelection,
} from "./watchlists";

export function isUTCCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.match(
    /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|([+-])(\d\d):(\d\d))$/,
  );
  if (
    !parts ||
    !isUTCCalendarDay(parts[1]) ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4]) > 59
  )
    return false;
  let offsetMinutes = 0;
  if (parts[5] !== "Z") {
    const hours = Number(parts[7]);
    const minutes = Number(parts[8]);
    if (hours > 23 || minutes > 59) return false;
    offsetMinutes = (hours * 60 + minutes) * (parts[6] === "+" ? 1 : -1);
  }
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed + offsetMinutes * 60_000).toISOString().slice(0, 19) ===
      value.slice(0, 19)
  );
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function filter(value: unknown): value is ReviewAlertFilter {
  return value === "all" || reviewAlertKinds.includes(value as never);
}
function selection(value: unknown): value is WatchlistSelection {
  return (
    isRecord(value) &&
    typeof value.q === "string" &&
    value.q === value.q.trim() &&
    validWatchlistQuery(value.q) &&
    watchlistEntityKinds.includes(value.entityKind as never)
  );
}
export function isWatchlistEntry(
  value: unknown,
  asOf: string,
): value is WatchlistEntry {
  if (
    !isRecord(value) ||
    !isEntityRecord(value.entity) ||
    !isGroupRecord(value.group) ||
    !isMembershipRecord(value.membership)
  )
    return false;
  const entry = value as unknown as WatchlistEntry;
  const { membership: m, entity: e, group: g } = entry;
  return (
    m.status === "active" &&
    !!e.name.trim() &&
    !!g.name.trim() &&
    !!m.reason.trim() &&
    !!m.responsible.trim() &&
    m.entityId === e.id &&
    m.groupId === g.id &&
    isUTCCalendarDay(m.startsOn) &&
    isUTCCalendarDay(m.endsOn) &&
    isUTCCalendarDay(m.reviewOn) &&
    m.startsOn <= m.reviewOn &&
    m.reviewOn <= m.endsOn &&
    m.active === (m.startsOn <= asOf && asOf <= m.endsOn) &&
    [m, e, g].every(
      (record) => instant(record.createdAt) && instant(record.updatedAt),
    )
  );
}
function unique(entries: WatchlistEntry[]) {
  return (
    new Set(entries.map((entry) => entry.membership.id)).size === entries.length
  );
}
function cursorMatches(
  value: unknown,
  scope: WatchlistCursor["scope"],
  asOf: string,
  selected: "" | ReviewAlertFilter,
  last: WatchlistEntry | undefined,
  rank: number,
  selection: WatchlistSelection,
) {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  if (!last || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
    return false;
  try {
    const token = JSON.parse(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    );
    return (
      isRecord(token) &&
      Object.keys(token).length === 9 &&
      token.version === 2 &&
      token.scope === scope &&
      token.asOf === asOf &&
      token.filter === selected &&
      token.searchKey === encodeWatchlistSearchKey(selection.q) &&
      token.entityKind === selection.entityKind &&
      token.reviewOn === last.membership.reviewOn &&
      token.id === last.membership.id &&
      typeof token.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        token.id,
      ) &&
      token.rank === rank &&
      encodeWatchlistCursor(token as unknown as WatchlistCursor) === value
    );
  } catch {
    return false;
  }
}
function list(
  value: unknown,
  color: "red" | "yellow",
  asOf: string,
  selection: WatchlistSelection,
) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !count(value.total) ||
    !count(value.activeCount) ||
    value.items.length > 100 ||
    value.items.length > value.total ||
    value.activeCount > value.total ||
    !value.items.every(
      (item) =>
        isWatchlistEntry(item, asOf) &&
        item.group.color === color &&
        (selection.entityKind === "all" ||
          item.entity.kind === selection.entityKind),
    )
  )
    return false;
  const items = value.items as WatchlistEntry[];
  const active = items.filter((entry) => entry.membership.active).length;
  return (
    unique(items) &&
    items.every(
      (item, index) =>
        index === 0 || compareWatchlistEntries(items[index - 1], item) < 0,
    ) &&
    value.activeCount >= active &&
    value.activeCount <= value.total - (items.length - active) &&
    cursorMatches(
      value.nextCursor,
      color,
      asOf,
      "",
      items.at(-1),
      0,
      selection,
    ) &&
    !(value.total <= items.length && value.nextCursor !== "")
  );
}
export function isWatchlistOverview(
  value: unknown,
): value is WatchlistOverview {
  if (
    !isRecord(value) ||
    !isUTCCalendarDay(value.asOf) ||
    !instant(value.generatedAt) ||
    !value.generatedAt.endsWith("Z") ||
    value.generatedAt.slice(0, 10) !== value.asOf ||
    !selection(value.selection) ||
    !list(value.red, "red", value.asOf, value.selection) ||
    !list(value.yellow, "yellow", value.asOf, value.selection) ||
    !isRecord(value.alerts) ||
    !isRecord(value.alerts.counts) ||
    !filter(value.alerts.filter) ||
    !count(value.alerts.total) ||
    !Array.isArray(value.alerts.items) ||
    value.alerts.items.length > 100 ||
    value.alerts.items.length > value.alerts.total ||
    !isRecord(value.sourceNotifications) ||
    !count(value.sourceNotifications.unreadCount)
  )
    return false;
  const overview = value as unknown as WatchlistOverview;
  const alerts = overview.alerts;
  if (!reviewAlertKinds.every((kind) => count(alerts.counts[kind])))
    return false;
  const sum = reviewAlertKinds.reduce(
    (total, kind) => total + alerts.counts[kind],
    0,
  );
  if (
    !Number.isSafeInteger(sum) ||
    alerts.total !==
      (alerts.filter === "all" ? sum : alerts.counts[alerts.filter]) ||
    !alerts.items.every(
      (item) =>
        isRecord(item) &&
        reviewAlertKinds.includes(item.kind) &&
        isWatchlistEntry(item.record, overview.asOf) &&
        (overview.selection.entityKind === "all" ||
          item.record.entity.kind === overview.selection.entityKind) &&
        classifyWatchlistAlert(item.record, overview.asOf) === item.kind &&
        (alerts.filter === "all" || item.kind === alerts.filter),
    )
  )
    return false;
  if (
    !unique(alerts.items.map((item) => item.record)) ||
    !reviewAlertKinds.every(
      (kind) =>
        alerts.items.filter((item) => item.kind === kind).length <=
        alerts.counts[kind],
    ) ||
    !alerts.items.every(
      (item, index) =>
        index === 0 ||
        reviewAlertRank[alerts.items[index - 1].kind] <
          reviewAlertRank[item.kind] ||
        (alerts.items[index - 1].kind === item.kind &&
          compareWatchlistEntries(alerts.items[index - 1].record, item.record) <
            0),
    ) ||
    !cursorMatches(
      alerts.nextCursor,
      "alerts",
      overview.asOf,
      alerts.filter,
      alerts.items.at(-1)?.record,
      alerts.items.at(-1) ? reviewAlertRank[alerts.items.at(-1)!.kind] : 0,
      overview.selection,
    ) ||
    (alerts.total <= alerts.items.length && alerts.nextCursor !== "")
  )
    return false;
  const redIds = new Set(
    overview.red.items.map((entry) => entry.membership.id),
  );
  if (overview.yellow.items.some((entry) => redIds.has(entry.membership.id)))
    return false;
  const snapshots = new Map<string, string>();
  for (const entry of [
    ...overview.red.items,
    ...overview.yellow.items,
    ...alerts.items.map((alert) => alert.record),
  ]) {
    const snapshot = JSON.stringify(
      [entry.membership, entry.entity, entry.group].map((record) =>
        Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    );
    const prior = snapshots.get(entry.membership.id);
    if (prior && prior !== snapshot) return false;
    snapshots.set(entry.membership.id, snapshot);
  }
  return true;
}
export function isWatchlistOverviewForRequest(
  value: unknown,
  request: WatchlistRequest,
): value is WatchlistOverview {
  if (
    !isWatchlistOverview(value) ||
    value.alerts.filter !== request.alertKind ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 100
  )
    return false;
  if (
    (request.q !== undefined && typeof request.q !== "string") ||
    (request.entityKind !== undefined &&
      !watchlistEntityKinds.includes(request.entityKind))
  )
    return false;
  const selection = normalizeWatchlistSelection(request);
  if (
    !validWatchlistQuery(selection.q) ||
    value.selection.q !== selection.q ||
    value.selection.entityKind !== selection.entityKind
  )
    return false;
  const asOf = value.asOf;
  function boundPage(
    page: { items: WatchlistEntry[]; total: number; nextCursor: string },
    incoming: string | undefined,
    scope: WatchlistCursor["scope"],
    selected: "" | ReviewAlertFilter,
    ranks: number[],
  ) {
    if (
      page.items.length > request.limit ||
      (page.nextCursor !== "" && page.items.length !== request.limit)
    )
      return false;
    if (!incoming)
      return (
        page.items.length === Math.min(page.total, request.limit) &&
        (page.nextCursor !== "") === page.total > page.items.length
      );
    try {
      if (incoming.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(incoming))
        return false;
      const token = JSON.parse(
        atob(incoming.replaceAll("-", "+").replaceAll("_", "/")),
      );
      if (
        !isRecord(token) ||
        Object.keys(token).length !== 9 ||
        token.version !== 2 ||
        token.scope !== scope ||
        token.asOf !== asOf ||
        token.filter !== selected ||
        token.searchKey !== encodeWatchlistSearchKey(selection.q) ||
        token.entityKind !== selection.entityKind ||
        !isUTCCalendarDay(token.reviewOn) ||
        typeof token.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          token.id,
        ) ||
        !Number.isInteger(token.rank) ||
        (scope === "alerts"
          ? Number(token.rank) < 1 ||
            Number(token.rank) > 4 ||
            (selected !== "all" &&
              selected !== "" &&
              token.rank !== reviewAlertRank[selected])
          : token.rank !== 0) ||
        encodeWatchlistCursor(token as unknown as WatchlistCursor) !== incoming
      )
        return false;
      return page.items.every(
        (entry, index) =>
          ranks[index] > Number(token.rank) ||
          (ranks[index] === token.rank &&
            (entry.membership.reviewOn > String(token.reviewOn) ||
              (entry.membership.reviewOn === token.reviewOn &&
                entry.membership.id > String(token.id)))),
      );
    } catch {
      return false;
    }
  }
  return (
    boundPage(
      value.red,
      request.redCursor,
      "red",
      "",
      value.red.items.map(() => 0),
    ) &&
    boundPage(
      value.yellow,
      request.yellowCursor,
      "yellow",
      "",
      value.yellow.items.map(() => 0),
    ) &&
    boundPage(
      {
        ...value.alerts,
        items: value.alerts.items.map((alert) => alert.record),
      },
      request.alertCursor,
      "alerts",
      request.alertKind,
      value.alerts.items.map((alert) => reviewAlertRank[alert.kind]),
    )
  );
}
