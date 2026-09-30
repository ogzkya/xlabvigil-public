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

  console.log(`${checked} response contract cases passed`);
} finally {
  await server.close();
}
