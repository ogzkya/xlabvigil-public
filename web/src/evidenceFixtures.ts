import { demoWorkspace } from "./demo";
import { demoEvents } from "./demoFixtures";
import type { MembershipEventEvidence } from "./types";

// Shared browser-only example for the reference list and activity timeline.
export function demoMembershipEvidence(
  membershipId: string,
  entityId: string,
): MembershipEventEvidence[] {
  const membership = demoWorkspace().memberships.find(
    (item) => item.id === membershipId,
  );
  const event = demoEvents.find(
    (item) => item.entityId === entityId && item.identityState === "candidate",
  );
  if (
    membershipId !== "demo-m2" ||
    entityId !== "demo-account-1" ||
    !membership ||
    !event
  ) {
    return [];
  }
  return [
    {
      id: "demo-evidence-1",
      membershipId,
      eventId: event.id,
      reason:
        "Kurgusal incelemeci, örnek başarısız giriş olayını ayrıcalıklı hesap incelemesiyle ilgili buldu.",
      status: "attached",
      attachedAt: membership.createdAt,
      attachedBy: "Örnek İncelemeci",
      attachedById: "demo-reviewer",
      retractedAt: null,
      retractedBy: "",
      retractedById: "",
      retractionReason: "",
      event,
    },
  ];
}
