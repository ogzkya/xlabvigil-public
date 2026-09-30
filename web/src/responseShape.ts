import { providers } from "./sourceCatalog.ts";
import { categoryLabels, severityLabels } from "./eventCatalog.ts";

// A successful HTTP status is not enough to turn a malformed collection into
// an empty state. Keep these envelope checks close to the shared API boundary.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasStringId(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function hasStrings(value: Record<string, unknown>, fields: readonly string[]) {
  return fields.every((field) => typeof value[field] === "string");
}

function isVersioned(value: unknown): value is Record<string, unknown> {
  return hasStringId(value) &&
    typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version > 0 &&
    hasStrings(value, ["createdAt", "updatedAt"]);
}

export function isEntityRecord(value: unknown): boolean {
  return isVersioned(value) &&
    (value.kind === "person" || value.kind === "account" ||
      value.kind === "device" || value.kind === "service" || value.kind === "application") &&
    value.identityState === "candidate" &&
    hasStrings(value, ["name", "department", "description", "identifier", "personId"]);
}

export function isGroupRecord(value: unknown): boolean {
  return isVersioned(value) &&
    (value.color === "yellow" || value.color === "orange" ||
      value.color === "red" || value.color === "slate") &&
    hasStrings(value, ["name", "description"]);
}

export function isMembershipRecord(value: unknown): boolean {
  return isVersioned(value) &&
    (value.status === "active" || value.status === "closed") &&
    typeof value.active === "boolean" &&
    hasStrings(value, ["entityId", "groupId", "reason", "responsible", "startsOn", "endsOn", "reviewOn"]);
}

export function isConnectionRecord(value: unknown): boolean {
  return isVersioned(value) &&
    (value.status === "configured" || value.status === "paused") &&
    hasStrings(value, ["name", "provider", "transport", "endpoint", "productVersion", "scope", "secretRef"]) &&
    providers.some((provider) => provider.id === value.provider && provider.transports.includes(value.transport as string)) &&
    (value.lastReceivedAt === null || typeof value.lastReceivedAt === "string") &&
    typeof value.eventCount === "number" && Number.isSafeInteger(value.eventCount) && value.eventCount >= 0;
}

export function isManagedUserRecord(value: unknown): boolean {
  return isVersioned(value) &&
    (value.role === "admin" || value.role === "analyst" ||
      value.role === "member" || value.role === "viewer") &&
    typeof value.active === "boolean" &&
    hasStrings(value, ["username", "name"]);
}

export function isEntityCollection(value: unknown): boolean {
  return Array.isArray(value) && value.every(isEntityRecord);
}

export function isGroupCollection(value: unknown): boolean {
  return Array.isArray(value) && value.every(isGroupRecord);
}

export function isMembershipCollection(value: unknown): boolean {
  return Array.isArray(value) && value.every(isMembershipRecord);
}

export function isConnectionCollection(value: unknown): boolean {
  return Array.isArray(value) && value.every(isConnectionRecord);
}

export function isManagedUserCollection(value: unknown): boolean {
  return Array.isArray(value) && value.every(isManagedUserRecord);
}

function isAuditRecord(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 &&
    hasStrings(value, ["actor", "action", "kind", "createdAt"]);
}

function isSecurityEventRecord(value: unknown): boolean {
  return hasStringId(value) &&
    hasStrings(value, [
      "connectionId", "externalId", "occurredAt", "receivedAt", "title", "summary",
      "subject", "device", "sourceIp", "entityId", "originProduct", "originEventId",
    ]) &&
    typeof value.category === "string" && Object.hasOwn(categoryLabels, value.category) &&
    typeof value.severity === "string" && Object.hasOwn(severityLabels, value.severity) &&
    (value.identityState === "candidate" || value.identityState === "unlinked") &&
    value.provenance === "manual_import";
}

function isMembershipEvidenceRecord(value: unknown): boolean {
  return hasStringId(value) &&
    hasStrings(value, [
      "membershipId", "eventId", "reason", "attachedBy", "attachedById", "attachedAt",
      "retractedBy", "retractedById", "retractionReason",
    ]) &&
    (value.status === "attached" || value.status === "retracted") &&
    (value.retractedAt === null || typeof value.retractedAt === "string") &&
    value.status === (value.retractedAt === null ? "attached" : "retracted") &&
    isSecurityEventRecord(value.event) &&
    isRecord(value.event) && value.event.id === value.eventId;
}

function isActivityReview(value: unknown): boolean {
  return isRecord(value) &&
    (value.decision === "continue" || value.decision === "close") &&
    hasStrings(value, ["reason", "nextReviewOn"]);
}

