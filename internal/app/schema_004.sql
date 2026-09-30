-- Migration 4: local account lifecycle and optimistic user updates.
ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
