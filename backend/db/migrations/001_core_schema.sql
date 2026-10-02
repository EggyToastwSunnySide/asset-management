-- PostgreSQL 16 bootstrap derived from core-asset-management.dbml.
-- PostgreSQL-specific integrity guards are defined here explicitly:
-- citext, named checks, partial unique indexes and immutable/append-only triggers.
-- Scope: small core asset management only; no maintenance, warranty, full RBAC,
-- sessions, password-reset tokens, documents, notifications or work queues.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE fw_user_role AS ENUM (
  'admin',
  'asset_manager',
  'viewer'
);

CREATE TYPE asset_event_type AS ENUM (
  'created',
  'updated',
  'archived',
  'restored',
  'loaned',
  'returned'
);

CREATE TYPE export_date_format AS ENUM (
  'iso',
  'day_month_year',
  'month_day_year'
);

CREATE TABLE fw_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash varchar(512) NOT NULL,
  display_name varchar(255) NOT NULL,
  role fw_user_role NOT NULL DEFAULT 'viewer',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_fw_users_email_nonblank
    CHECK (btrim(email::text) <> ''),
  CONSTRAINT ck_fw_users_password_hash_nonblank
    CHECK (btrim(password_hash) <> ''),
  CONSTRAINT ck_fw_users_display_name_nonblank
    CHECK (btrim(display_name) <> '')
);

CREATE TABLE asset_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_asset_types_code_canonical
    CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]+$'),
  CONSTRAINT ck_asset_types_name_nonblank
    CHECK (btrim(name) <> '')
);

CREATE TABLE asset_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_asset_statuses_code_canonical
    CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]+$'),
  CONSTRAINT ck_asset_statuses_name_nonblank
    CHECK (btrim(name) <> '')
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_locations_code_canonical
    CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]+$'),
  CONSTRAINT ck_locations_name_nonblank
    CHECK (btrim(name) <> '')
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag citext NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  asset_type_id uuid NOT NULL,
  asset_status_id uuid NOT NULL,
  purchase_date date NOT NULL,
  location_id uuid NOT NULL,
  notes text,
  deleted_at timestamptz,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_assets_asset_tag_nonblank
    CHECK (btrim(asset_tag::text) <> ''),
  CONSTRAINT ck_assets_name_nonblank
    CHECK (btrim(name) <> ''),
  CONSTRAINT ck_assets_notes_nonblank
    CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT ck_assets_deleted_after_created
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE TABLE asset_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  borrower_name varchar(255) NOT NULL,
  borrowed_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  returned_at timestamptz,
  note text,
  created_by_user_id uuid NOT NULL,
  returned_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_asset_loans_borrower_nonblank
    CHECK (btrim(borrower_name) <> ''),
  CONSTRAINT ck_asset_loans_due_after_borrowed
    CHECK (due_at IS NULL OR due_at >= borrowed_at),
  CONSTRAINT ck_asset_loans_returned_after_borrowed
    CHECK (returned_at IS NULL OR returned_at >= borrowed_at),
  CONSTRAINT ck_asset_loans_return_actor_pair
    CHECK ((returned_at IS NULL) = (returned_by_user_id IS NULL)),
  CONSTRAINT ck_asset_loans_note_nonblank
    CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE TABLE asset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  event_type asset_event_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  description text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ck_asset_events_description_nonblank
    CHECK (btrim(description) <> ''),
  CONSTRAINT ck_asset_events_details_object
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE TABLE export_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name citext NOT NULL,
  date_format export_date_format NOT NULL DEFAULT 'iso',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_export_profiles_name_nonblank
    CHECK (btrim(name::text) <> ''),
  CONSTRAINT uq_export_profiles_owner_name UNIQUE (owner_user_id, name)
);

CREATE TABLE export_profile_columns (
  profile_id uuid NOT NULL,
  field_key varchar(32) NOT NULL,
  ordinal smallint NOT NULL,
  header_label varchar(255),
  PRIMARY KEY (profile_id, field_key),
  CONSTRAINT uq_export_profile_columns_ordinal
    UNIQUE (profile_id, ordinal),
  CONSTRAINT ck_export_profile_columns_field_key
    CHECK (field_key IN (
      'asset_tag',
      'name',
      'asset_type',
      'asset_status',
      'purchase_date',
      'location'
    )),
  CONSTRAINT ck_export_profile_columns_ordinal
    CHECK (ordinal BETWEEN 1 AND 6),
  CONSTRAINT ck_export_profile_columns_header_nonblank
    CHECK (header_label IS NULL OR btrim(header_label) <> '')
);

