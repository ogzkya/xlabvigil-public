-- Migration 2: source configuration and explicitly imported normalized events.
-- Registering a source does not connect to a provider or start a collector.
CREATE TABLE source_connections (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 160),
 provider text NOT NULL CHECK(provider IN ('ldap_ad','windows_wef','palo_alto','logsign','trend_vision_one','trend_apex_one','trend_deep_security','custom')),
 transport text NOT NULL CHECK(transport IN ('ldaps','wef_https','syslog_tls','api_https','manual_json')),
 endpoint text NOT NULL DEFAULT '' CHECK(char_length(endpoint)<=2048),
 product_version text NOT NULL DEFAULT '' CHECK(char_length(product_version)<=160),
 scope text NOT NULL DEFAULT '' CHECK(char_length(scope)<=2000),
 secret_ref text NOT NULL DEFAULT '' CHECK(secret_ref='' OR secret_ref ~ '^env:[A-Z_][A-Z0-9_]{0,127}$'),
 status text NOT NULL DEFAULT 'configured' CHECK(status IN ('configured','paused')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_received_at timestamptz,
 event_count bigint NOT NULL DEFAULT 0 CHECK(event_count>=0),
 CHECK((provider='ldap_ad' AND transport='ldaps') OR (provider='windows_wef' AND transport IN ('wef_https','manual_json')) OR (provider='trend_vision_one' AND transport IN ('api_https','manual_json')) OR (provider IN ('palo_alto','logsign','trend_apex_one','trend_deep_security','custom') AND transport IN ('syslog_tls','api_https','manual_json')))
);
CREATE TABLE security_events (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 connection_id uuid NOT NULL REFERENCES source_connections(id) ON DELETE RESTRICT,
 external_id text NOT NULL CHECK(char_length(external_id) BETWEEN 1 AND 256),
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 category text NOT NULL CHECK(category IN ('authentication','authorization','account_lifecycle','network','endpoint','email','data_access','other')),
 severity text NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 2 AND 240),
 summary text NOT NULL DEFAULT '' CHECK(char_length(summary)<=2000),
 subject text NOT NULL DEFAULT '' CHECK(char_length(subject)<=256),
 device text NOT NULL DEFAULT '' CHECK(char_length(device)<=256),
 source_ip inet,
 entity_id uuid REFERENCES entities(id) ON DELETE RESTRICT,
 identity_state text NOT NULL CHECK(identity_state IN ('candidate','unlinked')),
 provenance text NOT NULL DEFAULT 'manual_import' CHECK(provenance='manual_import'),
 origin_product text NOT NULL DEFAULT '' CHECK(char_length(origin_product)<=160),
 origin_event_id text NOT NULL DEFAULT '' CHECK(char_length(origin_event_id)<=256),
 content_hash text NOT NULL CHECK(char_length(content_hash)=64),
 UNIQUE(connection_id,external_id),
 CHECK((entity_id IS NULL AND identity_state='unlinked') OR (entity_id IS NOT NULL AND identity_state='candidate'))
);
CREATE INDEX security_events_connection_seq_idx ON security_events(connection_id,seq DESC);
CREATE INDEX security_events_severity_seq_idx ON security_events(severity,seq DESC);
CREATE INDEX security_events_entity_idx ON security_events(entity_id) WHERE entity_id IS NOT NULL;
