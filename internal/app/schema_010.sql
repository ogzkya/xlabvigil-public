-- Migration 10: read existing review actions as one paged activity timeline.
-- Every branch can seek by membership, action time and its own numeric sequence.
CREATE INDEX membership_history_activity_idx
 ON membership_history(membership_id,created_at DESC,version DESC);
CREATE INDEX membership_evidence_attached_activity_idx
 ON membership_event_evidence(membership_id,attached_at DESC,seq DESC);
CREATE INDEX membership_evidence_retracted_activity_idx
 ON membership_event_evidence(membership_id,retracted_at DESC,seq DESC)
 WHERE retracted_at IS NOT NULL;
