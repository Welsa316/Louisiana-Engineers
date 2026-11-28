-- The two-administrator minimum counts administrators who can act
-- (acting_admin_count, 0010): an administrator in a deletion grace period,
-- suspended or unverified no longer counts. Re-creates admin_revoke from
-- 0004, which production has already applied.

CREATE OR REPLACE FUNCTION admin_revoke(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_revoke.profile_id;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM admin_roles a WHERE a.revoked_at IS NULL ORDER BY a.profile_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = target AND a.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF acting_admin_count(target) < 2 THEN
    RAISE EXCEPTION 'mest.admin_minimum' USING ERRCODE = '23514', DETAIL = 'at least two administrators stay';
  END IF;
  UPDATE admin_roles a SET revoked_at = now() WHERE a.profile_id = target;
  PERFORM write_audit('admin.revoked', 'profile', target, '{}'::jsonb);
END
$$;
