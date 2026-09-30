-- Migration 7: indexed audit search by actor, action, and record kind.
-- Migration 5 installs pg_trgm; find its schema for existing installations.
DO $migration$
DECLARE
 extension_schema text;
 audit_schema text;
 user_schema text;
BEGIN
 SELECT n.nspname INTO STRICT extension_schema
 FROM pg_extension e
 JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE e.extname = 'pg_trgm';

 SELECT n.nspname INTO STRICT audit_schema
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = 'audit_events'::regclass;

 SELECT n.nspname INTO STRICT user_schema
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = 'users'::regclass;

 EXECUTE format('CREATE INDEX audit_events_action_trgm_idx ON %I.audit_events USING gin (action %I.gin_trgm_ops)', audit_schema, extension_schema);
 EXECUTE format('CREATE INDEX audit_events_kind_trgm_idx ON %I.audit_events USING gin (kind %I.gin_trgm_ops)', audit_schema, extension_schema);
 EXECUTE format('CREATE INDEX users_name_trgm_idx ON %I.users USING gin (name %I.gin_trgm_ops)', user_schema, extension_schema);
 EXECUTE format('CREATE INDEX audit_events_actor_id_idx ON %I.audit_events(actor_id,id DESC)', audit_schema);
 EXECUTE format('CREATE INDEX audit_events_action_id_idx ON %I.audit_events(action,id DESC)', audit_schema);
END
$migration$;
