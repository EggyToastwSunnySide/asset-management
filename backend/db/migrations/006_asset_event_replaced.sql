-- US16-T1: the asset activity timeline reuses asset_events. Its event types:
--   created, updated, archived (retired/removed), restored,
--   loaned (borrowed, US-10), returned (US-11), replaced (US-13, added here).
-- Every row is written in the same transaction as the change it records.
-- ADD VALUE may run inside the migration's transaction; the value is first used
-- by a later transaction.

ALTER TYPE asset_event_type ADD VALUE IF NOT EXISTS 'replaced';
