import { useId } from "react";
import { Badge } from "./components";
import {
  classifyMembershipReview,
  matchesReviewQueue,
  reviewBucketLabels,
  reviewBucketTone,
  reviewQueueFilters,
} from "./reviewSchedule";
import type { ReviewQueueFilter } from "./reviewSchedule";
import type { Membership } from "./types";

const queueDescriptions: Record<ReviewQueueFilter, string> = {
  attention: "Gözden geçirme tarihi geciken, bugün gelen veya süresi dolduğu halde açık kalan üyelikler.",
  overdue: "Gözden geçirme tarihi geçmiş, üyelik süresi devam eden açık kayıtlar.",
  today: "Gözden geçirme tarihi UTC bugününe gelen açık üyelikler.",
  upcoming: "Gözden geçirme tarihi yarından başlayarak sonraki 7 UTC günü içinde olan açık üyelikler. Planlanmış üyelikler de dahildir.",
  expired: "Bitiş günü geçmiş ancak kapatılmamış üyelikler. Ayrıntıdan kapatma kararı kaydedebilir veya üyelik tarihlerini düzenleyebilirsiniz.",
};

export function ReviewQueueFilters({
  memberships,
  today,
  value,
  onChange,
}: {
  memberships: Membership[];
  today: string;
  value: ReviewQueueFilter;
  onChange: (filter: ReviewQueueFilter) => void;
}) {
  const descriptionId = useId();
  const buckets = memberships.map((membership) => classifyMembershipReview(membership, today));
  return (
    <section className="review-queue" aria-label="Gözden geçirme iş listesi">
      <div className="review-queue-filters" role="group" aria-label="Gözden geçirme zamanı" aria-describedby={descriptionId}>
        {reviewQueueFilters.map((filter) => {
          const count = buckets.filter((bucket) => matchesReviewQueue(bucket, filter.value)).length;
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={value === filter.value}
              onClick={() => onChange(filter.value)}
            >
              <span>{filter.label}</span>
              <span className="review-queue-count">{count}<span className="sr-only"> üyelik</span></span>
            </button>
          );
        })}
      </div>
      <p id={descriptionId} className="review-queue-description">{queueDescriptions[value]}</p>
      <p className="review-queue-scope">Sayaçlar mevcut arama ve grup filtresine uyan üyelikleri gösterir. Gün sınırı UTC; bitiş günü dahildir.</p>
    </section>
  );
}

export function ReviewScheduleBadge({ membership, today }: { membership: Membership; today: string }) {
  const bucket = classifyMembershipReview(membership, today);
  return (
    <span className="review-queue-status">
      <Badge tone={reviewBucketTone[bucket]}>{reviewBucketLabels[bucket]}</Badge>
    </span>
  );
}
