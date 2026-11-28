-- 1. The two-administrator minimum counts administrators who can act
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

-- 2. Brings production's copy of this 0004 trigger function in line with the
-- repository: only a member's own details insert opens a review (an edit to
-- 0004 made after production applied it).
CREATE OR REPLACE FUNCTION professional_details_open_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.profile_id = app_uid() AND EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id AND p.kind = 'professional' AND p.approval_state = 'pending'
  ) THEN
    PERFORM open_profile_review(NEW.profile_id);
  END IF;
  RETURN NULL;
END
$$;

-- 3. A verified member's change of title or organization is audited by the
-- names of the fields that changed, never their values: the audit log is
-- kept after an account is deleted. Existing entries are rewritten the same
-- way (the append-only guard is lifted for this one statement).
CREATE OR REPLACE FUNCTION professional_details_affiliation_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fields text[] := '{}';
BEGIN
  IF OLD.verified AND NEW.verified
     AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.organization IS DISTINCT FROM OLD.organization) THEN
    IF NEW.title IS DISTINCT FROM OLD.title THEN
      fields := array_append(fields, 'title');
    END IF;
    IF NEW.organization IS DISTINCT FROM OLD.organization THEN
      fields := array_append(fields, 'organization');
    END IF;
    NEW.verified := false;
    NEW.verified_method := NULL;
    NEW.verified_at := NULL;
    PERFORM write_audit('profile.affiliation_changed', 'profile', NEW.profile_id, jsonb_build_object('fields', to_jsonb(fields)));
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;
UPDATE audit_log
   SET detail = jsonb_build_object('fields', coalesce((SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(detail) k), '[]'::jsonb))
 WHERE action = 'profile.affiliation_changed' AND NOT detail ? 'fields';
ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;
