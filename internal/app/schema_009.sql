-- Migration 9: reviewer-curated event references for one review membership.
-- A reference is an application review action, not verification of event origin.
CREATE TABLE membership_event_evidence (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
 event_id uuid NOT NULL REFERENCES security_events(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 1000),
 attached_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 attached_by_name text NOT NULL CHECK(char_length(attached_by_name) BETWEEN 1 AND 160),
 attached_at timestamptz NOT NULL DEFAULT now(),
 retracted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 retracted_by_name text NOT NULL DEFAULT '',
 retracted_at timestamptz,
 retraction_reason text NOT NULL DEFAULT '',
 CHECK (
  (retracted_at IS NULL AND retracted_by IS NULL AND retracted_by_name='' AND retraction_reason='')
  OR
  (retracted_at IS NOT NULL AND retracted_by IS NOT NULL AND char_length(retracted_by_name) BETWEEN 1 AND 160 AND char_length(retraction_reason) BETWEEN 10 AND 1000)
 )
);
CREATE UNIQUE INDEX membership_event_evidence_active_pair_idx
 ON membership_event_evidence(membership_id,event_id)
 WHERE retracted_at IS NULL;
CREATE INDEX membership_event_evidence_membership_seq_idx
 ON membership_event_evidence(membership_id,seq DESC);
