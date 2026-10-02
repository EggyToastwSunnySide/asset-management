-- US-14/US-15: opaque sessions, security events and action-level RBAC.

ALTER TABLE fw_users
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_login_at timestamptz;

CREATE TABLE fw_permissions (
  permission_key varchar(64) PRIMARY KEY,
  description varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_fw_permissions_key
    CHECK (permission_key ~ '^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$'),
  CONSTRAINT ck_fw_permissions_description_nonblank
    CHECK (btrim(description) <> '')
);

CREATE TABLE fw_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name citext NOT NULL UNIQUE,
  description varchar(500),
  system_key varchar(32) UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_fw_roles_name_nonblank
    CHECK (btrim(name::text) <> ''),
  CONSTRAINT ck_fw_roles_description_nonblank
    CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_fw_roles_system_key
    CHECK (system_key IS NULL OR system_key IN ('admin', 'asset_manager', 'viewer'))
);

CREATE TABLE fw_role_permissions (
  role_id uuid NOT NULL,
  permission_key varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key),
  CONSTRAINT fk_fw_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES fw_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_fw_role_permissions_permission
    FOREIGN KEY (permission_key) REFERENCES fw_permissions(permission_key) ON DELETE RESTRICT
);

CREATE TABLE fw_user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_by_user_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_fw_user_roles_user
    FOREIGN KEY (user_id) REFERENCES fw_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fw_user_roles_role
    FOREIGN KEY (role_id) REFERENCES fw_roles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fw_user_roles_actor
    FOREIGN KEY (assigned_by_user_id) REFERENCES fw_users(id) ON DELETE SET NULL
);

CREATE TABLE fw_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason varchar(64),
  ip_address inet,
  user_agent varchar(512),
  CONSTRAINT fk_fw_sessions_user
    FOREIGN KEY (user_id) REFERENCES fw_users(id) ON DELETE CASCADE,
  CONSTRAINT ck_fw_sessions_token_hash
    CHECK (octet_length(token_hash) = 32),
  CONSTRAINT ck_fw_sessions_expiry
    CHECK (idle_expires_at <= absolute_expires_at AND absolute_expires_at > created_at),
  CONSTRAINT ck_fw_sessions_revocation_pair
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT ck_fw_sessions_revoked_after_created
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE fw_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(64) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  target_user_id uuid,
  session_id uuid,
  ip_address inet,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_fw_security_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fw_security_events_target
    FOREIGN KEY (target_user_id) REFERENCES fw_users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_fw_security_events_type
    CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT ck_fw_security_events_details_object
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX idx_fw_roles_active ON fw_roles (is_active, name);
CREATE INDEX idx_fw_role_permissions_permission ON fw_role_permissions (permission_key, role_id);
CREATE INDEX idx_fw_user_roles_role ON fw_user_roles (role_id, user_id);
CREATE INDEX idx_fw_sessions_user_active
  ON fw_sessions (user_id, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_fw_sessions_expiry
  ON fw_sessions (idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_fw_security_events_timeline ON fw_security_events (occurred_at DESC, id);
CREATE INDEX idx_fw_security_events_actor ON fw_security_events (actor_user_id, occurred_at DESC);
CREATE INDEX idx_fw_security_events_target ON fw_security_events (target_user_id, occurred_at DESC);

CREATE TRIGGER fw_roles_set_updated_at
BEFORE UPDATE ON fw_roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO fw_permissions (permission_key, description) VALUES
  ('assets.view', 'View assets and asset reference data'),
  ('assets.create', 'Create assets'),
  ('assets.update', 'Update assets'),
  ('assets.archive', 'Archive assets'),
  ('assets.restore', 'Restore archived assets'),
  ('exports.run', 'Export asset data'),
  ('exportProfiles.view', 'View private export profiles'),
  ('exportProfiles.create', 'Create private export profiles'),
  ('exportProfiles.update', 'Update private export profiles'),
  ('exportProfiles.delete', 'Delete private export profiles'),
  ('users.view', 'View users'),
  ('roles.view', 'View permissions and roles'),
  ('roles.create', 'Create roles'),
  ('roles.update', 'Update roles'),
  ('roles.assign', 'Assign roles to users');

INSERT INTO fw_roles (name, description, system_key) VALUES
  ('System Administrator', 'Built-in role with every permission.', 'admin'),
  ('Asset Manager', 'Built-in role for asset, export and export-profile operations.', 'asset_manager'),
  ('Viewer', 'Built-in read-only asset role.', 'viewer');

INSERT INTO fw_role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
  FROM fw_roles r
  CROSS JOIN fw_permissions p
 WHERE r.system_key = 'admin';

INSERT INTO fw_role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
  FROM fw_roles r
  JOIN fw_permissions p
    ON p.permission_key LIKE 'assets.%'
    OR p.permission_key = 'exports.run'
    OR p.permission_key LIKE 'exportProfiles.%'
 WHERE r.system_key = 'asset_manager';

INSERT INTO fw_role_permissions (role_id, permission_key)
SELECT r.id, 'assets.view'
  FROM fw_roles r
 WHERE r.system_key = 'viewer';

-- Preserve every legacy user id and history while translating the old enum role
-- into the new many-to-many model. Runtime authorization no longer reads role.
INSERT INTO fw_user_roles (user_id, role_id)
SELECT u.id, r.id
  FROM fw_users u
  JOIN fw_roles r ON r.system_key = u.role::text;

-- The legacy attribution-only account used '!' as a deliberately impossible
-- password. It remains for foreign-key/history preservation but cannot sign in.
UPDATE fw_users
   SET is_active = false
 WHERE password_hash = '!';

CREATE OR REPLACE FUNCTION reject_system_role_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.system_key IS NOT NULL THEN
    RAISE EXCEPTION 'built-in system roles are immutable'
      USING ERRCODE = '23000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER fw_roles_system_immutable
BEFORE UPDATE OR DELETE ON fw_roles
FOR EACH ROW EXECUTE FUNCTION reject_system_role_mutation();

CREATE OR REPLACE FUNCTION reject_system_role_permission_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_to_check uuid;
BEGIN
  role_to_check := COALESCE(NEW.role_id, OLD.role_id);
  IF EXISTS (SELECT 1 FROM fw_roles WHERE id = role_to_check AND system_key IS NOT NULL) THEN
    RAISE EXCEPTION 'built-in system-role permissions are immutable'
      USING ERRCODE = '23000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER fw_role_permissions_system_immutable
BEFORE INSERT OR UPDATE OR DELETE ON fw_role_permissions
FOR EACH ROW EXECUTE FUNCTION reject_system_role_permission_mutation();

CREATE OR REPLACE FUNCTION reject_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fw_security_events are append-only'
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER fw_security_events_append_only
BEFORE UPDATE OR DELETE ON fw_security_events
FOR EACH ROW EXECUTE FUNCTION reject_security_event_mutation();

COMMENT ON COLUMN fw_users.role IS
  'Legacy compatibility column retained for history only. Runtime authorization uses fw_user_roles.';
COMMENT ON TABLE fw_permissions IS
  'Stable action-permission catalogue used by the API authorization boundary.';
COMMENT ON TABLE fw_roles IS
  'Built-in and custom RBAC roles. Rows with system_key are immutable.';
COMMENT ON TABLE fw_sessions IS
  'Opaque browser sessions. Only SHA-256 token hashes are stored.';
COMMENT ON TABLE fw_security_events IS
  'Append-only security audit events. Credentials and raw session tokens are forbidden.';
