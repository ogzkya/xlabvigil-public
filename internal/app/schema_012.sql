-- Migration 12: independent, human-managed investigation files. A responsible
-- label is descriptive metadata, not assignment, authorization or verification.
CREATE TABLE investigation_cases (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160),
 summary text NOT NULL CHECK(char_length(summary) BETWEEN 10 AND 2000),
 responsible text NOT NULL CHECK(char_length(responsible) BETWEEN 2 AND 100),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_by_name text NOT NULL CHECK(char_length(created_by_name) BETWEEN 1 AND 160),
 creation_payload jsonb NOT NULL CHECK(jsonb_typeof(creation_payload)='object'),
 closed_at timestamptz,
 closure_reason text NOT NULL DEFAULT '',
 CHECK((status='open' AND closed_at IS NULL AND closure_reason='') OR
       (status='closed' AND closed_at IS NOT NULL AND char_length(closure_reason) BETWEEN 10 AND 2000))
);
CREATE INDEX investigation_cases_status_seq_idx ON investigation_cases(status,seq DESC);
DO $$
DECLARE extension_schema text;
BEGIN
 SELECT n.nspname INTO extension_schema FROM pg_extension e
 JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
 IF extension_schema IS NULL THEN RAISE EXCEPTION 'pg_trgm is required for case search'; END IF;
 EXECUTE format('CREATE INDEX investigation_cases_search_idx ON investigation_cases USING gin ((title || '' '' || summary || '' '' || responsible) %I.gin_trgm_ops)',extension_schema);
END $$;

CREATE TABLE case_history (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 case_id uuid NOT NULL REFERENCES investigation_cases(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN ('created','updated','noted','closed','reopened','event_attached','event_retracted')),
 reason text NOT NULL DEFAULT '',
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_name text NOT NULL CHECK(char_length(actor_name) BETWEEN 1 AND 160),
 occurred_at timestamptz NOT NULL,
 before_data jsonb,
 after_data jsonb NOT NULL CHECK(jsonb_typeof(after_data)='object'),
 UNIQUE(case_id,version),
 CHECK((version=1 AND action='created' AND before_data IS NULL) OR
       (version>1 AND action<>'created' AND before_data IS NOT NULL AND jsonb_typeof(before_data)='object')),
 CHECK((action IN ('created','updated') AND reason='') OR
       (action IN ('noted','closed','reopened') AND char_length(reason) BETWEEN 10 AND 2000) OR
       (action IN ('event_attached','event_retracted') AND char_length(reason) BETWEEN 10 AND 1000))
);
CREATE INDEX case_history_case_seq_idx ON case_history(case_id,seq DESC);

CREATE TABLE case_event_evidence (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 case_id uuid NOT NULL REFERENCES investigation_cases(id) ON DELETE RESTRICT,
 event_id uuid NOT NULL REFERENCES security_events(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 1000),
 attached_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 attached_by_name text NOT NULL CHECK(char_length(attached_by_name) BETWEEN 1 AND 160),
 attached_at timestamptz NOT NULL,
 retracted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 retracted_by_name text NOT NULL DEFAULT '',
 retracted_at timestamptz,
 retraction_reason text NOT NULL DEFAULT '',
 CHECK((retracted_at IS NULL AND retracted_by IS NULL AND retracted_by_name='' AND retraction_reason='') OR
       (retracted_at IS NOT NULL AND retracted_by IS NOT NULL AND char_length(retracted_by_name) BETWEEN 1 AND 160 AND char_length(retraction_reason) BETWEEN 10 AND 1000))
);
CREATE UNIQUE INDEX case_event_evidence_active_pair_idx ON case_event_evidence(case_id,event_id) WHERE retracted_at IS NULL;
CREATE INDEX case_event_evidence_case_seq_idx ON case_event_evidence(case_id,seq DESC);
