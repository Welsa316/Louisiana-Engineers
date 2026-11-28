-- 0023: what a chapter administrator reads and changes (Task 39 privacy
-- audit; 02-technical-architecture.md section 5.4).
--
-- 0020 scoped every administrator function that acts on a profile, but left
-- the reads and the network-wide changes open to any administrator. The
-- decision: a chapter (region-scoped) administrator acts and reads only
-- inside its region, and a change that applies to the whole network needs
-- an administrator for every region.
--
-- 1. Every region only (mest.out_of_region otherwise): admin_update_config,
--    admin_add_vocabulary, admin_rename_vocabulary, admin_retire_topic,
--    admin_merge_tags and admin_review_tag. Each is re-created from its
--    latest definition (0002, 0004, 0017) with that one check added after
--    the is_admin() check.
-- 2. Reads follow the region: the administrator policies on profiles,
--    student_details, profile_reviews and mentorship_relationships; the
--    admin_reports view (reports on a profile in the caller's regions); the
--    admin_requests view (a party in the caller's regions, and the request
--    text only when the open report is on a profile the caller covers).
--    admin_roster names every administrator to every administrator, since
--    the administrators list can no longer read the profiles of those
--    outside a chapter administrator's region. The dashboard counts stay
--    network-wide.
-- 3. Notifications about a profile reach only the administrators who cover
--    it: notify_admins takes the subject profile (open_profile_review passes
--    it), and report_profile sends "report received" only to them.
--
-- Nothing here stores member data, so execute_account_deletion and the
-- export are unchanged.

-- 1. Network-wide changes ---------------------------------------------------------------

-- From 0002.
CREATE OR REPLACE FUNCTION admin_update_config(key text, value jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous jsonb;
  expiry int;
  reminders jsonb;
  item jsonb;
  last_day int := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- A network-wide change: an administrator for every region only.
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;

  -- Expiry and reminder days validate against each other, so lock both rows
  -- (in a fixed order) before reading either; concurrent edits cannot then
  -- each pass and leave a reminder at or past the expiry.
  PERFORM 1 FROM config c WHERE c.key IN ('reminder_days', 'request_expiry_days') ORDER BY c.key FOR UPDATE;
  SELECT c.value INTO previous FROM config c WHERE c.key = admin_update_config.key FOR UPDATE;
  IF NOT FOUND OR value IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'unknown key';
  END IF;

  CASE admin_update_config.key
    WHEN 'request_expiry_days' THEN
      IF NOT config_is_int_between(value, 3, 60) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'request_expiry_days is 3..60';
      END IF;
      SELECT c.value INTO reminders FROM config c WHERE c.key = 'reminder_days';
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(reminders) AS r
         WHERE r.value::numeric >= admin_update_config.value::numeric
      ) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023',
          DETAIL = 'request_expiry_days must be above every reminder day';
      END IF;
    WHEN 'reminder_days' THEN
      IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 2 THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023',
          DETAIL = 'reminder_days is an array of at most 2 days (reminders_sent counts to 2)';
      END IF;
      SELECT c.value::int INTO expiry FROM config c WHERE c.key = 'request_expiry_days';
      FOR item IN SELECT a.value FROM jsonb_array_elements(admin_update_config.value) WITH ORDINALITY AS a ORDER BY a.ordinality LOOP
        IF NOT config_is_int_between(item, last_day + 1, expiry - 1) THEN
          RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023',
            DETAIL = 'reminder_days are ascending whole days below request_expiry_days';
        END IF;
        last_day := item::int;
      END LOOP;
    WHEN 'pending_cap' THEN
      IF NOT config_is_int_between(value, 1, 10) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'pending_cap is 1..10';
      END IF;
    WHEN 'default_max_active' THEN
      IF NOT config_is_int_between(value, 1, 10) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'default_max_active is 1..10';
      END IF;
    WHEN 'daily_request_limit' THEN
      IF NOT config_is_int_between(value, 1, 50) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'daily_request_limit is 1..50';
      END IF;
    WHEN 'daily_report_limit' THEN
      IF NOT config_is_int_between(value, 1, 20) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'daily_report_limit is 1..20';
      END IF;
    WHEN 'magic_links_per_hour' THEN
      IF NOT config_is_int_between(value, 1, 20) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'magic_links_per_hour is 1..20';
      END IF;
    WHEN 'platform_paused' THEN
      IF jsonb_typeof(value) <> 'boolean' THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'platform_paused is a boolean';
      END IF;
    WHEN 'retention_months' THEN
      IF NOT config_is_int_between(value, 6, 60) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'retention_months is 6..60';
      END IF;
    ELSE
      RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'unknown key';
  END CASE;

  UPDATE config c SET value = admin_update_config.value, updated_at = now() WHERE c.key = admin_update_config.key;
  PERFORM write_audit(
    'config.updated', 'config', NULL,
    jsonb_build_object('key', admin_update_config.key, 'previous', previous, 'value', admin_update_config.value)
  );
END
$$;

-- From 0004.
CREATE OR REPLACE FUNCTION admin_add_vocabulary(kind text, id text, label text, group_name discipline_group DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean_label text := btrim(coalesce(label, ''));
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- A network-wide change: an administrator for every region only.
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  IF kind IS NULL OR kind NOT IN ('discipline', 'topic') OR id IS NULL OR NOT is_slug(id)
     OR char_length(clean_label) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'mest.invalid_vocabulary' USING ERRCODE = '22023';
  END IF;
  IF kind = 'discipline' THEN
    IF EXISTS (SELECT 1 FROM disciplines d WHERE d.id = admin_add_vocabulary.id) THEN
      RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505';
    END IF;
    INSERT INTO disciplines (id, label, group_name, sort_order)
    VALUES (admin_add_vocabulary.id, clean_label, admin_add_vocabulary.group_name,
            (SELECT coalesce(max(d.sort_order), 0) + 1 FROM disciplines d));
  ELSE
    IF EXISTS (SELECT 1 FROM mentorship_topics t WHERE t.id = admin_add_vocabulary.id) THEN
      RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505';
    END IF;
    INSERT INTO mentorship_topics (id, label, sort_order)
    VALUES (admin_add_vocabulary.id, clean_label, (SELECT coalesce(max(t.sort_order), 0) + 1 FROM mentorship_topics t));
  END IF;
  PERFORM write_audit('vocabulary.added', kind, NULL, jsonb_build_object('id', admin_add_vocabulary.id, 'label', clean_label));
END
$$;

-- From 0017.
CREATE OR REPLACE FUNCTION admin_merge_tags(from_tag uuid, into_tag uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  src expertise_tags%ROWTYPE;
  dst expertise_tags%ROWTYPE;
  holders uuid[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- A network-wide change: an administrator for every region only.
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM expertise_tags t WHERE t.id IN (from_tag, into_tag) ORDER BY t.id FOR UPDATE;
  SELECT * INTO src FROM expertise_tags t WHERE t.id = from_tag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO dst FROM expertise_tags t WHERE t.id = into_tag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF src.id = dst.id OR src.merged_into IS NOT NULL OR dst.merged_into IS NOT NULL OR dst.status <> 'approved' THEN
    RAISE EXCEPTION 'mest.invalid_merge' USING ERRCODE = '23514',
      DETAIL = 'merge into another approved tag that has not been merged itself';
  END IF;

  SELECT coalesce(array_agg(pe.profile_id ORDER BY pe.profile_id), '{}') INTO holders
    FROM profile_expertise pe WHERE pe.tag_id = src.id;
  -- Delete first, so a profile at the tag limit has room for the new link.
  DELETE FROM profile_expertise pe WHERE pe.tag_id = src.id;
  INSERT INTO profile_expertise (profile_id, tag_id)
  SELECT h, dst.id FROM unnest(holders) AS h
  ON CONFLICT DO NOTHING;

  UPDATE expertise_tags t SET status = 'rejected', merged_into = dst.id WHERE t.id = src.id;
  UPDATE expertise_tags t SET merged_into = dst.id WHERE t.merged_into = src.id;

  PERFORM write_audit('tag.merged', 'expertise_tag', src.id, jsonb_build_object(
    'label', src.label, 'intoId', dst.id, 'intoLabel', dst.label, 'moved', cardinality(holders)
  ));
  RETURN cardinality(holders);
END
$$;

-- From 0017.
CREATE OR REPLACE FUNCTION admin_rename_vocabulary(kind text, id text, label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean_label text := btrim(coalesce(label, ''));
  tag_uuid uuid;
  tag expertise_tags%ROWTYPE;
  previous text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- A network-wide change: an administrator for every region only.
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  IF kind IS NULL OR kind NOT IN ('discipline', 'topic', 'tag') OR id IS NULL
     OR char_length(clean_label) NOT BETWEEN 2 AND (CASE WHEN kind = 'tag' THEN 40 ELSE 80 END) THEN
    RAISE EXCEPTION 'mest.invalid_vocabulary' USING ERRCODE = '22023';
  END IF;

  IF kind = 'tag' THEN
    BEGIN
      tag_uuid := id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END;
    SELECT * INTO tag FROM expertise_tags t WHERE t.id = tag_uuid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END IF;
    IF tag.merged_into IS NOT NULL THEN
      RAISE EXCEPTION 'mest.tag_merged' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM expertise_tags t WHERE lower(t.label) = lower(clean_label) AND t.id <> tag_uuid) THEN
      RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505', DETAIL = 'another tag has this label; merge them instead';
    END IF;
    previous := tag.label;
    IF previous = clean_label THEN
      RETURN;
    END IF;
    UPDATE expertise_tags t SET label = clean_label WHERE t.id = tag_uuid;
  ELSIF kind = 'discipline' THEN
    SELECT d.label INTO previous FROM disciplines d WHERE d.id = admin_rename_vocabulary.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END IF;
    IF previous = clean_label THEN
      RETURN;
    END IF;
    UPDATE disciplines d SET label = clean_label WHERE d.id = admin_rename_vocabulary.id;
  ELSE
    SELECT t.label INTO previous FROM mentorship_topics t WHERE t.id = admin_rename_vocabulary.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END IF;
    IF previous = clean_label THEN
      RETURN;
    END IF;
    UPDATE mentorship_topics t SET label = clean_label WHERE t.id = admin_rename_vocabulary.id;
  END IF;

  PERFORM write_audit(
    'vocabulary.renamed',
    CASE WHEN kind = 'tag' THEN 'expertise_tag' ELSE kind END,
    tag_uuid,
    jsonb_build_object('kind', kind, 'id', admin_rename_vocabulary.id, 'from', previous, 'to', clean_label)
  );
END
$$;

-- From 0017.
CREATE OR REPLACE FUNCTION admin_retire_topic(id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  topic mentorship_topics%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- A network-wide change: an administrator for every region only.
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO topic FROM mentorship_topics t WHERE t.id = admin_retire_topic.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF NOT topic.active THEN
    RETURN false;
  END IF;
  UPDATE mentorship_topics t SET active = false WHERE t.id = topic.id;
  PERFORM write_audit('vocabulary.retired', 'topic', NULL,
    jsonb_build_object('kind', 'topic', 'id', topic.id, 'label', topic.label));
  RETURN true;
END
$$;

-- From 0017.
CREATE OR REPLACE FUNCTION admin_review_tag(tag_id uuid, decision tag_status) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tag expertise_tags%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- A network-wide change: an administrator for every region only.
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  IF decision IS NULL OR decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'mest.invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tag FROM expertise_tags t WHERE t.id = tag_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF tag.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'mest.tag_merged' USING ERRCODE = '23514';
  END IF;
  UPDATE expertise_tags t SET status = decision WHERE t.id = tag_id;
  IF decision = 'rejected' THEN
    DELETE FROM profile_expertise pe WHERE pe.tag_id = admin_review_tag.tag_id;
  END IF;
  PERFORM write_audit('tag.' || decision::text, 'expertise_tag', tag_id, jsonb_build_object('label', tag.label));
END
$$;

-- 2. Region-scoped reads ------------------------------------------------------------------

-- From 0002 (profiles; is_admin_for(region) is admin_covers_profile(id)
-- without the lookup, the same test as profiles_admin_update in 0020), 0004
-- (student_details, profile_reviews) and 0005 (mentorship_relationships).
DROP POLICY profiles_admin_read ON profiles;
CREATE POLICY profiles_admin_read ON profiles FOR SELECT TO app_user USING (is_admin_for(region));
DROP POLICY student_details_admin_read ON student_details;
CREATE POLICY student_details_admin_read ON student_details FOR SELECT TO app_user
  USING (admin_covers_profile(profile_id));
DROP POLICY profile_reviews_admin_read ON profile_reviews;
CREATE POLICY profile_reviews_admin_read ON profile_reviews FOR SELECT TO app_user
  USING (admin_covers_profile(profile_id));
DROP POLICY mentorship_relationships_admin_read ON mentorship_relationships;
CREATE POLICY mentorship_relationships_admin_read ON mentorship_relationships FOR SELECT TO app_user
  USING (admin_covers_profile(mentee_id) OR admin_covers_profile(mentor_id));

-- From 0007: only reports on a profile in the caller's regions.
CREATE OR REPLACE VIEW admin_reports WITH (security_barrier = true) AS
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
WHERE is_admin() AND r.profile_id <> app_uid() AND admin_covers_profile(r.profile_id);

-- From 0007: only requests with a party in the caller's regions, and the
-- free text only when an open member's report is on a party the caller
-- covers (a report the caller can read and decide). `under_report` says the
-- same, so it never points at a report the caller cannot see.
CREATE OR REPLACE VIEW admin_requests WITH (security_barrier = true) AS
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
       AND admin_covers_profile(rep.profile_id)
       -- Only a member's report opens the text; an administrator cannot
       -- open it by filing one.
       AND NOT EXISTS (
         SELECT 1 FROM admin_roles a WHERE a.profile_id = rep.reporter_id AND a.revoked_at IS NULL
       )
  ) AS under_report
) flag
WHERE is_admin() AND (admin_covers_profile(r.mentee_id) OR admin_covers_profile(r.mentor_id));

-- The administrators list: every active role with its holder's and
-- granter's names and the scope, for administrators only. Runs as the view
-- owner, so a chapter administrator still sees who acts for every region
-- although it can no longer read their profiles. Names and scope only.
CREATE VIEW admin_roster WITH (security_barrier = true) AS
SELECT
  a.profile_id,
  p.first_name,
  p.last_name,
  a.granted_at,
  nullif(btrim(coalesce(g.first_name, '') || ' ' || coalesce(g.last_name, '')), '') AS granted_by_name,
  a.region_id,
  reg.label AS region_label
FROM admin_roles a
JOIN profiles p ON p.id = a.profile_id
LEFT JOIN profiles g ON g.id = a.granted_by
LEFT JOIN regions reg ON reg.id = a.region_id
WHERE a.revoked_at IS NULL AND is_admin();

-- Read-only for requests (the default privileges also granted writes).
REVOKE ALL ON admin_roster FROM app_user;
GRANT SELECT ON admin_roster TO app_user;

-- 3. Notifications about a profile ---------------------------------------------------------

-- From 0004, with an optional subject: when the notification is about a
-- profile, only the administrators who cover its region get it (a profile
-- that does not exist is covered by administrators for every region only,
-- as admin_covers_profile answers). The signature changes, so the old one
-- goes first; open_profile_review is its only caller.
DROP FUNCTION notify_admins(notification_category, text, text, text, text, jsonb, boolean);

CREATE FUNCTION notify_admins(
  category notification_category, title text, body text, link text, template text, payload jsonb, email boolean,
  subject_profile uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  admin_id uuid;
  subject_region text := (SELECT p.region FROM profiles p WHERE p.id = notify_admins.subject_profile);
BEGIN
  FOR admin_id IN
    SELECT a.profile_id
      FROM admin_roles a JOIN users u ON u.id = a.profile_id
     WHERE a.revoked_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
       AND (notify_admins.subject_profile IS NULL OR a.region_id IS NULL OR a.region_id = subject_region)
     ORDER BY a.profile_id
  LOOP
    PERFORM create_notification(admin_id, category, title, body, link, template, payload, email);
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION notify_admins(notification_category, text, text, text, text, jsonb, boolean, uuid)
  FROM PUBLIC, app_user;

-- From 0004: the notice is about the submitted profile.
CREATE OR REPLACE FUNCTION open_profile_review(profile uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  queue_was_empty boolean;
  new_id uuid;
BEGIN
  -- Serialize submissions so two at once cannot both find the queue empty.
  PERFORM pg_advisory_xact_lock(hashtext('profile_reviews.queue'));
  SELECT NOT EXISTS (SELECT 1 FROM profile_reviews r WHERE r.decision IS NULL) INTO queue_was_empty;
  SELECT r.id INTO new_id FROM profile_reviews r WHERE r.profile_id = profile AND r.decision IS NULL;
  IF new_id IS NULL THEN
    INSERT INTO profile_reviews (profile_id, snapshot) VALUES (profile, profile_snapshot(profile))
    RETURNING id INTO new_id;
  ELSE
    UPDATE profile_reviews r SET snapshot = profile_snapshot(profile), submitted_at = now() WHERE r.id = new_id;
  END IF;
  IF queue_was_empty THEN
    PERFORM notify_admins(
      'profile',
      'A profile is waiting for review',
      'A new professional profile was submitted to the directory.',
      '/network/admin/queue',
      'profile-submitted',
      '{}'::jsonb,
      true,
      profile
    );
  END IF;
  RETURN new_id;
END
$$;

-- From 0007: "report received" reaches only the administrators who cover
-- the reported profile (and still never the one reported).
CREATE OR REPLACE FUNCTION report_profile(profile_id uuid, reason report_reason, detail text) RETURNS uuid
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

  -- Every active administrator who covers the reported profile's region,
  -- except the one reported, who is told nothing.
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
    others_open = 0,
    -- Tied to the report, so the deletion sweep can find these notices.
    'report',
    new_id
  )
    FROM admin_roles a JOIN users u ON u.id = a.profile_id
   WHERE a.revoked_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
     AND a.profile_id <> target
     AND (a.region_id IS NULL OR a.region_id = (SELECT p.region FROM profiles p WHERE p.id = target));
  PERFORM write_audit('report.filed', 'report', new_id,
    jsonb_build_object('profile', target, 'reason', report_profile.reason));
  RETURN new_id;
END
$$;
