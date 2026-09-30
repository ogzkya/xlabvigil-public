-- Migration 5: indexed, literal substring search over normalized security-event fields.
-- New installations use public; an existing extension may live in another schema.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

DO $migration$
DECLARE
 extension_schema text;
 event_schema text;
BEGIN
 SELECT n.nspname INTO STRICT extension_schema
 FROM pg_extension e
 JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE e.extname = 'pg_trgm';

 SELECT n.nspname INTO STRICT event_schema
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = 'security_events'::regclass;

 EXECUTE format($index$
  CREATE INDEX security_events_search_trgm_idx ON %I.security_events USING gin (
   (title || ' ' || summary || ' ' || subject || ' ' || device || ' ' || COALESCE(host(source_ip), '') || ' ' || origin_product || ' ' || external_id || ' ' || origin_event_id) %I.gin_trgm_ops
  )
 $index$, event_schema, extension_schema);
END
$migration$;
