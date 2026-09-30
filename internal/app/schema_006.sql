-- Migration 6: indexed, literal substring search for the shared notification inbox.
-- Migration 5 installs pg_trgm; find its actual schema for existing installations.
DO $migration$
DECLARE
 extension_schema text;
 notification_schema text;
BEGIN
 SELECT n.nspname INTO STRICT extension_schema
 FROM pg_extension e
 JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE e.extname = 'pg_trgm';

 SELECT n.nspname INTO STRICT notification_schema
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = 'notifications'::regclass;

 EXECUTE format($index$
  CREATE INDEX notifications_search_trgm_idx ON %I.notifications USING gin (
   (title || ' ' || body) %I.gin_trgm_ops
  )
 $index$, notification_schema, extension_schema);
END
$migration$;
