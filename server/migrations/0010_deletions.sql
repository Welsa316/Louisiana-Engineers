-- Account deletion with a 14-day grace period, and the sweep
-- (02-technical-architecture.md section 8; Task 26).
--
-- A member asks for deletion with request_account_deletion(false, null): the
-- profile is hidden at once, mentoring goes off, the requests they sent are
-- canceled and the ones they received are declined as `member_left`, and the
-- account waits 14 days. cancel_account_deletion() in that window puts
-- everything back. After it, the `deletions` job calls
-- execute_account_deletion(id), which turns the profile into a "Former
-- member" tombstone, deletes every per-member table, empties the free text
-- of their requests (keeping the rows, so the other party's history and the
-- statistics survive), and removes the address from users, auth_tokens and
-- email_outbox.
--
-- An administrator removes an account through admin_resolve_report with
-- `remove_account` (re-created below): the same steps with no grace period,
-- so the next sweep deletes it. The reason is kept in the deletion row and
-- the audit entry.

-- Visibility is locked while a deletion is open -----------------------------------------
--
-- profiles_owner_update already requires is_member(), so the leaving member's
-- own UPDATE matches no row. This trigger also stops an administrator (or any
-- other direct write) from re-listing a profile during the grace period; the
-- deletion functions run as the table owner and pass.
-- Runs as the invoker, so current_user is the writer as in every other
-- owner-guard. Whoever can update a profile row can also read its deletion
-- rows (the owner and administrator policies on account_deletions), so the
-- check needs no definer helper.
CREATE FUNCTION profiles_guard_visibility_while_deleting() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.visibility IS DISTINCT FROM OLD.visibility
     AND NOT acting_as_table_owner(TG_RELID)
     AND EXISTS (
       SELECT 1 FROM account_deletions d
        WHERE d.profile_id = NEW.id AND d.canceled_at IS NULL AND d.executed_at IS NULL
     ) THEN
    RAISE EXCEPTION 'mest.deletion_scheduled'
      USING ERRCODE = '42501', DETAIL = 'visibility is locked while the account is scheduled for deletion';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_guard_visibility_while_deleting BEFORE UPDATE OF visibility ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_guard_visibility_while_deleting();

-- Internal helpers (definer functions call these; app_user cannot) -----------------------

