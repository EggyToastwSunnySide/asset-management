-- An UPDATE can change role_id, so both the source and destination roles must
-- be checked. Migration 003 checked only NEW.role_id through COALESCE.

CREATE OR REPLACE FUNCTION reject_system_role_permission_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM fw_roles WHERE id = NEW.role_id AND system_key IS NOT NULL) THEN
      RAISE EXCEPTION 'built-in system-role permissions are immutable'
        USING ERRCODE = '23000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM fw_roles WHERE id = OLD.role_id AND system_key IS NOT NULL) THEN
      RAISE EXCEPTION 'built-in system-role permissions are immutable'
        USING ERRCODE = '23000';
    END IF;
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM fw_roles
     WHERE id IN (OLD.role_id, NEW.role_id)
       AND system_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'built-in system-role permissions are immutable'
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;
