import { isEventPageResponse, isPageResponse, isRecord } from "./responseShape";
import type {
  CaseActionResult,
  CaseActivityEntry,
  CaseEventEvidence,
  CaseEvidenceResult,
  ReviewCase,
} from "./cases";

function strings(value: Record<string, unknown>, fields: string[]) {
  return fields.every((key) => typeof value[key] === "string");
}
function timestamp(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function version(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function isCaseRecord(value: unknown): value is ReviewCase {
  return (
    isRecord(value) &&
    strings(value, [
      "id",
      "title",
      "summary",
      "responsible",
      "createdById",
      "createdBy",
      "closureReason",
    ]) &&
    !!value.id &&
    !!value.title &&
    !!value.responsible &&
    !!value.createdById &&
    version(value.version) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    (value.status === "open"
      ? value.closedAt === null && value.closureReason === ""
      : value.status === "closed" &&
        timestamp(value.closedAt) &&
        typeof value.closureReason === "string" &&
        value.closureReason.trim().length > 0)
  );
}
export function isCasePageResponse(value: unknown): boolean {
  return isPageResponse(value, isCaseRecord);
}
export function isCaseActivityRecord(
  value: unknown,
): value is CaseActivityEntry {
  if (
    !isRecord(value) ||
    !strings(value, ["id", "caseId", "action", "reason", "actorId", "actor"]) ||
    !value.id ||
    !value.actorId ||
    !version(value.version) ||
    !timestamp(value.occurredAt) ||
    !isCaseRecord(value.after) ||
    value.after.id !== value.caseId ||
    value.after.version !== value.version
  )
    return false;
  if (value.action === "created")
    return value.before === null && value.version === 1;
  return (
    [
      "updated",
      "noted",
      "closed",
      "reopened",
      "event_attached",
      "event_retracted",
    ].includes(String(value.action)) &&
    isCaseRecord(value.before) &&
    value.before.id === value.caseId &&
    value.before.version === Number(value.version) - 1 &&
    (value.action === "closed"
      ? value.before.status === "open" && value.after.status === "closed"
      : value.action === "reopened"
        ? value.before.status === "closed" && value.after.status === "open"
        : value.before.status === "open" && value.after.status === "open")
  );
}
export function isCaseActivityPageResponse(value: unknown): boolean {
  return isPageResponse(value, isCaseActivityRecord);
}
export function isCaseActivityPageForCase(
  value: unknown,
  caseId: string,
): boolean {
  return isPageResponse(
    value,
    (item) => isCaseActivityRecord(item) && item.caseId === caseId,
  );
}
export function isCaseEvidenceRecord(
  value: unknown,
): value is CaseEventEvidence {
  return (
    isRecord(value) &&
    strings(value, [
      "id",
      "caseId",
      "eventId",
      "reason",
      "attachedBy",
      "attachedById",
      "retractedBy",
      "retractedById",
      "retractionReason",
    ]) &&
    !!value.id &&
    !!value.caseId &&
    !!value.eventId &&
    timestamp(value.attachedAt) &&
    (value.status === "attached"
      ? value.retractedAt === null
      : value.status === "retracted" && timestamp(value.retractedAt)) &&
    isEventPageResponse({ items: [value.event], nextCursor: "" }) &&
    isRecord(value.event) &&
    value.event.id === value.eventId
  );
}
export function isCaseEvidencePageResponse(value: unknown): boolean {
  return isPageResponse(value, isCaseEvidenceRecord);
}
export function isCaseEvidencePageForCase(
  value: unknown,
  caseId: string,
): boolean {
  return isPageResponse(
    value,
    (item) => isCaseEvidenceRecord(item) && item.caseId === caseId,
  );
}
export function isCaseActionResult(value: unknown): value is CaseActionResult {
  if (
    !isRecord(value) ||
    !isCaseRecord(value.case) ||
    !isCaseActivityRecord(value.activity)
  )
    return false;
  const { case: record, activity } = value;
  return (
    activity.caseId === record.id &&
    activity.version === record.version &&
    Object.keys(record).every(
      (key) =>
        record[key as keyof ReviewCase] ===
        activity.after[key as keyof ReviewCase],
    )
  );
}
export function isCaseEvidenceResult(
  value: unknown,
): value is CaseEvidenceResult {
  return (
    isRecord(value) &&
    isCaseRecord(value.case) &&
    isCaseEvidenceRecord(value.evidence) &&
    value.evidence.caseId === value.case.id
  );
}
export function isCaseWriteRecord(
  value: unknown,
  caseId: string,
  expectedVersion: number,
): value is ReviewCase {
  return (
    isCaseRecord(value) &&
    value.id === caseId &&
    value.version === expectedVersion + 1
  );
}
export function isCaseActionWriteResult(
  value: unknown,
  caseId: string,
  expectedVersion: number,
): value is CaseActionResult {
  return (
    isCaseActionResult(value) &&
    isCaseWriteRecord(value.case, caseId, expectedVersion)
  );
}
export function isCaseEvidenceWriteResult(
  value: unknown,
  caseId: string,
  expectedVersion: number,
): value is CaseEvidenceResult {
  return (
    isCaseEvidenceResult(value) &&
    isCaseWriteRecord(value.case, caseId, expectedVersion)
  );
}
