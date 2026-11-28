-- 0021_meeting_standing: scheduling and the other party's standing (Task 39
-- audit findings).
--
-- 1. lock_active_relationship (0014), which propose_times and choose_time
--    start with, also requires both parties to be in good standing: the
--    caller is refused (mest.forbidden) and a suspended or leaving other
--    party answers mest.counterparty_unavailable.
-- 2. Suspending a member (admin_resolve_report, suspend_requests) and
--    opening a deletion (schedule_account_deletion, both the grace and the
--    immediate branches, which request_account_deletion reaches too) call
--    close_meetings_of_departing at once, so the member's meetings still to
--    come are canceled and their open times withdrawn without waiting for
--    the sweep. Both re-created from 0020; who may call them is unchanged.
-- 3. create_notification (0018) queues no email to a suspended member
--    unless the category is account; the in-app row is still written.
-- 4. propose_times (0014) still writes the in-app notice every time but
--    emails it only when the other party has no unread, emailed proposal
--    notice from this relationship from the last 24 hours. Its payload
--    gains event = times_proposed so the check can tell a proposal notice
--    from a cancellation on the same request.
-- 5. relationship_path (0014) sends the mentor to /network/mentor/mentees/<id>,
--    the page with the meetings panel, instead of the request drawer.

-- 1. Both parties in good standing ----------------------------------------------

