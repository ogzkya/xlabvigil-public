-- Migration 3: shared analyst inbox with personal read receipts; delivery configuration only.
CREATE TABLE notifications (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 event_id uuid NOT NULL UNIQUE REFERENCES security_events(id) ON DELETE RESTRICT,
 title text NOT NULL,
 body text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('high','critical')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_reads (
 notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(notification_id,user_id)
);
CREATE TABLE notification_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 provider text NOT NULL DEFAULT 'none' CHECK(provider IN ('none','smtp','graph')),
 host text NOT NULL DEFAULT '',
 port integer NOT NULL DEFAULT 0,
 from_address text NOT NULL DEFAULT '',
 recipient text NOT NULL DEFAULT '',
 secret_ref text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO notification_settings(id) VALUES(true);
