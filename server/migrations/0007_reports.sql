-- Profile reports and moderation (02-technical-architecture.md sections 4.3
-- to 4.5, 5.3 and 6; Task 24).
--
-- A member reports a profile they can see through report_profile; an
-- administrator closes it through admin_resolve_report, optionally hiding
-- the profile or suspending the account's requests. Nobody writes the table
-- directly. The reporter reads their own rows' status (never the resolution
-- note or who resolved it); the reported member reads nothing. Administrators
-- read reports through admin_reports and requests through admin_requests,
-- whose free text stays masked unless an open report names a party.
--
-- Also: a suspension stops contact values leaving through an accepted
-- relationship (release_contact and get_request_handoff check the mentor's
-- standing), and respond_to_request refuses to accept a mentee who is no
-- longer in good standing.

CREATE TYPE report_reason AS ENUM ('promotional', 'misrepresentation', 'unsafe', 'spam', 'other');
CREATE TYPE report_status AS ENUM ('open', 'resolved', 'dismissed');

-- reports ----------------------------------------------------------------------------

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id),
  -- Never shown to the reported member; nulled when the reporter's account is deleted.
  reporter_id uuid REFERENCES profiles (id),
  reason report_reason NOT NULL,
  detail text CHECK (char_length(detail) <= 1000),
  status report_status NOT NULL DEFAULT 'open',
  resolved_by uuid REFERENCES profiles (id),
  resolution_note text CHECK (char_length(resolution_note) <= 1000),
  -- What resolving did: none, hide_profile, suspend_requests or remove_account.
  action text CHECK (action IN ('none', 'hide_profile', 'suspend_requests', 'remove_account')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT reports_not_self CHECK (reporter_id IS NULL OR reporter_id <> profile_id),
  CONSTRAINT reports_closed_consistent CHECK (
    (status = 'open' AND resolved_at IS NULL AND action IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL AND action IS NOT NULL)
  ),
  CONSTRAINT reports_dismissed_takes_no_action CHECK (status <> 'dismissed' OR action = 'none')
);
-- The daily limit counts a reporter's last 24 hours.
CREATE INDEX reports_reporter_created_idx ON reports (reporter_id, created_at DESC);
-- What admin_requests and the dashboard ask: open reports about a profile.
CREATE INDEX reports_open_profile_idx ON reports (profile_id) WHERE status = 'open';
CREATE INDEX reports_status_created_idx ON reports (status, created_at DESC);

-- Internal helpers (definer functions call these; app_user cannot) ---------------------

-- The reason as a member picked it (shared/taxonomy.ts reportReasonOptions).
CREATE FUNCTION report_reason_label(reason report_reason) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE $1
    WHEN 'promotional' THEN 'Promotional or off-topic'
    WHEN 'misrepresentation' THEN 'Misrepresentation'
    WHEN 'unsafe' THEN 'Harassment or unsafe'
    WHEN 'spam' THEN 'Spam'
    ELSE 'Other'
  END
$$;

-- A full display name for administrators' notifications.
CREATE FUNCTION profile_display_name(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'A member')
    FROM profiles p WHERE p.id = $1
$$;

-- Filing --------------------------------------------------------------------------------