function isActivityEvidence(value: unknown): boolean {
  return hasStringId(value) &&
    hasStrings(value, [
      "eventId", "title", "eventOccurredAt", "originProduct", "originEventId", "reason",
    ]) &&
    typeof value.severity === "string" && Object.hasOwn(severityLabels, value.severity) &&
    (value.identityState === "candidate" || value.identityState === "unlinked") &&
    value.provenance === "manual_import";
}

function isMembershipActivityRecord(value: unknown): boolean {
  if (!hasStringId(value) ||
    !hasStrings(value, ["action", "occurredAt", "actorId", "actor"]) ||
    (value.actorNameSource !== "current_profile" && value.actorNameSource !== "recorded")) {
    return false;
  }
  if (value.action === "membership.created" ||
    value.action === "membership.updated" ||
    value.action === "membership.reviewed") {
    return typeof value.version === "number" &&
      Number.isSafeInteger(value.version) && value.version > 0 &&
      isMembershipRecord(value.after) &&
      (value.before === undefined || value.before === null || isMembershipRecord(value.before)) &&
      (value.evidence === undefined || value.evidence === null) &&
      (value.action === "membership.reviewed"
        ? isActivityReview(value.review) && value.actorNameSource === "recorded"
        : value.review === undefined || value.review === null);
  }
  if (value.action === "membership_evidence.attached" ||
    value.action === "membership_evidence.retracted") {
    return isActivityEvidence(value.evidence) &&
      value.actorNameSource === "recorded" &&
      (value.before === undefined || value.before === null) &&
      (value.after === undefined || value.after === null) &&
      (value.review === undefined || value.review === null);
  }
  return false;
}

function isNotificationRecord(value: unknown): boolean {
  return hasStringId(value) &&
    hasStrings(value, ["title", "body", "eventId", "createdAt"]) &&
    typeof value.severity === "string" && Object.hasOwn(severityLabels, value.severity) &&
    (value.readAt === null || typeof value.readAt === "string");
}

export function isPageResponse(value: unknown, isItem: (item: unknown) => boolean): boolean {
  return isRecord(value) &&
    Array.isArray(value.items) && value.items.every(isItem) &&
    typeof value.nextCursor === "string";
}

export function isCountedPageResponse(value: unknown, isItem: (item: unknown) => boolean): boolean {
  return isPageResponse(value, isItem) &&
    isRecord(value) &&
    typeof value.unreadCount === "number" &&
    Number.isSafeInteger(value.unreadCount) &&
    value.unreadCount >= 0;
}

export function isAuditPageResponse(value: unknown): boolean {
  return isPageResponse(value, isAuditRecord);
}

export function isEventPageResponse(value: unknown): boolean {
  return isPageResponse(value, isSecurityEventRecord);
}

export function isMembershipEvidencePageResponse(value: unknown): boolean {
  return isPageResponse(value, isMembershipEvidenceRecord);
}

export function isMembershipActivityPageResponse(value: unknown): boolean {
  return isPageResponse(value, isMembershipActivityRecord);
}

export function isNotificationPageResponse(value: unknown): boolean {
  return isCountedPageResponse(value, isNotificationRecord);
}

export function isLatestReviewResponse(value: unknown): boolean {
  if (!isRecord(value) || !("review" in value)) return false;
  if (value.review === null) return true;
  return isMembershipReviewRecord(value.review);
}

function isMembershipReviewRecord(review: unknown): review is Record<string, unknown> {
  return isRecord(review) &&
    (review.decision === "continue" || review.decision === "close") &&
    hasStrings(review, ["membershipId", "reason", "nextReviewOn", "actorId", "actor", "reviewedAt"]) &&
    typeof review.version === "number" &&
    Number.isSafeInteger(review.version) && review.version > 0;
}

export function isMembershipReviewResult(value: unknown): boolean {
  return isRecord(value) &&
    isMembershipRecord(value.membership) &&
    isMembershipReviewRecord(value.review) &&
    isRecord(value.membership) &&
    value.review.membershipId === value.membership.id &&
    value.review.version === value.membership.version;
}

export function isNotificationSettingsResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.provider === "none" || value.provider === "smtp" || value.provider === "graph") &&
    value.status === "delivery_disabled" &&
    typeof value.host === "string" &&
    typeof value.fromAddress === "string" &&
    typeof value.recipient === "string" &&
    typeof value.secretRef === "string" &&
    typeof value.port === "number" &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.port) &&
    Number.isSafeInteger(value.version);
}

export function isStatusResponse(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.initialized === "boolean" &&
    typeof value.version === "string" &&
    typeof value.product === "string" &&
    typeof value.directoryConnected === "boolean";
}

export function isSessionResponse(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  const user = value.user;
  return typeof user.id === "string" &&
    typeof user.name === "string" &&
    typeof user.username === "string" &&
    (user.role === "admin" || user.role === "analyst" ||
      user.role === "member" || user.role === "viewer");
}
