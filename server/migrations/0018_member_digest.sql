-- The opt-in member weekly digest (07-build-plan-phases-2-4.md, Task 35;
-- 01 NOT-6). A member who turns `email_member_digest` on (off by default)
-- gets at most one digest a week, and only when something is new since the
-- last one:
--   * professionals: professionals newly listed in the directory in their
--     own discipline;
--   * students: mentors who started taking requests for the topics they
--     chose (`student_details.topics_needed`).
-- Names and titles only: no contact value, no request text, no organization.
--
-- What this adds:
--   * notification category `member_digest`, and create_notification
--     re-created (copied from 0003) to read its switch;
--   * notification_preferences.email_member_digest (the owner's switch) and
--     member_digest_sent_at (the job's weekly stamp, which the owner cannot
--     write);
--   * mentorship_settings.active_since, kept by a trigger, so "started
--     taking requests" is a fact rather than a guess from updated_at;
--   * member_digest(as_of), called daily by the `member-digest` job;
--   * a trigger that drops a departing member from other members' stored
--     digests and their emails when the deletion sweep anonymizes them.
--
-- Deletion: the sweep (execute_account_deletion, last re-created in 0016)
-- already deletes the member's notification_preferences row (switch and
-- stamp), their notifications and their outbox rows, and resets their
-- mentorship_settings. The one new place a member's name lands, another
-- member's digest, is handled by the profiles trigger below, which fires
-- inside the sweep's tombstone UPDATE; so this file does not re-create
-- execute_account_deletion, and a later migration that does need not copy
-- anything from here.

ALTER TYPE notification_category ADD VALUE IF NOT EXISTS 'member_digest';

-- Preferences ---------------------------------------------------------------------

ALTER TABLE notification_preferences
  ADD COLUMN email_member_digest boolean NOT NULL DEFAULT false,
  -- When the last digest went out; null until the first one.
  ADD COLUMN member_digest_sent_at timestamptz;

-- The owner flips the switch; the stamp is the job's alone. SELECT is
-- already granted on the whole table (0003), so the owner reads both.
GRANT UPDATE (email_member_digest) ON notification_preferences TO app_user;

-- When a mentor's offer last became active --------------------------------------------

-- Null while the offer is off or paused. Rows already active when this
-- migration ran keep null, which reads as "active since before the digest
-- existed": never news by activation (they can still be news by approval).
ALTER TABLE mentorship_settings ADD COLUMN active_since timestamptz;

-- No grant to app_user: a mentor cannot make their own offer look new.
-- The column is readable by nobody but the owner role and definer functions.

CREATE FUNCTION mentorship_settings_track_active_since() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    NEW.active_since := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.active_since := coalesce(NEW.active_since, now());
  ELSIF OLD.status IS DISTINCT FROM 'active' THEN
    NEW.active_since := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER mentorship_settings_track_active_since BEFORE INSERT OR UPDATE ON mentorship_settings
  FOR EACH ROW EXECUTE FUNCTION mentorship_settings_track_active_since();

-- create_notification (copied from 0003, plus the member_digest switch) ----------------

-- Inserts the in-app notification and, when `email` is true, queues the
-- email if the category is `account` (always sent) or the recipient's
-- preference column for that category is on. A recipient with no
-- preference row yet has the column defaults: on for every category except
-- `member_digest`, which is opt-in.
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

  -- A deleted account (tombstone, email null) gets the in-app row only.
  SELECT u.email INTO address
    FROM users u
   WHERE u.id = create_notification.recipient AND u.deleted_at IS NULL;
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

-- Helpers --------------------------------------------------------------------------

-- When a professional first entered the directory: their first approval,
-- or the profile's creation for one approved without a review (the seed,
-- an administrator's direct fix). A re-approval after an edit is not news.
CREATE FUNCTION professional_listed_since(target uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT min(r.decided_at) FROM profile_reviews r WHERE r.profile_id = $1 AND r.decision = 'approved'),
    (SELECT p.created_at FROM profiles p WHERE p.id = $1)
  )
$$;

-- How many people a digest names per list; the rest are counted.
CREATE FUNCTION member_digest_list_size() RETURNS int
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$ SELECT 10 $$;

-- A digest payload without one person: the lists drop the entry with that
-- id; a list left empty goes, with its count and label.
CREATE FUNCTION member_digest_without(payload jsonb, person uuid) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb := coalesce(payload, '{}'::jsonb);
  list text;
  kept jsonb;