-- A member reports a profile they can see. Rate limited by
-- config.daily_report_limit over the reporter's last 24 hours. Every active
-- administrator gets an in-app notification; it is also emailed when no
-- other report was open (otherwise the weekly digest carries the count). The
-- notification names the profile and the reason, never the reporter or the
-- reporter's text; the reported member is told nothing.
CREATE FUNCTION report_profile(profile_id uuid, reason report_reason, detail text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  target uuid := report_profile.profile_id;
  clean_detail text := nullif(btrim(coalesce(report_profile.detail, '')), '');
  cfg_limit int;
  others_open int;
  new_id uuid;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- What a member can see: a listed profile, or the other party of an open
  -- request. Not profile_access, which lets an administrator see everyone:
  -- a report unmasks request text, so it must not reach unlisted members.
  IF target IS NULL OR NOT (profile_in_directory(target) OR is_counterparty(target)) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF target = me OR report_profile.reason IS NULL
     OR (clean_detail IS NOT NULL AND char_length(clean_detail) > 1000) THEN
    RAISE EXCEPTION 'mest.invalid_report' USING ERRCODE = '22023';
  END IF;

  -- Serializes the reporter's own count, so two concurrent reports cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('reports.reporter:' || me::text));
  SELECT c.value::int INTO cfg_limit FROM config c WHERE c.key = 'daily_report_limit';
  IF (SELECT count(*) FROM reports r WHERE r.reporter_id = me AND r.created_at > now() - interval '1 day')
     >= coalesce(cfg_limit, 3) THEN
    RAISE EXCEPTION 'mest.rate_limited' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::int INTO others_open FROM reports r WHERE r.status = 'open';

  INSERT INTO reports (profile_id, reporter_id, reason, detail)
  VALUES (target, me, report_profile.reason, clean_detail)
  RETURNING id INTO new_id;

  -- Every active administrator except the one reported, who is told nothing.
  PERFORM create_notification(
    a.profile_id,
    'report',
    'New report about ' || profile_display_name(target),
    'A member reported this profile as ' || lower(report_reason_label(report_profile.reason))
      || '. Open Reports to review it.',
    '/network/admin/reports',
    'report-received',
    jsonb_build_object(
      'reportId', new_id,
      'reason', report_profile.reason,
      'reasonLabel', report_reason_label(report_profile.reason),
      'profileName', profile_display_name(target),
      'link', '/network/admin/reports'
    ),
    others_open = 0
  )
    FROM admin_roles a JOIN users u ON u.id = a.profile_id
   WHERE a.revoked_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
     AND a.profile_id <> target;
  PERFORM write_audit('report.filed', 'report', new_id,
    jsonb_build_object('profile', target, 'reason', report_profile.reason));
  RETURN new_id;
END
$$;

-- Resolving -----------------------------------------------------------------------------

-- An administrator closes an open report as `resolved` or `dismissed`, with
-- an optional private note and one action:
--   none             nothing beyond closing the report
--   hide_profile     admin_hide_profile: out of the directory, mentoring off
--   suspend_requests sets users.suspended_at (is_member() turns false, so no
--                    requests, answers or contact releases) and tells the
--                    member, without the note or who reported them
--   remove_account   arrives with account deletion (Task 26 re-creates this
--                    function to call request_account_deletion(true, reason))
-- A dismissal takes no action. The reporter is told the status only.
CREATE FUNCTION admin_resolve_report(id uuid, status report_status, note text, action text) RETURNS void
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
    RAISE EXCEPTION 'mest.not_available' USING ERRCODE = '0A000';
  ELSIF act = 'hide_profile' THEN
    PERFORM admin_hide_profile(rep.profile_id);
  ELSIF act = 'suspend_requests' THEN
    -- An administrator does not suspend their own account.
    IF rep.profile_id = me THEN
      RAISE EXCEPTION 'mest.invalid_action' USING ERRCODE = '22023';
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

-- A suspension stops the handoff (Phase 1C handoff) -----------------------------------------

-- Re-created from 0005: the `shared_methods` of an accepted relationship are
-- released only while the mentor is in good standing.
CREATE OR REPLACE FUNCTION release_contact(profile_id uuid) RETURNS TABLE (method contact_method, value text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  me uuid := app_uid();
  target uuid := release_contact.profile_id;
  wanted contact_method[] := '{}';
  handed contact_method[];
  released contact_method[];
BEGIN
  IF me IS NULL OR NOT is_member() OR target IS NULL THEN
    RETURN;
  END IF;

  IF profile_listed_access(target, true) = 'visible' THEN
    SELECT c.share_with_members INTO wanted FROM contact_preferences c WHERE c.profile_id = target;
  END IF;

  IF member_in_good_standing(target) THEN
    SELECT array_agg(DISTINCT m) INTO handed
      FROM mentorship_relationships rel
      JOIN mentorship_requests r ON r.id = rel.request_id
      CROSS JOIN LATERAL unnest(rel.shared_methods) AS m
     WHERE rel.mentee_id = me AND rel.mentor_id = target
       AND rel.completed_at IS NULL AND r.status = 'accepted';
  END IF;

  wanted := coalesce(wanted, '{}') || coalesce(handed, '{}');
  IF cardinality(wanted) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v.method, v.value FROM contact_values(target, wanted) AS v;

  SELECT array_agg(v.method ORDER BY v.method) INTO released FROM contact_values(target, wanted) AS v;
  PERFORM audit_contact_viewed(target, released);
END
$$;

-- Re-created from 0005: nothing is handed over while the mentor is suspended,
-- deleted or leaving. The request itself stays readable.
CREATE OR REPLACE FUNCTION get_request_handoff(request_id uuid) RETURNS TABLE (method contact_method, value text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  me uuid := app_uid();
  r mentorship_requests%ROWTYPE;
  handed contact_method[];
  released contact_method[];
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM mentorship_requests mr WHERE mr.id = get_request_handoff.request_id;
  IF NOT FOUND OR me NOT IN (r.mentee_id, r.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF r.mentee_id <> me OR r.status <> 'accepted' THEN
    RAISE EXCEPTION 'mest.no_handoff' USING ERRCODE = '42501';
  END IF;
  IF NOT member_in_good_standing(r.mentor_id) THEN
    RETURN;
  END IF;
  SELECT rel.shared_methods INTO handed
    FROM mentorship_relationships rel
   WHERE rel.request_id = r.id AND rel.completed_at IS NULL;

  RETURN QUERY SELECT v.method, v.value FROM contact_values(r.mentor_id, handed) AS v;

  SELECT array_agg(v.method ORDER BY v.method) INTO released FROM contact_values(r.mentor_id, handed) AS v;
  PERFORM audit_contact_viewed(r.mentor_id, released, jsonb_build_object('request', r.id));
END
$$;

-- Re-created from 0005: an accept is refused (`mest.mentee_unavailable`)
-- when the mentee is no longer in good standing, so a suspended member gets
-- no new contact through a request they sent before the suspension.
-- Declining stays possible.
CREATE OR REPLACE FUNCTION respond_to_request(
  request_id uuid,
  decision text,
  note text,
  decline_reason text,
  share_methods contact_method[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  r mentorship_requests%ROWTYPE;
  settings mentorship_settings%ROWTYPE;
  methods_with_value contact_method[];
  clean_note text := nullif(btrim(coalesce(note, '')), '');
  shares contact_method[];
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF decision IS NULL OR decision NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'mest.invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF clean_note IS NOT NULL AND char_length(clean_note) > 600 THEN
    RAISE EXCEPTION 'mest.invalid_note' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM mentorship_requests mr WHERE mr.id = respond_to_request.request_id FOR UPDATE;
  IF NOT FOUND OR me NOT IN (r.mentee_id, r.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF r.mentor_id <> me THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'mest.not_pending' USING ERRCODE = '23514';
  END IF;

  IF decision = 'decline' THEN
    IF decline_reason IS NULL OR decline_reason NOT IN ('not_fit', 'no_capacity', 'outside_experience', 'other') THEN
      RAISE EXCEPTION 'mest.invalid_decline_reason' USING ERRCODE = '22023';
    END IF;
    UPDATE mentorship_requests mr
       SET status = 'declined', responded_at = now(), mentor_note = clean_note,
           decline_reason = respond_to_request.decline_reason
     WHERE mr.id = r.id;
    PERFORM create_notification(
      r.mentee_id, 'response',
      profile_first_name(me) || ' declined your ' || request_noun(r.kind),
      'You can send a request to someone else.',
      '/network/me/requests/' || r.id,
      'request-declined',
      request_payload(r) || jsonb_build_object('reason', respond_to_request.decline_reason,
                                               'link', '/network/me/requests/' || r.id),
      true,
      'mentorship_request', r.id
    );
    PERFORM write_audit('request.declined', 'mentorship_request', r.id,
      jsonb_build_object('reason', respond_to_request.decline_reason));
    RETURN;
  END IF;

  -- Accept. Only a mentee still in good standing can be handed contact.
  IF NOT member_in_good_standing(r.mentee_id) THEN
    RAISE EXCEPTION 'mest.mentee_unavailable' USING ERRCODE = '23514';
  END IF;

  -- The handoff is a subset of the methods the mentor uses that have a
  -- value; `mest` is not a handoff.
  SELECT array_agg(DISTINCT m ORDER BY m) INTO shares FROM unnest(coalesce(share_methods, '{}')) AS m;
  SELECT array_agg(v.method) INTO methods_with_value
    FROM contact_preferences c
    CROSS JOIN LATERAL contact_values(c.profile_id, c.methods) AS v
   WHERE c.profile_id = me;
  IF shares IS NULL OR cardinality(shares) = 0 OR 'mest' = ANY (shares)
     OR NOT (shares <@ coalesce(methods_with_value, '{}')) THEN
    RAISE EXCEPTION 'mest.invalid_share_methods' USING ERRCODE = '22023';
  END IF;

  -- Capacity again, under the lock creation takes, so two accepts for the
  -- last free slot cannot both pass. Introductions take no slot.
  SELECT * INTO settings FROM mentorship_settings s WHERE s.profile_id = me FOR UPDATE;
  IF r.kind = 'mentorship' AND (NOT FOUND OR mentor_active_count(me) >= settings.max_active) THEN
    RAISE EXCEPTION 'mest.mentor_full' USING ERRCODE = '23514';
  END IF;

  UPDATE mentorship_requests mr
     SET status = 'accepted', responded_at = now(), mentor_note = clean_note
   WHERE mr.id = r.id;
  INSERT INTO mentorship_relationships (request_id, mentee_id, mentor_id, topic_id, shared_methods)
  VALUES (r.id, r.mentee_id, r.mentor_id, r.topic_id, shares);

  PERFORM create_notification(
    r.mentee_id, 'response',
    profile_first_name(me) || ' accepted your ' || request_noun(r.kind),
    'Open the request to see how to reach ' || profile_first_name(me) || '.',
    '/network/me/requests/' || r.id,
    'request-accepted',
    request_payload(r) || jsonb_build_object('link', '/network/me/requests/' || r.id),
    true,
    'mentorship_request', r.id
  );
  PERFORM write_audit('request.accepted', 'mentorship_request', r.id,
    jsonb_build_object('shared_methods', to_jsonb(shares)));
END
$$;

-- Views (section 4.4) --------------------------------------------------------------------

-- Every report with the names an administrator needs, for administrators
-- only. Runs as the view owner (all rows, every column) and returns nothing
-- unless the caller is an administrator; app_user's own column grants on
-- reports keep the note and the resolver from the reporter.
CREATE VIEW admin_reports WITH (security_barrier = true) AS
SELECT
  r.id,
  r.status,
  r.reason,
  r.detail,
  r.created_at,
  r.resolved_at,
  r.resolution_note,
  r.action,
  r.profile_id,
  p.first_name AS profile_first_name,
  p.last_name AS profile_last_name,
  p.credentials AS profile_credentials,
  p.kind AS profile_kind,
  d.title AS profile_title,
  d.organization AS profile_organization,
  p.approval_state AS profile_approval_state,
  p.visibility AS profile_visibility,
  p.admin_hidden_at IS NOT NULL AS profile_admin_hidden,
  pu.suspended_at IS NOT NULL AS profile_suspended,
  p.anonymized_at IS NOT NULL AS profile_former,
  r.reporter_id,
  rp.first_name AS reporter_first_name,
  rp.last_name AS reporter_last_name,
  rp.anonymized_at IS NOT NULL AS reporter_former,
  r.resolved_by,
  rb.first_name AS resolver_first_name,
  rb.last_name AS resolver_last_name,
  rb.anonymized_at IS NOT NULL AS resolver_former,
  (SELECT count(*) FROM reports o WHERE o.profile_id = r.profile_id AND o.status = 'open')::int AS open_reports_on_profile
FROM reports r
JOIN profiles p ON p.id = r.profile_id
JOIN users pu ON pu.id = r.profile_id
LEFT JOIN professional_details d ON d.profile_id = r.profile_id
LEFT JOIN profiles rp ON rp.id = r.reporter_id
LEFT JOIN profiles rb ON rb.id = r.resolved_by
-- A reported administrator never sees the report, so never its reporter.
WHERE is_admin() AND r.profile_id <> app_uid();

-- Requests for administrators: status, dates, kind, topic and parties. The
-- free text (why, goals, scheduling_note, mentor_note) is masked unless an
-- open report names the mentee or the mentor. Runs as the view owner, for
-- administrators only; administrators have no policy on the table itself.
CREATE VIEW admin_requests WITH (security_barrier = true) AS
SELECT
  r.id,
  r.kind,
  r.status,
  r.topic_id,
  t.label AS topic_label,
  r.mentee_id,
  me.first_name AS mentee_first_name,
  me.last_name AS mentee_last_name,
  me.anonymized_at IS NOT NULL AS mentee_former,
  r.mentor_id,
  mo.first_name AS mentor_first_name,
  mo.last_name AS mentor_last_name,
  mo.anonymized_at IS NOT NULL AS mentor_former,
  r.created_at,
  r.expires_at,
  r.responded_at,
  r.decline_reason,
  r.reminders_sent,
  r.text_purged_at IS NOT NULL AS text_purged,
  flag.under_report,
  CASE WHEN flag.under_report THEN r.why END AS why,
  CASE WHEN flag.under_report THEN r.goals END AS goals,
  CASE WHEN flag.under_report THEN r.scheduling_note END AS scheduling_note,
  CASE WHEN flag.under_report THEN r.mentor_note END AS mentor_note
FROM mentorship_requests r
JOIN profiles me ON me.id = r.mentee_id
JOIN profiles mo ON mo.id = r.mentor_id
LEFT JOIN mentorship_topics t ON t.id = r.topic_id
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1 FROM reports rep
     WHERE rep.status = 'open' AND rep.profile_id IN (r.mentee_id, r.mentor_id)
       -- Only a member's report opens the text; an administrator cannot
       -- open it by filing one.
       AND NOT EXISTS (
         SELECT 1 FROM admin_roles a WHERE a.profile_id = rep.reporter_id AND a.revoked_at IS NULL
       )
  ) AS under_report
) flag
WHERE is_admin();

-- Re-created from 0004 with the open reports appended (Task 25 adds the
-- request measures).
CREATE OR REPLACE VIEW admin_dashboard AS
SELECT
  (SELECT count(*) FROM profiles p
    WHERE p.kind = 'professional' AND p.approval_state = 'approved' AND p.anonymized_at IS NULL)::int AS approved_professionals,
  (SELECT count(*) FROM profiles p
    WHERE p.kind = 'professional' AND p.approval_state = 'pending' AND p.anonymized_at IS NULL)::int AS pending_professionals,
  (SELECT count(*) FROM profiles p WHERE p.kind = 'student' AND p.anonymized_at IS NULL)::int AS students,
  (SELECT count(*) FROM mentorship_settings s JOIN profiles p ON p.id = s.profile_id
    WHERE s.status = 'active' AND p.approval_state = 'approved' AND p.admin_hidden_at IS NULL
      AND p.anonymized_at IS NULL)::int AS active_mentors,
  (SELECT count(*) FROM reports r WHERE r.status = 'open')::int AS open_reports
WHERE is_admin();

-- Privileges (section 5.3) ----------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION profile_display_name(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION report_reason_label(report_reason) FROM PUBLIC, app_user;

-- Reports: written only by report_profile and admin_resolve_report. The
-- reporter reads status, never the resolution note or who resolved it.
REVOKE ALL ON reports FROM app_user;
GRANT SELECT (id, profile_id, reporter_id, reason, detail, status, created_at, resolved_at) ON reports TO app_user;

-- Views are read-only for requests (the default privileges also granted writes).
REVOKE ALL ON admin_reports, admin_requests FROM app_user;
GRANT SELECT ON admin_reports, admin_requests TO app_user;
REVOKE ALL ON admin_dashboard FROM app_user;
GRANT SELECT ON admin_dashboard TO app_user;

-- Row-level security ----------------------------------------------------------------------

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- The reporter, their own rows; administrators read the full record through
-- admin_reports. The reported member has no policy at all.
CREATE POLICY reports_reporter_read ON reports FOR SELECT TO app_user USING (reporter_id = app_uid());
