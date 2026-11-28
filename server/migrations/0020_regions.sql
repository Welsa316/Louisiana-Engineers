-- 0020: regions and chapter administrators (Phase 4, Task 38;
-- 04-implementation-roadmap.md section 9).
--
-- 1. `regions` (id slug, label, active), seeded with greater-new-orleans,
--    and `profiles.region` a foreign key to it. A member may move to an
--    active region only; a profile already in a region that is later
--    retired keeps it.
-- 2. `admin_roles.region_id`: the region an administrator acts for. Null
--    means every region, which is what every existing role keeps.
-- 3. `is_admin_for(region)`. is_admin() is unchanged: a chapter
--    administrator is an administrator and reads the administration area;
--    every administrator function that acts on a profile now checks the
--    profile's region against the caller's scope and raises
--    mest.out_of_region otherwise, and so do the two administrator update
--    policies. The members list returns only the caller's regions.
-- 4. Granting chooses a scope within the caller's own, and the last
--    administrator who can act for every region is neither revoked,
--    narrowed, suspended nor removed, and cannot leave
--    (mest.last_global_admin), so a region-wide role can always still be
--    granted from the screen. A chapter administrator never acts against a
--    region-wide administrator's own profile either (assert_admin_covers_role).
--
-- Nothing here stores member data: a region is a vocabulary row and the
-- scope belongs to the role, so execute_account_deletion and the export are
-- unchanged (the sweep already revokes the role and keeps `region` for the
-- aggregate counts, 02 section 8).

-- 1. Regions ----------------------------------------------------------------------------

CREATE TABLE regions (
  id text PRIMARY KEY CHECK (is_slug(id)),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO regions (id, label, sort_order) VALUES ('greater-new-orleans', 'Greater New Orleans', 1);

-- Any other slug a profile already carries (the column took any slug before
-- this table existed) becomes an inactive region with a label made from it,
-- so the foreign key holds without changing a member's row.
INSERT INTO regions (id, label, sort_order, active)
SELECT r.region,
       initcap(replace(r.region, '-', ' ')) || CASE WHEN char_length(r.region) < 2 THEN ' region' ELSE '' END,
       1 + row_number() OVER (ORDER BY r.region),
       false
  FROM (SELECT DISTINCT p.region FROM profiles p WHERE p.region <> 'greater-new-orleans') r;

ALTER TABLE profiles ADD CONSTRAINT profiles_region_fkey FOREIGN KEY (region) REFERENCES regions (id);
CREATE INDEX profiles_region_idx ON profiles (region);

-- A new or changed region must be an active one, whoever writes it
-- (complete_onboarding runs as the owner and is held to it too).
CREATE FUNCTION profiles_region_active() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.region IS NOT DISTINCT FROM OLD.region THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = NEW.region AND r.active) THEN
    RAISE EXCEPTION 'mest.invalid_region' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_region_active BEFORE INSERT OR UPDATE OF region ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_region_active();

-- 2. The administrator's scope ----------------------------------------------------------

ALTER TABLE admin_roles ADD COLUMN region_id text REFERENCES regions (id);

-- 3. Scope helpers ----------------------------------------------------------------------

