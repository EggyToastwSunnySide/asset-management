-- US13-T2: old-to-new asset replacement (FR-08, BR-05). One row per replaced
-- asset; it is written in the same transaction as the old asset's status change
-- to REPLACED and the 'replaced' asset events.

INSERT INTO asset_statuses (code, name) VALUES
  ('REPLACED', 'Đã thay thế')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE asset_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_asset_id uuid NOT NULL,
  new_asset_id uuid NOT NULL,
  replaced_on date NOT NULL,
  reason text NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_asset_replacements_old_asset UNIQUE (old_asset_id),
  CONSTRAINT ck_asset_replacements_distinct
    CHECK (old_asset_id <> new_asset_id),
  CONSTRAINT ck_asset_replacements_reason_nonblank
    CHECK (btrim(reason) <> ''),
  CONSTRAINT fk_asset_replacements_old_asset
    FOREIGN KEY (old_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_replacements_new_asset
    FOREIGN KEY (new_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_replacements_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_asset_replacements_new_asset
  ON asset_replacements (new_asset_id);

COMMENT ON TABLE asset_replacements IS
  'Old-to-new asset replacement relationship with its date and reason.';