BEGIN
  FOREACH list IN ARRAY ARRAY['professionals', 'mentors'] LOOP
    IF jsonb_typeof(result -> list) = 'array' THEN
      SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality), '[]'::jsonb) INTO kept
        FROM jsonb_array_elements(result -> list) WITH ORDINALITY AS e
       WHERE e.value ->> 'id' IS DISTINCT FROM person::text;
      IF jsonb_array_length(kept) = 0 THEN
        result := result - list - (list || 'More');
        IF list = 'professionals' THEN
          result := result - 'disciplineLabel';
        END IF;
      ELSE
        result := jsonb_set(result, ARRAY[list], kept);
      END IF;
    END IF;
  END LOOP;
  RETURN result;
END
$$;

-- member_digest(as_of) ------------------------------------------------------------------

CREATE FUNCTION member_digest(as_of timestamptz DEFAULT now()) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  at timestamptz := coalesce(as_of, now());
  cap int := member_digest_list_size();
  paused boolean;
  m record;
  since timestamptz;
  pros jsonb;
  pro_total int;
  mentors jsonb;
  mentor_total int;
  label text;
  payload jsonb;
  body text;
  sent int := 0;
BEGIN
  -- System context only (the job, through withSystem); app_user has no
  -- EXECUTE either.
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;

  -- A paused network takes no requests, so nobody is "taking requests".
  SELECT coalesce(c.value = 'true'::jsonb, false) INTO paused FROM config c WHERE c.key = 'platform_paused';
  paused := coalesce(paused, false);

  -- Members who opted in, are in good standing, have onboarded and had no
  -- digest in the last seven days. The row lock (skipping a row another run
  -- holds) keeps two runs from sending one member two digests.
  FOR m IN
    SELECT np.profile_id, np.member_digest_sent_at, p.first_name,
           CASE WHEN p.kind = 'professional' THEN pd.discipline_id END AS discipline_id,
           CASE WHEN p.kind = 'student' THEN sd.topics_needed END AS topics
      FROM notification_preferences np
      JOIN profiles p ON p.id = np.profile_id
      LEFT JOIN professional_details pd ON pd.profile_id = p.id
      LEFT JOIN student_details sd ON sd.profile_id = p.id
     WHERE np.email_member_digest
       AND p.kind IS NOT NULL
       AND member_in_good_standing(p.id)
       AND (np.member_digest_sent_at IS NULL OR np.member_digest_sent_at <= at - interval '7 days')
     ORDER BY np.profile_id
       FOR UPDATE OF np SKIP LOCKED
  LOOP
    -- New since the last digest; a first digest looks back one week.
    since := coalesce(m.member_digest_sent_at, at - interval '7 days');
    pros := '[]'::jsonb;
    pro_total := 0;
    mentors := '[]'::jsonb;
    mentor_total := 0;
    label := NULL;

    IF m.discipline_id IS NOT NULL THEN
      SELECT count(*)::int,
             coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'title', x.title)
                                ORDER BY x.listed DESC, x.name, x.id) FILTER (WHERE x.n <= cap), '[]'::jsonb)
        INTO pro_total, pros
        FROM (
          SELECT c.*, row_number() OVER (ORDER BY c.listed DESC, c.name, c.id) AS n
            FROM (
              SELECT p.id, btrim(concat_ws(' ', p.first_name, p.last_name)) AS name, d.title,
                     professional_listed_since(p.id) AS listed
                FROM professional_details d
                JOIN profiles p ON p.id = d.profile_id
               WHERE d.discipline_id = m.discipline_id
                 AND p.id <> m.profile_id
                 -- Listed for members and in good standing: what the reader
                 -- could open in the directory right now.
                 AND mentor_listed(p.id)
            ) c
           WHERE c.listed > since AND c.listed <= at
        ) x;
      SELECT dl.label INTO label FROM disciplines dl WHERE dl.id = m.discipline_id;
    END IF;

    IF m.topics IS NOT NULL AND NOT paused THEN
      SELECT count(*)::int,
             coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'title', x.title)
                                ORDER BY x.since_ DESC, x.name, x.id) FILTER (WHERE x.n <= cap), '[]'::jsonb)
        INTO mentor_total, mentors
        FROM (
          SELECT c.*, row_number() OVER (ORDER BY c.since_ DESC, c.name, c.id) AS n
            FROM (
              -- Taking requests since the later of entering the directory
              -- and switching the offer on (a resumed offer is news again).
              SELECT p.id, btrim(concat_ws(' ', p.first_name, p.last_name)) AS name, d.title,
                     greatest(professional_listed_since(p.id), coalesce(s.active_since, '-infinity'::timestamptz)) AS since_
                FROM mentorship_settings s
                JOIN profiles p ON p.id = s.profile_id
                JOIN professional_details d ON d.profile_id = p.id
               WHERE s.status = 'active'
                 AND 'mentoring' = ANY (d.participation)
                 AND s.max_active > mentor_active_count(p.id)
                 AND p.id <> m.profile_id
                 AND EXISTS (
                   SELECT 1 FROM mentor_topics mt WHERE mt.profile_id = p.id AND mt.topic_id = ANY (m.topics)
                 )
                 AND mentor_listed(p.id)
            ) c
           WHERE c.since_ > since AND c.since_ <= at
        ) x;
    END IF;

    IF pro_total + mentor_total = 0 THEN
      CONTINUE;
    END IF;

    -- Names and titles only. Empty sections are left out.
    payload := jsonb_build_object('link', '/network/directory');
    IF nullif(btrim(m.first_name), '') IS NOT NULL THEN
      payload := payload || jsonb_build_object('firstName', btrim(m.first_name));
    END IF;
    IF pro_total > 0 THEN
      payload := payload || jsonb_build_object('professionals', pros);
      IF label IS NOT NULL THEN
        payload := payload || jsonb_build_object('disciplineLabel', label);
      END IF;
      IF pro_total > jsonb_array_length(pros) THEN
        payload := payload || jsonb_build_object('professionalsMore', pro_total - jsonb_array_length(pros));
      END IF;
    END IF;
    IF mentor_total > 0 THEN
      payload := payload || jsonb_build_object('mentors', mentors);
      IF mentor_total > jsonb_array_length(mentors) THEN
        payload := payload || jsonb_build_object('mentorsMore', mentor_total - jsonb_array_length(mentors));
      END IF;
    END IF;

    -- The in-app row carries counts; the names are in the email and the
    -- directory.
    body := concat_ws(' ',
      CASE WHEN pro_total > 0 THEN
        'New in ' || coalesce(label, 'your discipline') || ': ' || pro_total
        || CASE WHEN pro_total = 1 THEN ' professional.' ELSE ' professionals.' END
      END,
      CASE WHEN mentor_total > 0 THEN
        'Taking requests for your topics: ' || mentor_total
        || CASE WHEN mentor_total = 1 THEN ' mentor.' ELSE ' mentors.' END
      END);

    PERFORM create_notification(
      m.profile_id, 'member_digest',
      'Your weekly MEST Network digest',
      body,
      '/network/directory',
      'member-digest',
      payload,
      true
    );
    UPDATE notification_preferences np SET member_digest_sent_at = at WHERE np.profile_id = m.profile_id;
    sent := sent + 1;
  END LOOP;

  RETURN sent;
