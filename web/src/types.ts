import type { SecurityEvent } from "./operations";

export type User = {
  id: string;
  name: string;
  username: string;
  role: "admin" | "analyst" | "member" | "viewer";
};
export type Status = {
  initialized: boolean;
  version: string;
  product: string;
  directoryConnected: boolean;
};
export type Page =
  | "home"
  | "watchlists"
  | "entities"
  | "groups"
  | "memberships"
  | "cases"
  | "sources"
  | "events"
  | "notifications"
  | "audit"
  | "users"
  | "account"
  | "settings";
export type EntityKind =
  "person" | "account" | "device" | "service" | "application";
export type Color = "yellow" | "orange" | "red" | "slate";
export type Versioned = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Entity = Versioned & {
  kind: EntityKind;
  name: string;
  department: string;
  description: string;
  identifier: string;
  personId: string;
  identityState: "candidate";
};
export type Group = Versioned & {
  name: string;
  color: Color;
  description: string;
};
export type Membership = Versioned & {
  entityId: string;
  groupId: string;
  reason: string;
  responsible: string;
  startsOn: string;
  endsOn: string;
  reviewOn: string;
  status: "active" | "closed";
  active: boolean;
};
export type MembershipHistory = {
  version: number;
  action: string;
  actor: string;
  createdAt: string;
  data: Membership;
};
export type MembershipReviewDecision = "continue" | "close";
export type MembershipReviewDetail = {
  decision: MembershipReviewDecision;
  reason: string;
  nextReviewOn: string;
};
export type MembershipReviewRecord = MembershipReviewDetail & {
  membershipId: string;
  version: number;
  actorId: string;
  actor: string;
  reviewedAt: string;
};
export type MembershipReviewResult = {
  membership: Membership;
  review: MembershipReviewRecord;
};
export type MembershipEventEvidence = {
  id: string;
  membershipId: string;
  eventId: string;
  reason: string;
  status: "attached" | "retracted";
  attachedBy: string;
  attachedById: string;
  attachedAt: string;
  retractedBy: string;
  retractedById: string;
  retractedAt: string | null;
  retractionReason: string;
  event: SecurityEvent;
};
export type MembershipActivityAction =
  | "membership.created"
  | "membership.updated"
  | "membership.reviewed"
  | "membership_evidence.attached"
  | "membership_evidence.retracted";
export type MembershipActivityEvidence = {
  id: string;
  eventId: string;
  title: string;
  severity: SecurityEvent["severity"];
  eventOccurredAt: string;
  originProduct: string;
  originEventId: string;
  provenance: SecurityEvent["provenance"];
  identityState: SecurityEvent["identityState"];
  reason: string;
};
export type MembershipActivityEntry = {
  id: string;
  action: MembershipActivityAction;
  occurredAt: string;
  actorId: string;
  actor: string;
  actorNameSource: "current_profile" | "recorded";
  version?: number;
  before?: Membership | null;
  after?: Membership | null;
  evidence?: MembershipActivityEvidence | null;
  review?: MembershipReviewDetail | null;
};
export type MembershipActivityPage = {
  items: MembershipActivityEntry[];
  nextCursor: string;
};
export type Audit = {
  id: number;
  actor: string;
  action: string;
  kind: string;
  createdAt: string;
};
export type Workspace = {
  entities: Entity[];
  groups: Group[];
  memberships: Membership[];
  audit: Audit[];
};
export type EditorState =
  | { kind: "entity"; value?: Entity }
  | { kind: "group"; value?: Group }
  | {
      kind: "membership";
      value?: Membership;
      entityId?: string;
      groupId?: string;
    };
export const entityLabels: Record<EntityKind, string> = {
  person: "Personel",
  account: "Hesap",
  device: "Cihaz",
  service: "Servis",
  application: "Uygulama",
};
export const colorLabels: Record<Color, string> = {
  yellow: "Sarı",
  orange: "Turuncu",
  red: "Kırmızı",
  slate: "Özel",
};
export const roleLabels: Record<User["role"], string> = {
  admin: "Yönetici",
  analyst: "Analist",
  member: "Üye",
  viewer: "Görüntüleyici",
};
export const utcToday = () => new Date().toISOString().slice(0, 10);
export function membershipState(
  m: Membership,
): "closed" | "expired" | "scheduled" | "active" {
  if (m.status === "closed") return "closed";
  if (m.active) return "active";
  if (m.endsOn < utcToday()) return "expired";
  return "scheduled";
}
export const membershipLabels = {
  active: "Etkin",
  scheduled: "Planlandı",
  expired: "Süresi doldu",
  closed: "Kapatıldı",
};
