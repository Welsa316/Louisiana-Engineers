-- 0012: the launch pass (Task 28).
--
-- 1. An administrator's hide or restore during a member's deletion grace
--    period leaves the mentoring status the deletion saved alone, so keeping
--    the account brings back what the member had.
-- 2. The members list filters by kind, approval state, mentorship status,
--    verified mark and region (03 section 8.3), and returns the last two.
-- 3. Directory text search can use the GIN indexes. `@@` is not leakproof,
--    so under the row policies on profiles and professional_details it can
--    never be an index condition: the planner must run the policies first.
--    directory_search_candidates() runs the indexed match as the owner,
--    limited to the profiles the caller could list anyway, and the search
--    keeps its exact match on the combined document after it.

-- 1. Hide and restore during a grace period ---------------------------------------------

CREATE OR REPLACE FUNCTION admin_hide_profile(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_hide_profile.profile_id;
  already timestamptz;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.admin_hidden_at INTO already FROM profiles p WHERE p.id = target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF already IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE profiles p SET admin_hidden_at = now() WHERE p.id = target;
  -- A deletion in its grace period already turned mentoring off and holds
  -- the member's status in previous_status; saving 'off' over it would lose it.
  IF NOT EXISTS (
    SELECT 1 FROM account_deletions d
     WHERE d.profile_id = target AND d.canceled_at IS NULL AND d.executed_at IS NULL
  ) THEN
    -- paused_until stays, so a paused offer comes back paused until the same day.
    UPDATE mentorship_settings s SET previous_status = s.status, status = 'off'
     WHERE s.profile_id = target;
  END IF;
  PERFORM write_audit('profile.hidden', 'profile', target, '{}'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION admin_restore_profile(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_restore_profile.profile_id;
  hidden timestamptz;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.admin_hidden_at INTO hidden FROM profiles p WHERE p.id = target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF hidden IS NULL THEN
    RETURN;
  END IF;
  UPDATE profiles p SET admin_hidden_at = NULL WHERE p.id = target;
  -- During a grace period mentoring stays off and the saved status waits for
  -- cancel_account_deletion (or the sweep).
  IF NOT EXISTS (
    SELECT 1 FROM account_deletions d
     WHERE d.profile_id = target AND d.canceled_at IS NULL AND d.executed_at IS NULL
  ) THEN
    UPDATE mentorship_settings s
       SET status = coalesce(s.previous_status, s.status),
           paused_until = CASE WHEN coalesce(s.previous_status, s.status) = 'paused' THEN s.paused_until END,
           previous_status = NULL
     WHERE s.profile_id = target;
  END IF;
  PERFORM write_audit('profile.restored', 'profile', target, '{}'::jsonb);
END
$$;

-- 2. The members list's filters ---------------------------------------------------------

-- The return type changes, so the old function goes first. Every filter is
-- optional, so the three-argument call keeps working.
DROP FUNCTION admin_list_members(int, int, text);

-- The members list: names, kind, approval state, mentor status, the verified
-- mark, the region and the sign-up address's domain, never the address.
-- `q` matches names; every other argument narrows the list when given.
CREATE FUNCTION admin_list_members(
  page int,
  size int,
  q text,
  kind_filter profile_kind DEFAULT NULL,
  approval_filter approval_state DEFAULT NULL,
  mentor_filter mentor_status DEFAULT NULL,
  verified_filter boolean DEFAULT NULL,
  region_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  kind profile_kind,
  approval_state approval_state,
  mentor_status mentor_status,
  verified boolean,
  region text,
  email_domain text,
  joined_at timestamptz,
  total int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  page_size int := least(greatest(coalesce(size, 20), 1), 50);
  page_number int := greatest(coalesce(page, 1), 1);
  pattern text := CASE WHEN nullif(btrim(coalesce(q, '')), '') IS NULL THEN NULL
                       ELSE '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.first_name, p.last_name, p.kind, p.approval_state, s.status,
           coalesce(d.verified, false), p.region,
           split_part(u.email::text, '@', 2), u.created_at, (count(*) OVER ())::int
      FROM profiles p
      JOIN users u ON u.id = p.id
      LEFT JOIN mentorship_settings s ON s.profile_id = p.id
      LEFT JOIN professional_details d ON d.profile_id = p.id
     WHERE p.anonymized_at IS NULL AND u.deleted_at IS NULL
       AND (pattern IS NULL OR p.first_name ILIKE pattern OR p.last_name ILIKE pattern
            OR (p.first_name || ' ' || p.last_name) ILIKE pattern)
       AND (kind_filter IS NULL OR p.kind = kind_filter)
       AND (approval_filter IS NULL OR p.approval_state = approval_filter)
       AND (mentor_filter IS NULL OR s.status = mentor_filter)
       AND (verified_filter IS NULL OR coalesce(d.verified, false) = verified_filter)
       AND (region_filter IS NULL OR p.region = region_filter)
     ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST, p.id
     LIMIT page_size OFFSET (page_number - 1) * page_size;
END
$$;

-- 3. Indexed directory search -----------------------------------------------------------

-- Profiles whose names (profiles.search_tsv) or professional document
-- (professional_details.search_tsv) match `query`, each through its GIN
-- index, among the profiles the directory lists for the caller: approved,
-- listed professionals, public ones for everyone and members-only ones for
-- members. Never wider than directory_entries, so calling it directly tells
-- nobody anything the directory would not. The caller passes every search
-- word OR-ed together and keeps its exact all-words match on the combined
-- document, since one word may be in the name and another in the profile.
CREATE FUNCTION directory_search_candidates(query tsquery) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT p.id
  FROM profiles p
  JOIN professional_details d ON d.profile_id = p.id
 WHERE p.id IN (
         SELECT n.id FROM profiles n WHERE n.search_tsv @@ $1
         UNION
         SELECT t.profile_id FROM professional_details t WHERE t.search_tsv @@ $1
       )
   AND p.kind = 'professional'
   AND p.approval_state = 'approved'
   AND p.admin_hidden_at IS NULL
   AND p.anonymized_at IS NULL
   AND 'directory' = ANY (d.participation)
   AND (p.visibility = 'public' OR (p.visibility = 'members' AND is_member()))
$$;

REVOKE ALL ON FUNCTION directory_search_candidates(tsquery) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION directory_search_candidates(tsquery) TO app_user;