-- Closes the requests a departing member is party to that are still waiting:
-- the ones they sent are canceled (the mentor hears in the app only, without
-- a name), the ones they received are declined with `member_left` (the
-- mentee is told and emailed, template request-declined). Returns how many
-- requests it closed. Safe to call again: it only touches pending rows.
CREATE FUNCTION close_requests_of_departing(target uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r mentorship_requests%ROWTYPE;
  closed int := 0;
BEGIN
  FOR r IN
    SELECT * FROM mentorship_requests mr
     WHERE mr.mentee_id = target AND mr.status = 'pending'
     ORDER BY mr.created_at, mr.id
       FOR UPDATE
  LOOP
    UPDATE mentorship_requests mr SET status = 'canceled' WHERE mr.id = r.id;
    PERFORM create_notification(
      r.mentor_id, 'request',
      'A ' || request_noun(r.kind) || ' was withdrawn',
      'The member who sent it left MEST Network. There is nothing for you to do.',
      '/network/mentor/requests/' || r.id,
      'default', '{}'::jsonb, false,
      'mentorship_request', r.id
    );
    PERFORM write_audit('request.canceled', 'mentorship_request', r.id, jsonb_build_object('reason', 'member_left'));
    closed := closed + 1;
  END LOOP;

  FOR r IN
    SELECT * FROM mentorship_requests mr
     WHERE mr.mentor_id = target AND mr.status = 'pending'
     ORDER BY mr.created_at, mr.id
       FOR UPDATE
  LOOP
    UPDATE mentorship_requests mr
       SET status = 'declined', responded_at = now(), decline_reason = 'member_left'
     WHERE mr.id = r.id;
    PERFORM create_notification(
      r.mentee_id, 'response',
      'Your ' || request_noun(r.kind) || ' to ' || profile_first_name(r.mentor_id) || ' was closed',
      'They left MEST Network, so your request was closed. You can send a request to someone else.',
      '/network/me/requests/' || r.id,
      'request-declined',
      request_payload(r) || jsonb_build_object('reason', 'member_left', 'link', '/network/me/requests/' || r.id),
      true,
      'mentorship_request', r.id
    );
    PERFORM write_audit('request.declined', 'mentorship_request', r.id, jsonb_build_object('reason', 'member_left'));
    closed := closed + 1;
  END LOOP;

  RETURN closed;
END
$$;

-- Opens a deletion for `target` (section 8, steps 2 and 5): hides the
-- profile, turns mentoring off keeping the previous status, closes waiting
-- requests and tells the member. `immediate` (an administrator's removal)
-- sets execute_after to now, so the next sweep deletes the account; an
-- owner's deletion that is already open is made immediate the same way.
-- Raises mest.deletion_scheduled when an owner asks twice.
CREATE FUNCTION schedule_account_deletion(target uuid, immediate boolean, reason text) RETURNS uuid
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

-- Functions (section 4.5) ------------------------------------------------------------------

-- The member asks to delete their own account. Only `immediate = false`: an
-- immediate removal is an administrator's, through admin_resolve_report.
-- A suspended member may still leave; the account must exist, be verified
-- and not already be deleted. The reason is for administrators' removals,
-- so an owner's is not stored. Returns the deletion's id.
CREATE FUNCTION request_account_deletion(immediate boolean, reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
BEGIN
  IF me IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u JOIN profiles p ON p.id = u.id
     WHERE u.id = me AND u.email_verified_at IS NOT NULL AND u.deleted_at IS NULL AND p.anonymized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF coalesce(request_account_deletion.immediate, false) THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501', DETAIL = 'only an administrator removes an account at once';
  END IF;
  RETURN schedule_account_deletion(me, false, NULL);
END
$$;

-- The member keeps their account during the grace period: the deletion is
-- canceled, the profile's visibility and the mentorship status come back,
-- and the member is told (account, deletion-canceled). An administrator's
-- removal cannot be canceled this way.
CREATE FUNCTION cancel_account_deletion() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  d account_deletions%ROWTYPE;
  hidden timestamptz;
BEGIN
  IF me IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = me AND u.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.admin_hidden_at INTO hidden FROM profiles p WHERE p.id = me FOR UPDATE;
  SELECT * INTO d FROM account_deletions ad
   WHERE ad.profile_id = me AND ad.canceled_at IS NULL AND ad.executed_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.no_deletion' USING ERRCODE = '23514';
  END IF;
  IF d.immediate THEN
    RAISE EXCEPTION 'mest.removed_by_admin' USING ERRCODE = '42501';
  END IF;

  UPDATE account_deletions ad SET canceled_at = now() WHERE ad.id = d.id;
  UPDATE profiles p SET visibility = d.previous_visibility WHERE p.id = me;
  -- As admin_restore_profile does, unless an administrator's hide is holding
  -- the status (their restore brings it back).
  IF hidden IS NULL THEN
    UPDATE mentorship_settings s
       SET status = coalesce(s.previous_status, s.status),
           paused_until = CASE WHEN coalesce(s.previous_status, s.status) = 'paused' THEN s.paused_until END,
           previous_status = NULL
     WHERE s.profile_id = me;
  END IF;

  PERFORM create_notification(
    me, 'account',
    'Your account will not be deleted',
    'You kept your account. Your profile visibility and mentorship settings are back to what they were.',
    '/network/me',
    'deletion-canceled',
    jsonb_build_object('firstName', profile_first_name(me), 'link', '/network/me'),
    true,
    'profile', me
  );
  PERFORM write_audit('account.deletion_canceled', 'profile', me, '{}'::jsonb);
END
$$;

-- The sweep (section 8, step 4). System context only: the `deletions` job
-- calls it for each open row past execute_after. Moves a row at most once
-- and returns whether it did. `as_of` is the scheduler's clock.
CREATE FUNCTION execute_account_deletion(id uuid, as_of timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d account_deletions%ROWTYPE;
  target uuid;
  address citext;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM account_deletions ad WHERE ad.id = execute_account_deletion.id FOR UPDATE;
  IF NOT FOUND OR d.canceled_at IS NOT NULL OR d.executed_at IS NOT NULL
     OR d.execute_after > coalesce(as_of, now()) THEN
    RETURN false;
  END IF;
  target := d.profile_id;
  PERFORM 1 FROM profiles p WHERE p.id = target FOR UPDATE;
  SELECT u.email INTO address FROM users u WHERE u.id = target FOR UPDATE;

  -- Requests: anything still waiting is closed as at the request; active
  -- relationships end (so a departed mentee no longer holds a mentor's
  -- slot); every row stays, its free text emptied.
  PERFORM close_requests_of_departing(target);
  UPDATE mentorship_requests r SET status = 'completed'
   WHERE r.status = 'accepted' AND (r.mentee_id = target OR r.mentor_id = target);
  UPDATE mentorship_relationships rel SET completed_at = now(), completed_by = target
   WHERE rel.completed_at IS NULL AND (rel.mentee_id = target OR rel.mentor_id = target);
  UPDATE mentorship_requests r
     SET why = '', goals = NULL, scheduling_note = NULL, mentor_note = NULL,
         text_purged_at = coalesce(r.text_purged_at, now())
   WHERE r.mentee_id = target OR r.mentor_id = target;

  -- Per-member tables.
  DELETE FROM profile_expertise pe WHERE pe.profile_id = target;
  DELETE FROM education e WHERE e.profile_id = target;
  DELETE FROM professional_details pd WHERE pd.profile_id = target;
  DELETE FROM student_details sd WHERE sd.profile_id = target;
  DELETE FROM mentor_topics mt WHERE mt.profile_id = target;
  DELETE FROM mentorship_settings s WHERE s.profile_id = target;
  DELETE FROM contact_preferences c WHERE c.profile_id = target;
  DELETE FROM saved_profiles sp WHERE sp.saver_id = target OR sp.saved_id = target;
  DELETE FROM notifications n WHERE n.recipient_id = target;
  DELETE FROM notification_preferences np WHERE np.profile_id = target;

  -- Reviews: an open one is withdrawn; a decided one keeps its decision and
  -- loses the snapshot of what was submitted.
  DELETE FROM profile_reviews pr WHERE pr.profile_id = target AND pr.decision IS NULL;
  UPDATE profile_reviews pr SET snapshot = '{}'::jsonb WHERE pr.profile_id = target;

  -- Reports they filed stay as a moderation record without the reporter.
  UPDATE reports rep SET reporter_id = NULL WHERE rep.reporter_id = target;

  -- An administrator who leaves is no longer one.
  UPDATE admin_roles a SET revoked_at = now() WHERE a.profile_id = target AND a.revoked_at IS NULL;

  -- The tombstone. kind and region stay for the aggregate counts.
  UPDATE profiles p
     SET first_name = 'Former', last_name = 'member',
         credentials = NULL, bio = NULL, location = NULL, linkedin_url = NULL, website_url = NULL,
         visibility = 'hidden', last_active_at = NULL, anonymized_at = now()
   WHERE p.id = target;
  UPDATE users u SET email = NULL, google_sub = NULL, deleted_at = now() WHERE u.id = target;

  DELETE FROM sessions s WHERE s.user_id = target;
  IF address IS NOT NULL THEN
    DELETE FROM auth_tokens t WHERE t.email = address;
    DELETE FROM email_outbox o WHERE o.to_email = address;
  END IF;

  UPDATE account_deletions ad SET executed_at = now() WHERE ad.id = d.id;
  PERFORM write_audit('account.deleted', 'profile', target,
    jsonb_build_object('immediate', d.immediate, 'reason', CASE WHEN d.immediate THEN d.reason END));
  RETURN true;
END
$$;

-- remove_account works (re-created from 0007) ---------------------------------------------

-- As in 0007, with `remove_account` now opening an immediate deletion
-- (schedule_account_deletion(profile, true, reason)): the profile is hidden
-- and its requests closed at once, and the next sweep deletes the account.
-- The reason is the administrator's note, or the report's reason when there
-- is none.
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

-- Privileges (section 5.3) -----------------------------------------------------------------

-- Internal helpers and the sweep: definer functions and the jobs only.
REVOKE EXECUTE ON FUNCTION close_requests_of_departing(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION schedule_account_deletion(uuid, boolean, text) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION execute_account_deletion(uuid, timestamptz) FROM PUBLIC, app_user;