END
$$;

-- A departing member leaves other members' digests ------------------------------------

-- The deletion sweep's tombstone UPDATE sets anonymized_at; at that moment
-- every stored digest naming the member (notification payloads, and the
-- outbox rows rendered from them, sent or not) drops them. Only the table
-- owner can set anonymized_at (profiles_guard_protected_columns).
CREATE FUNCTION profiles_leave_member_digests() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  person jsonb := jsonb_build_array(jsonb_build_object('id', NEW.id::text));
BEGIN
  WITH touched AS (
    UPDATE notifications n
       SET payload = member_digest_without(n.payload, NEW.id)
     WHERE n.template = 'member-digest'
       AND n.recipient_id <> NEW.id
       AND (n.payload -> 'professionals' @> person OR n.payload -> 'mentors' @> person)
    RETURNING n.id
  )
  UPDATE email_outbox o
     SET payload = member_digest_without(o.payload, NEW.id)
   WHERE o.template = 'member-digest'
     AND (o.notification_id IN (SELECT t.id FROM touched t)
          OR o.payload -> 'professionals' @> person OR o.payload -> 'mentors' @> person);
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_leave_member_digests AFTER UPDATE OF anonymized_at ON profiles
  FOR EACH ROW WHEN (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
  EXECUTE FUNCTION profiles_leave_member_digests();

-- Privileges ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION member_digest(timestamptz) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION professional_listed_since(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION member_digest_without(jsonb, uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION member_digest_list_size() FROM PUBLIC, app_user;