-- Whether the caller is an administrator who acts for `region`: one for
-- every region (a null scope), or one scoped to that region. A null
-- `region` asks for every region, which only a region-wide administrator is.
CREATE FUNCTION is_admin_for(region text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT is_admin() AND EXISTS (
    SELECT 1 FROM admin_roles a
     WHERE a.profile_id = app_uid() AND a.revoked_at IS NULL
       AND (a.region_id IS NULL OR a.region_id = is_admin_for.region)
  )
$$;

-- Whether the caller administers the region `profile_id` is in. A profile
-- that does not exist counts as outside every region but "every region".
CREATE FUNCTION admin_covers_profile(profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT is_admin_for((SELECT p.region FROM profiles p WHERE p.id = admin_covers_profile.profile_id))
$$;

-- Raises mest.out_of_region unless the caller administers the profile's region.
CREATE FUNCTION assert_admin_covers(profile_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT admin_covers_profile(assert_admin_covers.profile_id) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
END
$$;

-- Raises mest.out_of_region when the profile holds an administrator role the
-- caller does not cover: the rule admin_revoke applies (a chapter
-- administrator never acts against a region-wide one), for the sanctions a
-- report or the members screen can take against an administrator's own
-- profile. A region-wide administrator's profile sits in a region too, so
-- covering the profile is not enough.
CREATE FUNCTION assert_admin_covers_role(profile_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scope text;
BEGIN
  SELECT a.region_id INTO scope FROM admin_roles a
   WHERE a.profile_id = assert_admin_covers_role.profile_id AND a.revoked_at IS NULL;
  IF FOUND AND NOT is_admin_for(scope) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
END
$$;

-- Region-wide administrators who can act right now, leaving one out (the
-- same rule as acting_admin_count in 0010).
CREATE FUNCTION acting_global_admin_count(excluding uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
    FROM admin_roles a JOIN users u ON u.id = a.profile_id
   WHERE a.revoked_at IS NULL AND a.region_id IS NULL AND a.profile_id IS DISTINCT FROM excluding
     AND u.email_verified_at IS NOT NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM account_deletions d
                      WHERE d.profile_id = a.profile_id AND d.canceled_at IS NULL AND d.executed_at IS NULL)
$$;

-- The administrator update policies follow the scope: a direct UPDATE
-- outside the caller's regions touches no row, and cannot move a profile
-- into one it does not administer.
DROP POLICY profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE TO app_user
  USING (is_admin_for(region)) WITH CHECK (is_admin_for(region));
DROP POLICY professional_details_admin_update ON professional_details;
CREATE POLICY professional_details_admin_update ON professional_details FOR UPDATE TO app_user
  USING (admin_covers_profile(profile_id)) WITH CHECK (admin_covers_profile(profile_id));

-- Administrator functions, re-created from their latest definitions with the
-- region check after the row they act on is found ------------------------------

-- From 0004.
CREATE OR REPLACE FUNCTION admin_review_profile(review_id uuid, decision review_decision, notes text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  review profile_reviews%ROWTYPE;
  first_name_value text;
  clean_notes text := nullif(btrim(coalesce(notes, '')), '');
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF admin_review_profile.decision IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO review FROM profile_reviews r WHERE r.id = review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_admin_covers(review.profile_id);
  IF review.decision IS NOT NULL THEN
    RAISE EXCEPTION 'mest.review_closed' USING ERRCODE = '23514';
  END IF;

  -- Only a complete professional record can be listed.
  IF admin_review_profile.decision = 'approved' AND NOT EXISTS (
    SELECT 1 FROM professional_details d JOIN profiles p ON p.id = d.profile_id
     WHERE d.profile_id = review.profile_id AND p.kind = 'professional' AND p.bio IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'mest.profile_incomplete' USING ERRCODE = '23514';
  END IF;

  -- The snapshot records what was actually decided on.
  UPDATE profile_reviews r
     SET reviewer_id = app_uid(), decision = admin_review_profile.decision, notes = clean_notes, decided_at = now(),
         snapshot = profile_snapshot(review.profile_id)
   WHERE r.id = review_id;
  UPDATE profiles p SET approval_state = admin_review_profile.decision::text::approval_state WHERE p.id = review.profile_id;
  SELECT p.first_name INTO first_name_value FROM profiles p WHERE p.id = review.profile_id;

  IF admin_review_profile.decision = 'approved' THEN
    PERFORM create_notification(
      review.profile_id, 'profile', 'Your profile is approved',
      'Your profile is now part of the MEST Network directory.',
      '/network/me', 'profile-approved', jsonb_build_object('firstName', first_name_value), true,
      'profile_review', review_id
    );
  ELSE
    PERFORM create_notification(
      review.profile_id, 'profile', 'Your profile needs changes',
      coalesce(clean_notes, 'An administrator asked for changes before your profile is listed.'),
      '/network/me', 'profile-declined', jsonb_build_object('firstName', first_name_value, 'notes', clean_notes), true,
      'profile_review', review_id
    );
  END IF;
  PERFORM write_audit(
    'profile.' || admin_review_profile.decision::text, 'profile', review.profile_id,
    jsonb_build_object('review_id', review_id, 'notes', clean_notes)
  );
END
$$;

-- From 0004.
CREATE OR REPLACE FUNCTION admin_set_verified(profile_id uuid, method verified_method) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_set_verified.profile_id;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM professional_details d WHERE d.profile_id = target) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_admin_covers(target);
  IF method IS NULL THEN
    UPDATE professional_details d SET verified = false, verified_method = NULL, verified_at = NULL WHERE d.profile_id = target;
    PERFORM write_audit('profile.unverified', 'profile', target, '{}'::jsonb);
  ELSE
    UPDATE professional_details d SET verified = true, verified_method = method, verified_at = now() WHERE d.profile_id = target;
    PERFORM create_notification(
      target, 'profile', 'Your affiliation is verified',
      'An administrator verified your title and organization.',
      '/network/me', 'profile-verified', '{}'::jsonb, true, 'profile', target
    );
    PERFORM write_audit('profile.verified', 'profile', target, jsonb_build_object('method', method));
  END IF;
END
$$;

-- From 0012.
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
  PERFORM assert_admin_covers(target);
  PERFORM assert_admin_covers_role(target);
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

-- From 0012.
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
  PERFORM assert_admin_covers(target);
  PERFORM assert_admin_covers_role(target);
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

-- From 0004: one member's sign-up domain, within the caller's regions.
CREATE OR REPLACE FUNCTION admin_member_domain(profile_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM assert_admin_covers(admin_member_domain.profile_id);
  RETURN (SELECT nullif(split_part(u.email::text, '@', 2), '')
            FROM users u WHERE u.id = admin_member_domain.profile_id AND u.deleted_at IS NULL);
END
$$;

-- From 0012: the members list, now only the profiles in the caller's regions.
CREATE OR REPLACE FUNCTION admin_list_members(
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
       AND is_admin_for(p.region)
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

-- From 0010: a report is decided by an administrator of the reported
-- profile's region, and an action against an administrator needs the
-- caller to cover that administrator's role as well (so a chapter
-- administrator never suspends, hides or removes a region-wide one).
-- Suspending the last region-wide administrator who can act is refused like
-- revoking them; removal gets the same check in schedule_account_deletion.
-- The actions it runs (admin_hide_profile) check again.
CREATE OR REPLACE FUNCTION admin_resolve_report(id uuid, status report_status, note text, action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  rep reports%ROWTYPE;
  act text := coalesce(nullif(btrim(coalesce(admin_resolve_report.action, '')), ''), 'none');
  clean_note text := nullif(btrim(coalesce(admin_resolve_report.note, '')), '');
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF admin_resolve_report.status IS NULL OR admin_resolve_report.status = 'open' THEN
    RAISE EXCEPTION 'mest.invalid_status' USING ERRCODE = '22023';
  END IF;
  IF act NOT IN ('none', 'hide_profile', 'suspend_requests', 'remove_account')
     OR (admin_resolve_report.status = 'dismissed' AND act <> 'none') THEN
    RAISE EXCEPTION 'mest.invalid_action' USING ERRCODE = '22023';
  END IF;
  IF clean_note IS NOT NULL AND char_length(clean_note) > 1000 THEN
    RAISE EXCEPTION 'mest.invalid_note' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO rep FROM reports r WHERE r.id = admin_resolve_report.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_admin_covers(rep.profile_id);
  IF act <> 'none' THEN
    PERFORM assert_admin_covers_role(rep.profile_id);
  END IF;
  IF rep.status <> 'open' THEN
    RAISE EXCEPTION 'mest.report_closed' USING ERRCODE = '23514';
  END IF;
  -- Another administrator decides a report about an administrator.
  IF rep.profile_id = me THEN
    RAISE EXCEPTION 'mest.own_report' USING ERRCODE = '23514';
  END IF;

  IF act = 'remove_account' THEN
    PERFORM schedule_account_deletion(
      rep.profile_id, true,
      coalesce(clean_note, 'Report: ' || lower(report_reason_label(rep.reason)))
    );
  ELSIF act = 'hide_profile' THEN
    PERFORM admin_hide_profile(rep.profile_id);
  ELSIF act = 'suspend_requests' THEN
    -- A suspended administrator can no longer act, so the minimum applies.
    PERFORM 1 FROM admin_roles a WHERE a.revoked_at IS NULL ORDER BY a.profile_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = rep.profile_id AND a.revoked_at IS NULL)
       AND acting_admin_count(rep.profile_id) < 2 THEN
      RAISE EXCEPTION 'mest.admin_minimum' USING ERRCODE = '23514', DETAIL = 'at least two administrators stay';
    END IF;
    IF EXISTS (SELECT 1 FROM admin_roles a
                WHERE a.profile_id = rep.profile_id AND a.revoked_at IS NULL AND a.region_id IS NULL)
       AND acting_global_admin_count(rep.profile_id) < 1 THEN
      RAISE EXCEPTION 'mest.last_global_admin' USING ERRCODE = '23514', DETAIL = 'one administrator for every region stays';
    END IF;
    UPDATE users u SET suspended_at = now()
     WHERE u.id = rep.profile_id AND u.suspended_at IS NULL AND u.deleted_at IS NULL;
    PERFORM create_notification(
      rep.profile_id, 'account',
      'Your account can no longer send or answer requests',
      'An administrator reviewed your profile and suspended mentorship requests on your account. '
        || 'If you think this is a mistake, write to the MEST team.',
      '/network/me',
      'moderation-action',
      jsonb_build_object('action', 'suspend_requests', 'firstName', profile_first_name(rep.profile_id),
                         'link', '/network/me'),
      true,
      'profile', rep.profile_id
    );
  END IF;

  UPDATE reports r
     SET status = admin_resolve_report.status, resolved_by = me, resolution_note = clean_note,
         action = act, resolved_at = now()
   WHERE r.id = rep.id;

  IF rep.reporter_id IS NOT NULL THEN
    PERFORM create_notification(
      rep.reporter_id, 'report',
      'Your report was reviewed',
      CASE admin_resolve_report.status
        WHEN 'resolved' THEN 'An administrator reviewed the profile you reported and dealt with it. Thank you for telling us.'
        ELSE 'An administrator reviewed the profile you reported and found nothing that needed action. Thank you for telling us.'
      END,
      '/network/me',
      'report-status',
      jsonb_build_object('reportId', rep.id, 'status', admin_resolve_report.status, 'link', '/network/me'),
      true,
      'report', rep.id
    );
  END IF;

  PERFORM write_audit('report.resolved', 'report', rep.id,
    jsonb_build_object('status', admin_resolve_report.status, 'action', act, 'profile', rep.profile_id));
END
$$;

-- From 0010: leaving takes the administrator role with it, so besides the
-- two-administrator minimum the last region-wide administrator who can act
-- stays (the same rule as admin_revoke). Covers a member's own deletion and
-- an administrator's removal through admin_resolve_report.
CREATE OR REPLACE FUNCTION schedule_account_deletion(target uuid, immediate boolean, reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p profiles%ROWTYPE;
  open_row account_deletions%ROWTYPE;
  new_id uuid;
  clean_reason text := nullif(btrim(coalesce(reason, '')), '');
  is_immediate boolean := coalesce(immediate, false);
  execute_on text;
BEGIN
  SELECT * INTO p FROM profiles pr WHERE pr.id = target FOR UPDATE;
  IF NOT FOUND OR p.anonymized_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = target AND u.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF clean_reason IS NOT NULL AND char_length(clean_reason) > 1000 THEN
    RAISE EXCEPTION 'mest.invalid_reason' USING ERRCODE = '22023';
  END IF;
  -- Leaving takes the administrator role with it, so the same two-administrator
  -- minimum as admin_revoke applies: count the others who can still act.
  PERFORM 1 FROM admin_roles a WHERE a.revoked_at IS NULL ORDER BY a.profile_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = target AND a.revoked_at IS NULL)
     AND acting_admin_count(target) < 2 THEN
    RAISE EXCEPTION 'mest.admin_minimum' USING ERRCODE = '23514', DETAIL = 'at least two administrators stay';
  END IF;
  IF EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = target AND a.revoked_at IS NULL AND a.region_id IS NULL)
     AND acting_global_admin_count(target) < 1 THEN
    RAISE EXCEPTION 'mest.last_global_admin' USING ERRCODE = '23514', DETAIL = 'one administrator for every region stays';
  END IF;

  SELECT * INTO open_row FROM account_deletions d
   WHERE d.profile_id = target AND d.canceled_at IS NULL AND d.executed_at IS NULL
   FOR UPDATE;
  IF FOUND THEN
    IF NOT is_immediate THEN
      RAISE EXCEPTION 'mest.deletion_scheduled' USING ERRCODE = '23514';
    END IF;
    -- An administrator's removal of a member already in their grace period:
    -- the profile is already hidden and the requests closed.
    UPDATE account_deletions d
       SET immediate = true, execute_after = least(d.execute_after, now()), reason = coalesce(clean_reason, d.reason)
     WHERE d.id = open_row.id;
    PERFORM close_requests_of_departing(target);
    PERFORM write_audit('account.deletion_requested', 'profile', target,
      jsonb_build_object('immediate', true, 'reason', clean_reason));
    RETURN open_row.id;
  END IF;

  INSERT INTO account_deletions (profile_id, requested_at, execute_after, previous_visibility, reason, immediate)
  VALUES (
    target, now(),
    CASE WHEN is_immediate THEN now() ELSE now() + interval '14 days' END,
    p.visibility,
    CASE WHEN is_immediate THEN clean_reason END,
    is_immediate
  )
  RETURNING id INTO new_id;

  UPDATE profiles pr SET visibility = 'hidden' WHERE pr.id = target;
  -- An administrator's hide already holds the real status in previous_status
  -- (and the status is off); leave it for admin_restore_profile.
  IF p.admin_hidden_at IS NULL THEN
    UPDATE mentorship_settings s SET previous_status = s.status, status = 'off' WHERE s.profile_id = target;
  END IF;
  PERFORM close_requests_of_departing(target);

  IF is_immediate THEN
    PERFORM create_notification(
      target, 'account',
      'An administrator removed your account',
      'An administrator reviewed your profile and removed your MEST Network account. '
        || 'If you think this is a mistake, write to the MEST team.',
      '/network/me',
      'moderation-action',
      jsonb_build_object('action', 'remove_account', 'firstName', profile_first_name(target), 'link', '/network/me'),
      true,
      'profile', target
    );
  ELSE
    SELECT to_char(d.execute_after AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') INTO execute_on
      FROM account_deletions d WHERE d.id = new_id;
    PERFORM create_notification(
      target, 'account',
      'Your account is scheduled for deletion',
      'It will be deleted on ' || execute_on || '. To keep it, sign in before then and choose Keep my account.',
      '/network/scheduled-for-deletion',
      'deletion-requested',
      jsonb_build_object('firstName', profile_first_name(target), 'executeOn', execute_on,
                         'link', '/network/scheduled-for-deletion'),
      true,
      'profile', target
    );
  END IF;

  PERFORM write_audit('account.deletion_requested', 'profile', target,
    jsonb_build_object('immediate', is_immediate, 'reason', CASE WHEN is_immediate THEN clean_reason END));
  RETURN new_id;
END
$$;

-- 4. Granting with a scope, and revoking ---------------------------------------------------

-- The signature gains the scope, so the one-argument function goes first.
-- `admin_grant(profile)` still works and asks for every region.
DROP FUNCTION admin_grant(uuid);

-- Grants (or restores) the role with a scope: a region id, or null for
-- every region. The caller must administer the member's region and the
-- scope granted, so a chapter administrator grants only its own region. On
-- an active administrator it changes the scope, which the caller must also
-- cover; the last region-wide administrator who can act is never narrowed.
CREATE FUNCTION admin_grant(profile_id uuid, region_id text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_grant.profile_id;
  scope text := admin_grant.region_id;
  existing admin_roles%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF scope IS NOT NULL AND NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = scope AND r.active) THEN
    RAISE EXCEPTION 'mest.invalid_region' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u JOIN profiles p ON p.id = u.id
     WHERE u.id = target AND u.email_verified_at IS NOT NULL AND u.suspended_at IS NULL
       AND u.deleted_at IS NULL AND p.anonymized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF NOT admin_covers_profile(target) OR NOT is_admin_for(scope) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;

  -- The same lock order as admin_revoke, so a concurrent narrowing and
  -- revocation cannot both see a second region-wide administrator.
  PERFORM 1 FROM admin_roles a WHERE a.revoked_at IS NULL ORDER BY a.profile_id FOR UPDATE;
  SELECT * INTO existing FROM admin_roles a WHERE a.profile_id = target AND a.revoked_at IS NULL;
  IF FOUND THEN
    IF NOT is_admin_for(existing.region_id) THEN
      RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
    END IF;
    IF existing.region_id IS NULL AND scope IS NOT NULL AND acting_global_admin_count(target) < 1 THEN
      RAISE EXCEPTION 'mest.last_global_admin' USING ERRCODE = '23514',
        DETAIL = 'one administrator for every region stays';
    END IF;
    UPDATE admin_roles a SET region_id = scope WHERE a.profile_id = target;
  ELSE
    INSERT INTO admin_roles (profile_id, granted_by, granted_at, region_id) VALUES (target, app_uid(), now(), scope)
    ON CONFLICT ON CONSTRAINT admin_roles_pkey DO UPDATE
      SET granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at, revoked_at = NULL,
          region_id = EXCLUDED.region_id;
  END IF;
  PERFORM write_audit('admin.granted', 'profile', target, jsonb_build_object('region', scope));
END
$$;

-- From 0013: the caller must administer the member's region and the role's
-- scope (a chapter administrator never revokes a region-wide one), and the
-- last region-wide administrator who can act stays.
CREATE OR REPLACE FUNCTION admin_revoke(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_revoke.profile_id;
  existing admin_roles%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM admin_roles a WHERE a.revoked_at IS NULL ORDER BY a.profile_id FOR UPDATE;
  SELECT * INTO existing FROM admin_roles a WHERE a.profile_id = target AND a.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF NOT admin_covers_profile(target) OR NOT is_admin_for(existing.region_id) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  IF acting_admin_count(target) < 2 THEN
    RAISE EXCEPTION 'mest.admin_minimum' USING ERRCODE = '23514', DETAIL = 'at least two administrators stay';
  END IF;
  IF existing.region_id IS NULL AND acting_global_admin_count(target) < 1 THEN
    RAISE EXCEPTION 'mest.last_global_admin' USING ERRCODE = '23514', DETAIL = 'one administrator for every region stays';
  END IF;
  UPDATE admin_roles a SET revoked_at = now() WHERE a.profile_id = target;
  PERFORM write_audit('admin.revoked', 'profile', target, '{}'::jsonb);
END
$$;

-- Privileges (section 5.3) -----------------------------------------------------------------

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON regions FROM app_user;
GRANT SELECT ON regions TO app_user;
CREATE POLICY regions_read ON regions FOR SELECT TO app_user USING (true);

-- is_admin_for and admin_covers_profile answer only about the caller, so
-- requests may ask them (the administration lists filter with them). The
-- raising helper and the count are internal.
REVOKE EXECUTE ON FUNCTION assert_admin_covers(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION assert_admin_covers_role(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION acting_global_admin_count(uuid) FROM PUBLIC, app_user;
