-- Forward-migrate databases created before US-17/US-18 while remaining safe
-- for Docker databases whose bootstrap schema already contains these objects.

DO $$
BEGIN
  CREATE TYPE attribute_data_type AS ENUM ('text', 'number', 'date', 'boolean');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS asset_type_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type_id uuid NOT NULL,
  key varchar(32) NOT NULL,
  label varchar(255) NOT NULL,
  data_type attribute_data_type NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS extended_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'asset_type_attributes'::regclass
       AND conname = 'uq_asset_type_attributes_key'
  ) THEN
    ALTER TABLE asset_type_attributes
      ADD CONSTRAINT uq_asset_type_attributes_key UNIQUE (asset_type_id, key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'asset_type_attributes'::regclass
       AND conname = 'ck_asset_type_attributes_key'
  ) THEN
    ALTER TABLE asset_type_attributes
      ADD CONSTRAINT ck_asset_type_attributes_key CHECK (key ~ '^[a-z][a-z0-9_]*$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'asset_type_attributes'::regclass
       AND conname = 'ck_asset_type_attributes_label_nonblank'
  ) THEN
    ALTER TABLE asset_type_attributes
      ADD CONSTRAINT ck_asset_type_attributes_label_nonblank CHECK (btrim(label) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'asset_type_attributes'::regclass
       AND conname = 'fk_asset_type_attributes_type'
  ) THEN
    ALTER TABLE asset_type_attributes
      ADD CONSTRAINT fk_asset_type_attributes_type
        FOREIGN KEY (asset_type_id) REFERENCES asset_types(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'assets'::regclass
       AND conname = 'ck_assets_extended_attributes_object'
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT ck_assets_extended_attributes_object
        CHECK (jsonb_typeof(extended_attributes) = 'object');
  END IF;
END;
$$;

-- lower() rather than citext: needs a UTF8 database so Vietnamese letters fold too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_types_name_ci
  ON asset_types (lower(name));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'asset_type_attributes'::regclass
       AND tgname = 'asset_type_attributes_set_updated_at'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER asset_type_attributes_set_updated_at
    BEFORE UPDATE ON asset_type_attributes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reject_attribute_key_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'asset_type_attributes.key is immutable; asset values are keyed by it'
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'asset_type_attributes'::regclass
       AND tgname = 'asset_type_attributes_key_immutable'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER asset_type_attributes_key_immutable
    BEFORE UPDATE OF key ON asset_type_attributes
    FOR EACH ROW EXECUTE FUNCTION reject_attribute_key_change();
  END IF;
END;
$$;

COMMENT ON TABLE asset_type_attributes IS
  'Custom attribute definitions per asset type. key is immutable and never reused; is_active = false hides an attribute but keeps its values.';
COMMENT ON COLUMN assets.extended_attributes IS
  'Custom attribute values keyed by asset_type_attributes.key; value types are checked by the API, not the DB.';
