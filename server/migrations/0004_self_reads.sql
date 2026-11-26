-- Owner reads the request role cannot make directly (Task 12): the owner's
-- own LinkedIn link (profiles.linkedin_url is not granted to app_user) and
-- the preview of their profile as a visitor or a member sees it (PRO-13).
--
-- profile_access answers 'visible' to the owner for their own profile, so
-- the preview needs the same rule evaluated as someone else would get it.
-- Neither preview function releases anything: no audit entry, and the
-- contact values are the owner's own.

-- The caller's own private profile columns. Nobody else's: the row is
-- chosen by app_uid(), never by an argument.
CREATE FUNCTION my_profile_private() RETURNS TABLE (linkedin_url text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.linkedin_url FROM profiles p WHERE p.id = app_uid() AND app_uid() IS NOT NULL
$$;

-- What profile_access(app_uid()) would answer for a visitor or for a
-- signed-in member who is neither the owner nor an administrator. Mirrors
-- profile_access in 0002 and the profiles read policies.
CREATE FUNCTION preview_my_access(viewer text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p profiles%ROWTYPE;
BEGIN
  IF viewer IS NULL OR viewer NOT IN ('visitor', 'member') THEN
    RAISE EXCEPTION 'mest.invalid_viewer' USING ERRCODE = '22023';
  END IF;
  IF app_uid() IS NULL THEN
    RETURN 'none';
  END IF;
  SELECT * INTO p FROM profiles pr WHERE pr.id = app_uid();
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF p.kind IS DISTINCT FROM 'professional'
     OR p.approval_state <> 'approved'
     OR p.admin_hidden_at IS NOT NULL
     OR p.anonymized_at IS NOT NULL
     OR NOT profile_in_directory(p.id) THEN
    RETURN 'none';
  END IF;
  IF p.visibility = 'public' THEN
    RETURN 'visible';
  END IF;
  IF p.visibility = 'members' THEN
    RETURN CASE WHEN viewer = 'member' THEN 'visible' ELSE 'members_only' END;
  END IF;
  RETURN 'none';
END
$$;

-- The contact methods a member would get from release_contact for the
-- caller's own profile, resolved the same way (email falls back to the
-- sign-in address), without the audit entry. Empty unless a member could
-- see the profile.
CREATE FUNCTION preview_my_contact() RETURNS TABLE (method contact_method, value text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.method, r.value
    FROM (
      SELECT m AS method,
             CASE m
               WHEN 'email' THEN coalesce(c.contact_email::text, u.email::text)
               WHEN 'linkedin' THEN p.linkedin_url
               WHEN 'booking' THEN c.booking_url
               WHEN 'phone' THEN c.phone
             END AS value
        FROM contact_preferences c
        JOIN profiles p ON p.id = c.profile_id
        JOIN users u ON u.id = c.profile_id AND u.deleted_at IS NULL
        CROSS JOIN LATERAL unnest(c.share_with_members) AS m
       WHERE c.profile_id = app_uid() AND m <> 'mest' AND m = ANY (c.methods)
    ) r
   WHERE r.value IS NOT NULL AND preview_my_access('member') = 'visible'
   ORDER BY r.method
$$;
