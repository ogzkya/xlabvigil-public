import assert from "node:assert/strict";
import { createServer } from "vite";

// These examples follow the JSON shapes emitted by the Go page endpoints.
// A malformed successful response must not become a plausible empty state.
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const shape = await server.ssrLoadModule("/src/responseShape.ts");
  const cases = await server.ssrLoadModule("/src/caseResponses.ts");
  const watch = await server.ssrLoadModule("/src/watchlistResponses.ts");
  const watchLogic = await server.ssrLoadModule("/src/watchlists.ts");
  const warnings = await server.ssrLoadModule("/src/warningSummary.ts");
  const page = (item) => ({ items: [item], nextCursor: "" });
  const versioned = {
    id: "membership-1", version: 2,
    createdAt: "2026-09-30T10:00:00Z", updatedAt: "2026-09-30T11:00:00Z",
  };
  const membership = {
    ...versioned, entityId: "entity-1", groupId: "group-1",
    reason: "Manual review", responsible: "Analyst", startsOn: "2026-09-30",
    endsOn: "2026-10-20", reviewOn: "2026-10-11", status: "active", active: true,
  };
  const event = {
    id: "event-1", connectionId: "connection-1", externalId: "external-1",
    occurredAt: "2026-09-30T09:00:00Z", receivedAt: "2026-09-30T10:00:00Z",
    category: "authentication", severity: "high", title: "Imported event",
    summary: "For review", subject: "subject", device: "device", sourceIp: "",
    entityId: "entity-1", originProduct: "Example", originEventId: "origin-1",
    identityState: "candidate", provenance: "manual_import",
  };
  const evidence = {
    id: "evidence-1", membershipId: membership.id, eventId: event.id,
    reason: "Analyst reference", status: "attached", attachedBy: "Analyst",
    attachedById: "user-1", attachedAt: "2026-09-30T10:30:00Z",
    retractedBy: "", retractedById: "", retractedAt: null,
    retractionReason: "", event,
  };
  const activity = {
    id: "membership:2", action: "membership.reviewed",
    occurredAt: "2026-09-30T11:00:00Z", actorId: "user-1",
    actor: "Analyst", actorNameSource: "recorded", version: 2,
    before: { ...membership, version: 1 }, after: membership,
    review: { decision: "continue", reason: "Review remains open", nextReviewOn: "2026-10-11" },
  };
  const evidenceActivity = {
    id: "evidence-attached:evidence-1", action: "membership_evidence.attached",
    occurredAt: "2026-09-30T10:30:00Z", actorId: "user-1",
    actor: "Analyst", actorNameSource: "recorded",
    evidence: {
      id: evidence.id, eventId: event.id, title: event.title, severity: event.severity,
      eventOccurredAt: event.occurredAt, originProduct: event.originProduct,
      originEventId: event.originEventId, identityState: event.identityState,
      provenance: event.provenance, reason: evidence.reason,
    },
  };
  const notification = {
    id: "notification-1", title: "Imported event", body: "Review requested",
    severity: "high", eventId: event.id, createdAt: "2026-09-30T10:00:00Z",
    readAt: null,
  };
  const audit = {
    id: 1, actor: "Analyst", action: "membership.reviewed",
    kind: "membership", createdAt: "2026-09-30T11:00:00Z",
  };

  let checked = 0;
  function expectResponse(name, actual, expected) {
    assert.equal(actual, expected, name);
    checked += 1;
  }

  expectResponse("audit page", shape.isAuditPageResponse(page(audit)), true);
  expectResponse("event page", shape.isEventPageResponse(page(event)), true);
  expectResponse("evidence page", shape.isMembershipEvidencePageResponse(page(evidence)), true);
  expectResponse("review activity page", shape.isMembershipActivityPageResponse(page(activity)), true);
  expectResponse("evidence activity page", shape.isMembershipActivityPageResponse(page(evidenceActivity)), true);
  expectResponse("notification page", shape.isNotificationPageResponse({ ...page(notification), unreadCount: 1 }), true);
  expectResponse("genuinely empty activity page", shape.isMembershipActivityPageResponse({ items: [], nextCursor: "" }), true);
  expectResponse("id-only audit", shape.isAuditPageResponse(page({ id: 1 })), false);
  expectResponse("id-only event", shape.isEventPageResponse(page({ id: event.id })), false);
  expectResponse("evidence without event", shape.isMembershipEvidencePageResponse(page({ ...evidence, event: undefined })), false);
  expectResponse("evidence with wrong event", shape.isMembershipEvidencePageResponse(page({ ...evidence, eventId: "other" })), false);
  expectResponse("activity without review", shape.isMembershipActivityPageResponse(page({ ...activity, review: undefined })), false);
  expectResponse("activity without evidence", shape.isMembershipActivityPageResponse(page({ ...evidenceActivity, evidence: undefined })), false);
  expectResponse("notification without read state", shape.isNotificationPageResponse({ ...page({ ...notification, readAt: undefined }), unreadCount: 1 }), false);
  expectResponse("notification without unread count", shape.isNotificationPageResponse(page(notification)), false);
  expectResponse("unknown event severity", shape.isEventPageResponse(page({ ...event, severity: "unknown" })), false);
  expectResponse("unknown evidence severity", shape.isMembershipActivityPageResponse(page({ ...evidenceActivity, evidence: { ...evidenceActivity.evidence, severity: "unknown" } })), false);

  const reviewCase = {
    id: "case-1", title: "Manual review file", summary: "Analyst review of imported source events",
    responsible: "Review team", status: "open", version: 2,
    createdAt: "2026-10-03T09:00:00Z", updatedAt: "2026-10-03T10:00:00Z",
    createdById: "user-1", createdBy: "Analyst", closedAt: null, closureReason: "",
  };
  const caseActivity = {
    id: "activity-1", caseId: reviewCase.id, version: 2, action: "noted", reason: "Manual review note",
    actorId: "user-1", actor: "Analyst", occurredAt: reviewCase.updatedAt,
    before: { ...reviewCase, version: 1, updatedAt: reviewCase.createdAt }, after: reviewCase,
  };
  const caseEvidence = { ...evidence, caseId: reviewCase.id };
  delete caseEvidence.membershipId;
  const actionResult = { case: reviewCase, activity: caseActivity };
  const evidenceResult = { case: reviewCase, evidence: caseEvidence };
  const closedCase = { ...reviewCase, status: "closed", closedAt: reviewCase.updatedAt, closureReason: "Review completed with reason" };
  expectResponse("case detail", cases.isCaseRecord(reviewCase), true);
  expectResponse("closed case detail", cases.isCaseRecord(closedCase), true);
  expectResponse("case list", cases.isCasePageResponse(page(reviewCase)), true);
  expectResponse("empty case list", cases.isCasePageResponse({ items: [], nextCursor: "" }), true);
  expectResponse("id-only case", cases.isCaseRecord({ id: reviewCase.id }), false);
  expectResponse("case without closure state", cases.isCaseRecord({ ...reviewCase, closedAt: undefined }), false);
  expectResponse("closed case without closure reason", cases.isCaseRecord({ ...closedCase, closureReason: "" }), false);
  expectResponse("case with invalid timestamp", cases.isCaseRecord({ ...reviewCase, updatedAt: "not-a-time" }), false);
  expectResponse("case with fractional version", cases.isCaseRecord({ ...reviewCase, version: 1.5 }), false);
  expectResponse("case activity", cases.isCaseActivityPageResponse(page(caseActivity)), true);
  expectResponse("case activity empty page", cases.isCaseActivityPageResponse({ items: [], nextCursor: "" }), true);
  const otherCaseActivity = {
    ...caseActivity, caseId: "other-case",
    before: { ...caseActivity.before, id: "other-case" },
    after: { ...caseActivity.after, id: "other-case" },
  };
  expectResponse("case activity bound page", cases.isCaseActivityPageForCase(page(caseActivity), reviewCase.id), true);
  expectResponse("case activity bound empty page", cases.isCaseActivityPageForCase({ items: [], nextCursor: "" }, reviewCase.id), true);
  expectResponse("case activity valid wrong target", cases.isCaseActivityPageForCase(page(otherCaseActivity), reviewCase.id), false);
  expectResponse("case activity mixed target page", cases.isCaseActivityPageForCase({ items: [caseActivity, otherCaseActivity], nextCursor: "" }, reviewCase.id), false);
  expectResponse("created case activity", cases.isCaseActivityRecord({ ...caseActivity, action: "created", version: 1, before: null, after: { ...reviewCase, version: 1 } }), true);
  expectResponse("created activity missing before", cases.isCaseActivityRecord({ ...caseActivity, action: "created", version: 1, before: undefined, after: { ...reviewCase, version: 1 } }), false);
  expectResponse("activity scope mismatch", cases.isCaseActivityRecord({ ...caseActivity, caseId: "other" }), false);
  expectResponse("activity after version mismatch", cases.isCaseActivityRecord({ ...caseActivity, after: { ...reviewCase, version: 3 } }), false);
  expectResponse("activity before version gap", cases.isCaseActivityRecord({ ...caseActivity, before: { ...reviewCase, version: 4 } }), false);
  expectResponse("invalid close status transition", cases.isCaseActivityRecord({ ...caseActivity, action: "closed" }), false);
  expectResponse("case action envelope", cases.isCaseActionResult(actionResult), true);
  expectResponse("case action missing envelope", cases.isCaseActionResult(reviewCase), false);
  expectResponse("case action contradictory snapshot", cases.isCaseActionResult({ ...actionResult, case: { ...reviewCase, responsible: "Different team" } }), false);
  expectResponse("case action bound version", cases.isCaseActionWriteResult(actionResult, reviewCase.id, 1), true);
  expectResponse("case action old write version", cases.isCaseActionWriteResult(actionResult, reviewCase.id, 2), false);
  expectResponse("case action wrong write target", cases.isCaseActionWriteResult(actionResult, "other", 1), false);
  expectResponse("case evidence page", cases.isCaseEvidencePageResponse(page(caseEvidence)), true);
  expectResponse("empty case evidence page", cases.isCaseEvidencePageResponse({ items: [], nextCursor: "" }), true);
  const otherCaseEvidence = { ...caseEvidence, caseId: "other-case" };
  expectResponse("case evidence bound page", cases.isCaseEvidencePageForCase(page(caseEvidence), reviewCase.id), true);
  expectResponse("case evidence bound empty page", cases.isCaseEvidencePageForCase({ items: [], nextCursor: "" }, reviewCase.id), true);
  expectResponse("case evidence valid wrong target", cases.isCaseEvidencePageForCase(page(otherCaseEvidence), reviewCase.id), false);
  expectResponse("case evidence mixed target page", cases.isCaseEvidencePageForCase({ items: [caseEvidence, otherCaseEvidence], nextCursor: "" }, reviewCase.id), false);
  expectResponse("membership evidence not case evidence", cases.isCaseEvidenceRecord(evidence), false);
  expectResponse("case evidence missing event", cases.isCaseEvidenceRecord({ ...caseEvidence, event: undefined }), false);
  expectResponse("case evidence wrong event", cases.isCaseEvidenceRecord({ ...caseEvidence, eventId: "other" }), false);
  expectResponse("case evidence contradictory status", cases.isCaseEvidenceRecord({ ...caseEvidence, retractedAt: reviewCase.updatedAt }), false);
  expectResponse("case evidence envelope", cases.isCaseEvidenceResult(evidenceResult), true);
  expectResponse("case evidence wrong scope", cases.isCaseEvidenceResult({ ...evidenceResult, evidence: { ...caseEvidence, caseId: "other" } }), false);
  expectResponse("case evidence bound version", cases.isCaseEvidenceWriteResult(evidenceResult, reviewCase.id, 1), true);
  expectResponse("case evidence old write version", cases.isCaseEvidenceWriteResult(evidenceResult, reviewCase.id, 2), false);
  expectResponse("case flat write wrong version", cases.isCaseWriteRecord(reviewCase, reviewCase.id, 2), false);

  const watchDay = "2026-10-04";
  const watchRequest = { limit: 20, alertKind: "all" };
  const watchUUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  function watchEntry(n, color, reviewOn, startsOn = "2026-10-01", endsOn = "2026-10-30") {
    const metadata = { version: 1, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z" };
    const entityId = watchUUID(100 + n), groupId = watchUUID(200 + n);
    return {
      entity: { ...metadata, id: entityId, kind: "account", name: `Review account ${n}`, department: "Review", description: "", identifier: `TEST\\account${n}`, personId: "", identityState: "candidate" },
      group: { ...metadata, id: groupId, name: `Review group ${n}`, color, description: "Manual review" },
      membership: { ...metadata, id: watchUUID(n), entityId, groupId, reason: "Reasoned manual tracking", responsible: "Review team", startsOn, endsOn, reviewOn, status: "active", active: startsOn <= watchDay && watchDay <= endsOn },
    };
  }
  const redEntry = watchEntry(1, "red", "2026-10-14");
  const yellowEntry = watchEntry(2, "yellow", watchDay);
  const expiredEntry = watchEntry(3, "orange", "2026-09-30", "2026-09-25", "2026-10-01");
  const watchOverview = {
    asOf: watchDay, generatedAt: "2026-10-04T10:00:00Z",
    selection: { q: "", entityKind: "all" },
    red: { items: [redEntry], nextCursor: "", total: 1, activeCount: 1 },
    yellow: { items: [yellowEntry], nextCursor: "", total: 1, activeCount: 1 },
    alerts: { items: [{ kind: "expired", record: expiredEntry }, { kind: "review_due", record: yellowEntry }, { kind: "red_priority", record: redEntry }], nextCursor: "", total: 3, filter: "all", counts: { expired: 1, review_due: 1, red_priority: 1, review_upcoming: 0 } },
    sourceNotifications: { unreadCount: 2 },
  };
  function watchMutation(name, mutate) {
    const value = structuredClone(watchOverview);
    mutate(value);
    expectResponse(name, watch.isWatchlistOverviewForRequest(value, watchRequest), false);
  }
  expectResponse("watchlist complete snapshot", watch.isWatchlistOverviewForRequest(watchOverview, watchRequest), true);
  const offsetWatch = structuredClone(watchOverview);
  for (const record of [...offsetWatch.red.items, ...offsetWatch.yellow.items, ...offsetWatch.alerts.items.map((item) => item.record)]) {
    for (const metadata of [record.membership, record.entity, record.group]) {
      metadata.createdAt = "2026-10-01T13:00:00.123456+03:00";
      metadata.updatedAt = "2026-10-01T04:30:00.123456-05:30";
    }
  }
  expectResponse("watchlist Windows RFC3339 metadata offsets", watch.isWatchlistOverviewForRequest(offsetWatch, watchRequest), true);
  watchMutation("watchlist UTC snapshot cannot use local day offset", (v) => { v.generatedAt = "2026-10-04T13:00:00+03:00"; });
  watchMutation("watchlist metadata without timezone", (v) => { v.red.items[0].membership.createdAt = "2026-10-01T10:00:00"; });
  watchMutation("watchlist impossible metadata local time", (v) => { v.red.items[0].membership.createdAt = "2026-10-01T24:00:00+03:00"; });
  watchMutation("watchlist impossible metadata offset", (v) => { v.red.items[0].membership.createdAt = "2026-10-01T10:00:00+25:00"; });
  watchMutation("watchlist impossible metadata local day", (v) => { v.red.items[0].membership.createdAt = "2026-02-30T10:00:00+03:00"; });
  watchMutation("watchlist missing unread state", (v) => { delete v.sourceNotifications.unreadCount; });
  watchMutation("watchlist negative unread", (v) => { v.sourceNotifications.unreadCount = -1; });
  watchMutation("watchlist noninteger total", (v) => { v.red.total = 1.5; });
  watchMutation("watchlist missing list", (v) => { delete v.yellow; });
  watchMutation("watchlist invalid calendar day", (v) => { v.asOf = "2026-02-30"; });
  watchMutation("watchlist mismatched snapshot day", (v) => { v.generatedAt = "2026-10-03T23:59:59Z"; });
  watchMutation("watchlist wrong group color", (v) => { v.red.items[0].group.color = "yellow"; });
  watchMutation("watchlist contradictory entity reference", (v) => { v.red.items[0].membership.entityId = watchUUID(999); });
  watchMutation("watchlist contradictory group reference", (v) => { v.red.items[0].membership.groupId = watchUUID(998); });
  watchMutation("watchlist closed row", (v) => { v.red.items[0].membership.status = "closed"; });
  watchMutation("watchlist stale active flag", (v) => { v.red.items[0].membership.active = false; });
  watchMutation("watchlist invalid interval", (v) => { v.red.items[0].membership.reviewOn = "2026-11-01"; });
  watchMutation("watchlist empty first page contradicts total", (v) => { v.red.items = []; });
  watchMutation("watchlist partial first page contradicts total", (v) => { v.red.total = 2; });
  watchMutation("watchlist duplicate membership", (v) => { v.red.items.push(structuredClone(v.red.items[0])); v.red.total = 2; v.red.activeCount = 2; });
  watchMutation("watchlist duplicate warning", (v) => { v.alerts.items.push(structuredClone(v.alerts.items[2])); v.alerts.total++; v.alerts.counts.red_priority++; });
  watchMutation("watchlist wrong warning classification", (v) => { v.alerts.items[2].kind = "review_due"; });
  watchMutation("watchlist unknown warning kind", (v) => { v.alerts.items[2].kind = "threat_confirmed"; });
  watchMutation("watchlist wrong warning total", (v) => { v.alerts.total++; });
  watchMutation("watchlist missing warning count", (v) => { delete v.alerts.counts.expired; });
  watchMutation("watchlist contradictory repeated snapshot", (v) => { v.alerts.items[2].record = structuredClone(v.alerts.items[2].record); v.alerts.items[2].record.membership.responsible = "Other team"; });
  watchMutation("watchlist unsorted warnings", (v) => { v.alerts.items.reverse(); });
  watchMutation("watchlist unbound cursor", (v) => { v.red.nextCursor = "next-page"; v.red.total = 25; });
  const emptyWatch = { asOf: watchDay, generatedAt: watchOverview.generatedAt, selection: { q: "", entityKind: "all" },
    red: { items: [], nextCursor: "", total: 0, activeCount: 0 }, yellow: { items: [], nextCursor: "", total: 0, activeCount: 0 },
    alerts: { items: [], nextCursor: "", total: 0, filter: "all", counts: { expired: 0, review_due: 0, red_priority: 0, review_upcoming: 0 } }, sourceNotifications: { unreadCount: 0 } };
  expectResponse("watchlist genuinely empty snapshot", watch.isWatchlistOverviewForRequest(emptyWatch, watchRequest), true);
  const filteredWatch = structuredClone(watchOverview);
  filteredWatch.alerts.items = [filteredWatch.alerts.items[1]];
  filteredWatch.alerts.total = 1; filteredWatch.alerts.filter = "review_due";
  expectResponse("watchlist filtered counts preserve other categories", watch.isWatchlistOverviewForRequest(filteredWatch, { limit: 20, alertKind: "review_due" }), true);
  expectResponse("watchlist response bound to filter", watch.isWatchlistOverviewForRequest(filteredWatch, watchRequest), false);
  const pagedWatch = structuredClone(watchOverview);
  pagedWatch.alerts.items = [pagedWatch.alerts.items[0]];
  pagedWatch.alerts.nextCursor = watchLogic.encodeWatchlistCursor({ version: 2, scope: "alerts", asOf: watchDay, filter: "all", reviewOn: expiredEntry.membership.reviewOn, id: expiredEntry.membership.id, rank: 1, searchKey: "", entityKind: "all" });
  expectResponse("watchlist valid independently paged warnings", watch.isWatchlistOverviewForRequest(pagedWatch, { limit: 1, alertKind: "all" }), true);
  const wrongScopeWatch = structuredClone(pagedWatch);
  wrongScopeWatch.alerts.nextCursor = watchLogic.encodeWatchlistCursor({ version: 2, scope: "red", asOf: watchDay, filter: "", reviewOn: expiredEntry.membership.reviewOn, id: expiredEntry.membership.id, rank: 0, searchKey: "", entityKind: "all" });
  expectResponse("watchlist cross-panel output cursor", watch.isWatchlistOverviewForRequest(wrongScopeWatch, { limit: 1, alertKind: "all" }), false);
  const warningKind = (record) => watchLogic.classifyWatchlistAlert(record, watchDay);
  expectResponse("watchlist expired takes priority", warningKind({ ...expiredEntry, group: { ...expiredEntry.group, color: "red" } }), "expired");
  expectResponse("watchlist due takes priority over red", warningKind({ ...yellowEntry, group: { ...yellowEntry.group, color: "red" } }), "review_due");
  expectResponse("watchlist active red tracks priority", warningKind(redEntry), "red_priority");
  expectResponse("watchlist upcoming includes day seven", warningKind(watchEntry(4, "yellow", "2026-10-11")), "review_upcoming");
  expectResponse("watchlist upcoming excludes day eight", warningKind(watchEntry(5, "yellow", "2026-10-12")), null);
  expectResponse("watchlist planned red has no warning", warningKind(watchEntry(6, "red", "2026-10-11", "2026-10-08")), null);
  expectResponse("watchlist closure clears warning", warningKind({ ...redEntry, membership: { ...redEntry.membership, status: "closed", active: false } }), null);
  expectResponse("watchlist expiry date inclusive", warningKind(watchEntry(7, "yellow", watchDay, "2026-10-01", watchDay)), "review_due");
  const sharedEntityWatch = structuredClone(watchOverview);
  sharedEntityWatch.yellow.items[0].entity = structuredClone(sharedEntityWatch.red.items[0].entity);
  sharedEntityWatch.yellow.items[0].membership.entityId = sharedEntityWatch.yellow.items[0].entity.id;
  sharedEntityWatch.alerts.items[1].record = structuredClone(sharedEntityWatch.yellow.items[0]);
  expectResponse("watchlist same entity in two different memberships", watch.isWatchlistOverviewForRequest(sharedEntityWatch, watchRequest), true);

  watchMutation("watchlist missing selection echo", (v) => { delete v.selection; });
  watchMutation("watchlist missing selected search", (v) => { delete v.selection.q; });
  watchMutation("watchlist unknown selected kind", (v) => { v.selection.entityKind = "directory_user"; });
  watchMutation("watchlist numeric selected search", (v) => { v.selection.q = 42; });
  watchMutation("watchlist untrimmed selected search", (v) => { v.selection.q = " Review "; });
  const searchWatch = structuredClone(watchOverview);
  searchWatch.selection.q = "Review";
  expectResponse("watchlist search selection exact request", watch.isWatchlistOverviewForRequest(searchWatch, { ...watchRequest, q: "Review" }), true);
  expectResponse("watchlist search selection canonical trim", watch.isWatchlistOverviewForRequest(searchWatch, { ...watchRequest, q: " Review " }), true);
  expectResponse("watchlist wrong search selection", watch.isWatchlistOverviewForRequest(searchWatch, { ...watchRequest, q: "Other" }), false);
  expectResponse("watchlist stale unfiltered response", watch.isWatchlistOverviewForRequest(watchOverview, { ...watchRequest, q: "Review" }), false);
  const accountWatch = structuredClone(watchOverview);
  accountWatch.selection.entityKind = "account";
  expectResponse("watchlist selected account kind", watch.isWatchlistOverviewForRequest(accountWatch, { ...watchRequest, entityKind: "account" }), true);
  expectResponse("watchlist wrong requested kind", watch.isWatchlistOverviewForRequest(accountWatch, { ...watchRequest, entityKind: "person" }), false);
  accountWatch.red.items[0].entity.kind = "person";
  expectResponse("watchlist row outside selected entity kind", watch.isWatchlistOverviewForRequest(accountWatch, { ...watchRequest, entityKind: "account" }), false);
  const noMatch = structuredClone(emptyWatch);
  noMatch.selection = { q: "missing", entityKind: "device" };
  noMatch.sourceNotifications.unreadCount = 2;
  expectResponse("watchlist empty search preserves personal unread", watch.isWatchlistOverviewForRequest(noMatch, { ...watchRequest, q: "missing", entityKind: "device" }), true);
  const unicodeQuery = "İnceleme 🛡️ <>&";
  const unicodeKey = watchLogic.encodeWatchlistSearchKey(unicodeQuery);
  expectResponse("watchlist Unicode key uses UTF8 URL base64", unicodeKey, Buffer.from(unicodeQuery, "utf8").toString("base64url"));
  const unicodeWatch = structuredClone(pagedWatch);
  unicodeWatch.selection.q = unicodeQuery;
  unicodeWatch.alerts.nextCursor = watchLogic.encodeWatchlistCursor({ version: 2, scope: "alerts", asOf: watchDay, filter: "all", reviewOn: expiredEntry.membership.reviewOn, id: expiredEntry.membership.id, rank: 1, searchKey: unicodeKey, entityKind: "all" });
  expectResponse("watchlist Unicode bound outgoing cursor", watch.isWatchlistOverviewForRequest(unicodeWatch, { limit: 1, alertKind: "all", q: unicodeQuery }), true);
  expectResponse("watchlist changed search outgoing cursor", watch.isWatchlistOverviewForRequest({ ...unicodeWatch, selection: { q: "Review", entityKind: "all" } }, { limit: 1, alertKind: "all", q: "Review" }), false);
  const legacyCursorWatch = structuredClone(pagedWatch);
  legacyCursorWatch.alerts.nextCursor = watchLogic.encodeWatchlistCursor({ version: 1, scope: "alerts", asOf: watchDay, filter: "all", reviewOn: expiredEntry.membership.reviewOn, id: expiredEntry.membership.id, rank: 1 });
  expectResponse("watchlist legacy unbound output cursor", watch.isWatchlistOverviewForRequest(legacyCursorWatch, { limit: 1, alertKind: "all" }), false);
  const selectedDemo = watchLogic.demoWatchlistOverview({ entities: [redEntry.entity, yellowEntry.entity, expiredEntry.entity], groups: [redEntry.group, yellowEntry.group, expiredEntry.group], memberships: [redEntry.membership, yellowEntry.membership, expiredEntry.membership], audit: [] }, 2, { limit: 20, alertKind: "all", q: "account 2", entityKind: "account" }, watchDay, watchOverview.generatedAt);
  expectResponse("watchlist demo filters before counts", selectedDemo.yellow.total === 1 && selectedDemo.red.total === 0 && selectedDemo.alerts.total === 1 && selectedDemo.alerts.counts.review_due === 1 && selectedDemo.sourceNotifications.unreadCount === 2, true);
  const literalDemoWorkspace = { entities: [{ ...redEntry.entity, name: "Hesap %_\\ 🛡️", identifier: "TEST\\%_\\" }, { ...yellowEntry.entity, name: "Hesap XYZ" }], groups: [redEntry.group, yellowEntry.group], memberships: [redEntry.membership, yellowEntry.membership], audit: [] };
  const literalDemo = watchLogic.demoWatchlistOverview(literalDemoWorkspace, 2, { limit: 20, alertKind: "all", q: "%_\\", entityKind: "all" }, watchDay, watchOverview.generatedAt);
  expectResponse("watchlist demo literal wildcard search", literalDemo.red.total === 1 && literalDemo.yellow.total === 0 && literalDemo.alerts.total === 1, true);

  const warningSummary = {
    asOf: watchDay,
    generatedAt: watchOverview.generatedAt,
    alerts: { total: 3, counts: { expired: 1, review_due: 1, red_priority: 1, review_upcoming: 0 } },
    sourceNotifications: { unreadCount: 2 },
  };
  function warningMutation(name, mutate) {
    const value = structuredClone(warningSummary);
    mutate(value);
    expectResponse(name, warnings.isWarningSummary(value), false);
  }
  expectResponse("warning summary coherent UTC snapshot", warnings.isWarningSummary(warningSummary), true);
  const emptySummary = structuredClone(warningSummary);
  emptySummary.alerts = { total: 0, counts: { expired: 0, review_due: 0, red_priority: 0, review_upcoming: 0 } };
  expectResponse("warning summary empty reviews preserves personal unread", warnings.isWarningSummary(emptySummary), true);
  const largeSummary = structuredClone(warningSummary);
  largeSummary.alerts.total = 1003; largeSummary.alerts.counts.red_priority = 1001;
  expectResponse("warning summary exceeds workspace collection cap", warnings.isWarningSummary(largeSummary), true);
  expectResponse("warning summary null is unknown not empty", warnings.isWarningSummary(null), false);
  expectResponse("warning summary missing response is unknown not empty", warnings.isWarningSummary({}), false);
  warningMutation("warning summary missing day", (v) => { delete v.asOf; });
  warningMutation("warning summary invalid calendar", (v) => { v.asOf = "2026-02-30"; });
  warningMutation("warning summary missing generation time", (v) => { delete v.generatedAt; });
  warningMutation("warning summary day and generation mismatch", (v) => { v.generatedAt = "2026-10-03T23:59:59Z"; });
  warningMutation("warning summary requires UTC Z", (v) => { v.generatedAt = "2026-10-04T13:00:00+03:00"; });
  warningMutation("warning summary impossible time", (v) => { v.generatedAt = "2026-10-04T24:00:00Z"; });
  warningMutation("warning summary missing review section", (v) => { delete v.alerts; });
  warningMutation("warning summary missing total", (v) => { delete v.alerts.total; });
  warningMutation("warning summary total cannot include personal unread", (v) => { v.alerts.total += v.sourceNotifications.unreadCount; });
  warningMutation("warning summary missing category", (v) => { delete v.alerts.counts.review_upcoming; });
  warningMutation("warning summary unknown threat category", (v) => { v.alerts.counts.confirmed_threat = 0; });
  warningMutation("warning summary negative category", (v) => { v.alerts.counts.expired = -1; v.alerts.total = 1; });
  warningMutation("warning summary fractional category", (v) => { v.alerts.counts.expired = 1.5; v.alerts.total = 3.5; });
  warningMutation("warning summary string total", (v) => { v.alerts.total = "3"; });
  warningMutation("warning summary unsafe total", (v) => { v.alerts.total = Number.MAX_SAFE_INTEGER + 1; });
  warningMutation("warning summary unsafe category sum", (v) => { v.alerts.counts.expired = Number.MAX_SAFE_INTEGER; v.alerts.counts.review_due = 1; v.alerts.counts.red_priority = 0; v.alerts.total = Number.MAX_SAFE_INTEGER; });
  warningMutation("warning summary missing personal notification section", (v) => { delete v.sourceNotifications; });
  warningMutation("warning summary missing personal unread", (v) => { delete v.sourceNotifications.unreadCount; });
  warningMutation("warning summary negative personal unread", (v) => { v.sourceNotifications.unreadCount = -1; });
  warningMutation("warning summary fractional personal unread", (v) => { v.sourceNotifications.unreadCount = 0.5; });
  warningMutation("warning summary string personal unread", (v) => { v.sourceNotifications.unreadCount = "2"; });
  const summaryDemoWorkspace = {
    entities: [redEntry.entity], groups: [redEntry.group], audit: [],
    memberships: Array.from({ length: 60 }, (_, i) => ({ ...redEntry.membership, id: watchUUID(2000 + i) })),
  };
  const summaryDemoBefore = JSON.stringify(summaryDemoWorkspace);
  const summaryDemo = warnings.demoWarningSummary(summaryDemoWorkspace, 2, watchDay, watchOverview.generatedAt);
  expectResponse("warning demo global counts before any first-page limit", summaryDemo.alerts.total === 60 && summaryDemo.alerts.counts.red_priority === 60 && summaryDemo.sourceNotifications.unreadCount === 2, true);
  expectResponse("warning demo uses coherent summary contract", warnings.isWarningSummary(summaryDemo), true);
  expectResponse("warning demo read leaves source workspace intact", JSON.stringify(summaryDemoWorkspace), summaryDemoBefore);

  // Dashboard: 14 consecutive UTC days, oldest first, non-negative integers.
  const board = await server.ssrLoadModule("/src/dashboardSummary.ts");
  const dashboardToday = "2026-10-05";
  const dashboardEvents = [
    { occurredAt: "2026-10-05T23:59:59Z", severity: "critical" },
    { occurredAt: "2026-10-05T00:00:00+03:00", severity: "high" },
    { occurredAt: "2026-09-22T00:00:00Z", severity: "low" },
    { occurredAt: "2026-09-21T23:59:59Z", severity: "medium" },
  ];
  const dashboard = board.buildDashboard(dashboardToday, dashboardEvents, [{ status: "open" }, { status: "closed" }, { status: "open" }], 3);
  const dashboardMutation = (name, mutate) => {
    const value = structuredClone(dashboard);
    mutate(value);
    expectResponse(name, board.isDashboardResponse(value), false);
  };
  expectResponse("dashboard built summary is valid", board.isDashboardResponse(dashboard), true);
  expectResponse("dashboard window ends today", dashboard.eventTrend.at(-1).day === dashboardToday && dashboard.eventTrend[0].day === "2026-09-22", true);
  expectResponse("dashboard buckets by UTC day", dashboard.eventTrend.at(-1).critical === 1 && dashboard.eventTrend.at(-2).high === 1 && dashboard.eventTrend[0].low === 1, true);
  expectResponse("dashboard totals include events before the window", dashboard.eventTotal === 4 && dashboard.eventSeverityTotals.medium === 1, true);
  expectResponse("dashboard case counts", dashboard.cases.open === 2 && dashboard.cases.closed === 1 && dashboard.sourceCount === 3, true);
  dashboardMutation("dashboard rejects 13 days", (v) => { v.eventTrend.pop(); });
  dashboardMutation("dashboard rejects reordered days", (v) => { v.eventTrend.reverse(); });
  dashboardMutation("dashboard rejects a gap in days", (v) => { v.eventTrend[5].day = "2026-09-30"; });
  dashboardMutation("dashboard rejects an invalid calendar day", (v) => { v.eventTrend[0].day = "2026-02-30"; });
  dashboardMutation("dashboard rejects a missing severity", (v) => { delete v.eventTrend[3].info; });
  dashboardMutation("dashboard rejects a negative count", (v) => { v.eventSeverityTotals.high = -1; });
  dashboardMutation("dashboard rejects a fractional count", (v) => { v.cases.open = 1.5; });
  dashboardMutation("dashboard rejects a string count", (v) => { v.eventTotal = "4"; });
  dashboardMutation("dashboard rejects a missing case section", (v) => { delete v.cases; });
  dashboardMutation("dashboard rejects a missing source count", (v) => { delete v.sourceCount; });
  dashboardMutation("dashboard rejects an unparseable timestamp", (v) => { v.generatedAt = "dün"; });

  console.log(`${checked} response contract cases passed`);
} finally {
  await server.close();
}
