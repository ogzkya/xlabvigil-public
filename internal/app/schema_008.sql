-- Migration 8: page candidate-linked events for one entity in sequence order.
CREATE INDEX security_events_candidate_entity_seq_idx
 ON security_events(entity_id, seq DESC)
 WHERE identity_state='candidate';
