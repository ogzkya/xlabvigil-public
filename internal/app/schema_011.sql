-- Migration 11: explicit human review decisions alongside membership versions.
-- The existing history remains the activity source; decision metadata enriches
-- that same version and never creates a second activity for one review.
ALTER TABLE membership_history DROP CONSTRAINT membership_history_action_check;
ALTER TABLE membership_history ADD CONSTRAINT membership_history_action_check
 CHECK(action IN ('created','updated','reviewed'));

CREATE TABLE membership_reviews (
 membership_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>1),
 decision text NOT NULL CHECK(decision IN ('continue','close')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 1000),
 next_review_on date,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_name text NOT NULL CHECK(char_length(actor_name) BETWEEN 1 AND 160),
 reviewed_at timestamptz NOT NULL,
 PRIMARY KEY(membership_id,version),
 FOREIGN KEY(membership_id,version) REFERENCES membership_history(membership_id,version) ON DELETE RESTRICT,
 CHECK((decision='continue' AND next_review_on IS NOT NULL) OR (decision='close' AND next_review_on IS NULL))
);