ALTER TABLE assets
  ADD CONSTRAINT fk_assets_type
    FOREIGN KEY (asset_type_id) REFERENCES asset_types(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assets_status
    FOREIGN KEY (asset_status_id) REFERENCES asset_statuses(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assets_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assets_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assets_updated_by
    FOREIGN KEY (updated_by_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT;

ALTER TABLE asset_loans
  ADD CONSTRAINT fk_asset_loans_asset
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_asset_loans_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_asset_loans_returned_by
    FOREIGN KEY (returned_by_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT;

ALTER TABLE asset_events
  ADD CONSTRAINT fk_asset_events_asset
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_asset_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT;

ALTER TABLE export_profiles
  ADD CONSTRAINT fk_export_profiles_owner
    FOREIGN KEY (owner_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT;

ALTER TABLE export_profile_columns
  ADD CONSTRAINT fk_export_profile_columns_profile
    FOREIGN KEY (profile_id) REFERENCES export_profiles(id) ON DELETE CASCADE;

CREATE INDEX idx_assets_active_filters
  ON assets (asset_type_id, asset_status_id, location_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_assets_active_status
  ON assets (asset_status_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_assets_active_location
  ON assets (location_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_assets_active_name
  ON assets (name)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_assets_purchase_date
  ON assets (purchase_date)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_asset_loans_one_open_per_asset
  ON asset_loans (asset_id)
  WHERE returned_at IS NULL;

CREATE INDEX idx_asset_loans_history
  ON asset_loans (asset_id, borrowed_at DESC);

CREATE INDEX idx_asset_loans_open_due
  ON asset_loans (due_at)
  WHERE returned_at IS NULL;

CREATE INDEX idx_asset_events_timeline
  ON asset_events (asset_id, occurred_at DESC, id);

CREATE INDEX idx_asset_events_type
  ON asset_events (event_type);

CREATE INDEX idx_asset_events_actor
  ON asset_events (actor_user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fw_users_set_updated_at
BEFORE UPDATE ON fw_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER asset_types_set_updated_at
BEFORE UPDATE ON asset_types
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER asset_statuses_set_updated_at
BEFORE UPDATE ON asset_statuses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER locations_set_updated_at
BEFORE UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER assets_set_updated_at
BEFORE UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER asset_loans_set_updated_at
BEFORE UPDATE ON asset_loans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER export_profiles_set_updated_at
BEFORE UPDATE ON export_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION reject_asset_tag_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.asset_tag IS DISTINCT FROM OLD.asset_tag THEN
    RAISE EXCEPTION 'asset_tag is immutable; use an audited correction workflow'
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_asset_tag_immutable
BEFORE UPDATE OF asset_tag ON assets
FOR EACH ROW EXECUTE FUNCTION reject_asset_tag_change();

CREATE OR REPLACE FUNCTION reject_asset_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'assets cannot be hard-deleted; set deleted_at instead'
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER assets_no_hard_delete
BEFORE DELETE ON assets
FOR EACH ROW EXECUTE FUNCTION reject_asset_hard_delete();

CREATE OR REPLACE FUNCTION reject_asset_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'asset_events are append-only'
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER asset_events_append_only
BEFORE UPDATE OR DELETE ON asset_events
FOR EACH ROW EXECUTE FUNCTION reject_asset_event_mutation();

CREATE OR REPLACE FUNCTION touch_export_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE export_profiles SET updated_at = now() WHERE id = OLD.profile_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE export_profiles SET updated_at = now()
      WHERE id IN (OLD.profile_id, NEW.profile_id);
    RETURN NEW;
  ELSE
    UPDATE export_profiles SET updated_at = now() WHERE id = NEW.profile_id;
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER export_profile_columns_touch_parent
AFTER INSERT OR UPDATE OR DELETE ON export_profile_columns
FOR EACH ROW EXECUTE FUNCTION touch_export_profile();

CREATE OR REPLACE FUNCTION validate_export_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  profile_id_to_check uuid;
  column_count integer;
  maximum_ordinal integer;
BEGIN
  profile_id_to_check := COALESCE(NEW.profile_id, OLD.profile_id);

  IF NOT EXISTS (
    SELECT 1 FROM export_profiles WHERE id = profile_id_to_check
  ) THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer, COALESCE(max(ordinal), 0)::integer
    INTO column_count, maximum_ordinal
    FROM export_profile_columns
   WHERE profile_id = profile_id_to_check;

  IF column_count < 1 OR maximum_ordinal <> column_count THEN
    RAISE EXCEPTION 'export profile % must have contiguous columns starting at ordinal 1', profile_id_to_check
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER export_profile_columns_contiguous
AFTER INSERT OR UPDATE OR DELETE ON export_profile_columns
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_export_profile_columns();

CREATE OR REPLACE FUNCTION validate_export_profile_has_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  column_count integer;
  maximum_ordinal integer;
BEGIN
  SELECT count(*)::integer, COALESCE(max(ordinal), 0)::integer
    INTO column_count, maximum_ordinal
    FROM export_profile_columns
   WHERE profile_id = NEW.id;

  IF column_count < 1 OR maximum_ordinal <> column_count THEN
    RAISE EXCEPTION 'export profile % must have contiguous columns starting at ordinal 1', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER export_profiles_require_columns
AFTER INSERT OR UPDATE ON export_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_export_profile_has_columns();

COMMENT ON TABLE fw_users IS
  'Minimal local authentication. No full RBAC, sessions, password reset tokens or MFA.';
COMMENT ON TABLE assets IS
  'Core asset register. Soft delete via deleted_at; asset_tag is case-insensitive, immutable and never reused.';
COMMENT ON TABLE asset_loans IS
  'Simple loan history. Partial unique index permits at most one open loan per asset.';
COMMENT ON TABLE asset_events IS
  'Append-only asset timeline; not a security audit log.';
COMMENT ON TABLE export_profiles IS
  'Private per-user export configuration; hard delete permits name reuse.';
COMMENT ON TABLE export_profile_columns IS
  'Ordered export fields; profile must contain contiguous ordinals 1..N.';