-- From 0014: the relationship, locked, when the caller is one of its parties
-- and it is still active, and both parties are in good standing; raises
-- otherwise. Every scheduling write starts here.
CREATE OR REPLACE FUNCTION lock_active_relationship(relationship uuid) RETURNS mentorship_relationships
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  rel mentorship_relationships%ROWTYPE;
BEGIN
  SELECT * INTO rel FROM mentorship_relationships r WHERE r.id = relationship FOR UPDATE;
  IF NOT FOUND OR me IS NULL OR me NOT IN (rel.mentee_id, rel.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF rel.completed_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM mentorship_requests r WHERE r.id = rel.request_id AND r.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'mest.not_active' USING ERRCODE = '23514';
  END IF;
  IF NOT member_in_good_standing(me) THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT member_in_good_standing(CASE WHEN me = rel.mentee_id THEN rel.mentor_id ELSE rel.mentee_id END) THEN
    RAISE EXCEPTION 'mest.counterparty_unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN rel;
END
$$;

REVOKE EXECUTE ON FUNCTION lock_active_relationship(uuid) FROM PUBLIC, app_user;

-- 5. The mentor's page ------------------------------------------------------------

-- From 0014: the page for the recipient's side of the relationship. The
-- mentee's is the request; the mentor's is the mentorship page, where the
-- meetings and the feedback form are.
CREATE OR REPLACE FUNCTION relationship_path(rel mentorship_relationships, recipient uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN recipient = rel.mentee_id THEN '/network/me/requests/' ELSE '/network/mentor/mentees/' END
         || rel.request_id
$$;

REVOKE EXECUTE ON FUNCTION relationship_path(mentorship_relationships, uuid) FROM PUBLIC, app_user;

-- 4. Proposals email at most once a day while unread ---------------------------------

-- From 0014, with the email held back as described above.
CREATE OR REPLACE FUNCTION propose_times(relationship_id uuid, slots jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  rel mentorship_relationships%ROWTYPE;
  batch uuid := gen_random_uuid();
  item jsonb;
  starts timestamptz[] := '{}';
  ends timestamptz[] := '{}';
  s timestamptz;
  e timestamptz;
  n int;
  other uuid;
  emailed boolean;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  rel := lock_active_relationship(propose_times.relationship_id);

  IF slots IS NULL OR jsonb_typeof(slots) <> 'array' OR jsonb_array_length(slots) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'mest.invalid_slots' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT j.value FROM jsonb_array_elements(slots) AS j LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'mest.invalid_slots' USING ERRCODE = '22023';
    END IF;
    BEGIN
      s := (item ->> 'starts_at')::timestamptz;
      e := (item ->> 'ends_at')::timestamptz;
    EXCEPTION WHEN data_exception THEN
      RAISE EXCEPTION 'mest.invalid_slots' USING ERRCODE = '22023';
    END;
    IF s IS NULL OR e IS NULL OR s <= now() OR s > now() + interval '365 days'
       OR e < s + interval '15 minutes' OR e > s + interval '180 minutes' THEN
      RAISE EXCEPTION 'mest.invalid_slots' USING ERRCODE = '22023';
    END IF;
    starts := starts || s;
    ends := ends || e;
  END LOOP;
  n := cardinality(starts);
  IF (SELECT count(DISTINCT x) FROM unnest(starts) AS x) <> n THEN
    RAISE EXCEPTION 'mest.invalid_slots' USING ERRCODE = '22023';
  END IF;

  UPDATE availability_slots sl SET status = 'withdrawn'
   WHERE sl.relationship_id = rel.id AND sl.proposed_by = me AND sl.status = 'proposed';
  INSERT INTO availability_slots (relationship_id, proposed_by, batch_id, starts_at, ends_at)
  SELECT rel.id, me, batch, t.s, t.e FROM unnest(starts, ends) AS t (s, e);

  other := CASE WHEN me = rel.mentee_id THEN rel.mentor_id ELSE rel.mentee_id END;
  -- One email a day at most while the other party has not opened the last
  -- one: an unread proposal notice from this relationship, emailed in the
  -- last 24 hours, holds the email back. The in-app notice is always written.
  emailed := NOT EXISTS (
    SELECT 1 FROM notifications nt
     WHERE nt.recipient_id = other
       AND nt.subject_type = 'mentorship_request' AND nt.subject_id = rel.request_id
       AND nt.payload ->> 'event' = 'times_proposed'
       AND nt.read_at IS NULL
       AND nt.email_status <> 'skipped'
       AND nt.created_at > now() - interval '24 hours'
  );
  PERFORM create_notification(
    other, 'request',
    profile_first_name(me) || ' proposed ' || CASE WHEN n = 1 THEN 'a time' ELSE n || ' times' END || ' to meet',
    'Open the mentorship to choose one, or propose other times.',
    relationship_path(rel, other),
    'default',
    jsonb_build_object('requestId', rel.request_id, 'event', 'times_proposed', 'link', relationship_path(rel, other)),
    emailed,
    'mentorship_request', rel.request_id
  );
  PERFORM write_audit('meeting.times_proposed', 'mentorship_request', rel.request_id,
    jsonb_build_object('batch', batch, 'count', n));
  RETURN batch;
END
$$;

-- 3. No email to a suspended member ----------------------------------------------

-- From 0018. Inserts the in-app notification and, when `email` is true,
-- queues the email if the category is `account` (always sent) or the
-- recipient's preference column for that category is on. A recipient with
-- no preference row yet has the column defaults: on for every category
-- except `member_digest`, which is opt-in. A suspended recipient gets only
-- account emails.
CREATE OR REPLACE FUNCTION create_notification(
  recipient uuid,
  category notification_category,
  title text,
  body text,
  link text,
  template text,
  payload jsonb,
  email boolean,
  subject_type text DEFAULT NULL,
  subject_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid;
  tmpl text := coalesce(nullif(create_notification.template, ''), 'default');
  clean jsonb := audit_strip_private(coalesce(create_notification.payload, '{}'::jsonb));
  wants boolean;
  address citext;
BEGIN
  -- Caller check: app_user has no EXECUTE on this function (revoked below),
  -- so only definer functions and system jobs reach it.
  IF create_notification.recipient IS NULL OR create_notification.category IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_notification' USING ERRCODE = '22023';
  END IF;

  INSERT INTO notifications (
    recipient_id, category, subject_type, subject_id, title, body, link, template, payload, email_status
  ) VALUES (
    create_notification.recipient,
    create_notification.category,
    create_notification.subject_type,
    create_notification.subject_id,
    create_notification.title,
    coalesce(create_notification.body, ''),
    create_notification.link,
    tmpl,
    clean,
    'skipped'
  )
  RETURNING id INTO new_id;

  IF NOT coalesce(create_notification.email, false) THEN
    RETURN new_id;
  END IF;

  IF create_notification.category = 'account' THEN
    wants := true;
  ELSE
    SELECT CASE create_notification.category::text
             WHEN 'request' THEN np.email_requests
             WHEN 'response' THEN np.email_responses
             WHEN 'reminder' THEN np.email_reminders
             WHEN 'profile' THEN np.email_profile
             WHEN 'report' THEN np.email_reports
             WHEN 'admin_digest' THEN np.email_admin_digest
             WHEN 'member_digest' THEN np.email_member_digest
             ELSE false
           END
      INTO wants
      FROM notification_preferences np
     WHERE np.profile_id = create_notification.recipient;
    IF NOT FOUND THEN
      wants := create_notification.category::text <> 'member_digest';
    END IF;
  END IF;

  IF NOT coalesce(wants, false) THEN
    RETURN new_id;
  END IF;

  -- A deleted account (tombstone, email null) gets the in-app row only, and
  -- so does a suspended one unless the notice is about the account itself.
  SELECT u.email INTO address
    FROM users u
   WHERE u.id = create_notification.recipient AND u.deleted_at IS NULL
     AND (u.suspended_at IS NULL OR create_notification.category = 'account');
  IF address IS NULL THEN
    RETURN new_id;
  END IF;

  PERFORM enqueue_email(
    address,
    tmpl,
    jsonb_build_object(
      'title', create_notification.title,
      'body', coalesce(create_notification.body, ''),
      'link', create_notification.link
    ) || clean,
    new_id
  );
  UPDATE notifications n SET email_status = 'queued' WHERE n.id = new_id;
  RETURN new_id;
END
$$;

REVOKE EXECUTE ON FUNCTION
  create_notification(uuid, notification_category, text, text, text, text, jsonb, boolean, text, uuid)
  FROM PUBLIC, app_user;

-- 2. Suspension and deletion close meetings at once ---------------------------------

-- From 0020, with close_meetings_of_departing on suspension.
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
    -- Their meetings still to come are canceled and their open times withdrawn.
    PERFORM close_meetings_of_departing(rep.profile_id);
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

-- From 0020, with close_meetings_of_departing in both branches.
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
    PERFORM close_meetings_of_departing(target);
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
  PERFORM close_meetings_of_departing(target);

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

REVOKE EXECUTE ON FUNCTION schedule_account_deletion(uuid, boolean, text) FROM PUBLIC, app_user;
