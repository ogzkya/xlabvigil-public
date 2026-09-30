import type { BadgeTone } from "./design";
import type { Membership } from "./types";

export type ReviewBucket =
  | "overdue"
  | "today"
  | "upcoming"
  | "expired"
  | "later"
  | "closed";
export type ReviewQueueFilter = "attention" | "overdue" | "today" | "upcoming" | "expired";

export const reviewBucketLabels: Record<ReviewBucket, string> = {
  overdue: "Gözden geçirme gecikti",
  today: "Gözden geçirme bugün",
  upcoming: "7 gün içinde",
  expired: "Süresi doldu · açık",
  later: "İleri tarihli gözden geçirme",
  closed: "Üyelik kapalı",
};

export const reviewBucketTone: Record<ReviewBucket, BadgeTone> = {
  overdue: "orange",
  today: "yellow",
  upcoming: "neutral",
  expired: "orange",
  later: "slate",
  closed: "slate",
};

export const reviewQueueFilters: { value: ReviewQueueFilter; label: string }[] = [
  { value: "attention", label: "İşlem bekleyen" },
  { value: "overdue", label: "Geciken" },
  { value: "today", label: "Bugün" },
  { value: "upcoming", label: "7 gün içinde" },
  { value: "expired", label: "Süresi doldu, açık" },
];

// Dates are canonical UTC dates from the membership API. Callers share one
// `today` value per render so counters, filters and badges use the same day.
export function classifyMembershipReview(membership: Membership, today: string): ReviewBucket {
  if (membership.status === "closed") return "closed";
  if (membership.endsOn < today) return "expired";
  if (membership.reviewOn < today) return "overdue";
  if (membership.reviewOn === today) return "today";
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  if (membership.reviewOn <= weekEnd.toISOString().slice(0, 10)) return "upcoming";
  return "later";
}

export function reviewNeedsAttention(bucket: ReviewBucket) {
  return bucket === "overdue" || bucket === "today" || bucket === "expired";
}

export function matchesReviewQueue(bucket: ReviewBucket, filter: ReviewQueueFilter) {
  return filter === "attention" ? reviewNeedsAttention(bucket) : bucket === filter;
}

function compareText(a: string, b: string) {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function compareMembershipReview(a: Membership, b: Membership) {
  return compareText(a.reviewOn, b.reviewOn) || compareText(a.endsOn, b.endsOn) || compareText(a.id, b.id);
}
