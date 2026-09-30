-- Migration 1: standalone Vigil. Append future migrations instead of editing this file.
CREATE TABLE vigil_product (id boolean PRIMARY KEY DEFAULT true CHECK(id), name text NOT NULL CHECK(name='XLab Vigil'));
INSERT INTO vigil_product(id,name) VALUES(true,'XLab Vigil');
CREATE TABLE users (
 id uuid PRIMARY KEY,
 username text NOT NULL UNIQUE,
 name text NOT NULL,
 password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','analyst','member','viewer')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE entities (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('person','account','device','service','application')),
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 160),
 department text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '',
 identifier text NOT NULL DEFAULT '',
 person_id uuid REFERENCES entities(id) ON DELETE RESTRICT,
 identity_state text NOT NULL DEFAULT 'candidate' CHECK(identity_state='candidate'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(person_id IS NULL OR (kind IN ('account','device') AND person_id<>id))
);
CREATE INDEX entities_person_idx ON entities(person_id);
CREATE TABLE risk_groups (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 120),
 color text NOT NULL CHECK(color IN ('yellow','orange','red','slate')),
 description text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY,
 entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
 group_id uuid NOT NULL REFERENCES risk_groups(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 4000),
 responsible text NOT NULL CHECK(char_length(responsible) BETWEEN 2 AND 160),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 review_on date NOT NULL,
 status text NOT NULL CHECK(status IN ('active','closed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(starts_on<=review_on AND review_on<=ends_on AND ends_on-starts_on<=366)
);
CREATE UNIQUE INDEX memberships_open_pair_idx ON memberships(entity_id,group_id) WHERE status='active';
CREATE INDEX memberships_group_idx ON memberships(group_id);
CREATE TABLE membership_history (
 membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
 version integer NOT NULL,
 action text NOT NULL CHECK(action IN ('created','updated')),
 actor_id uuid NOT NULL REFERENCES users(id),
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(membership_id,version)
);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES users(id),
 action text NOT NULL,
 kind text NOT NULL DEFAULT '',
 record_id uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
