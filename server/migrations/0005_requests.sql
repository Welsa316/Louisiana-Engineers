-- Mentorship requests, introductions and relationships, the counterparty
-- rule, and the functions that move a request through its life
-- (02-technical-architecture.md sections 4.3 to 4.6, 5.2 to 5.4).
--
-- A request is created, answered, canceled, completed, reminded, expired and
-- purged only by the SECURITY DEFINER functions below; app_user can read the
-- rows it is a party to and write nothing. Accepting creates the
-- relationship and records which contact methods the mentor hands over;
-- those values still leave the database only through release_contact and
-- get_request_handoff.
--
-- Lock order, so concurrent calls cannot deadlock: a creation takes the
-- mentee's advisory lock, then the mentor's mentorship_settings row; an
-- answer takes the request row, then the mentor's settings row. Capacity,
-- the pending cap and the daily limit are counted only while holding those
-- locks, so two concurrent creations or accepts cannot both pass.

CREATE TYPE request_kind AS ENUM ('mentorship', 'introduction');
CREATE TYPE request_status AS ENUM ('pending', 'accepted', 'declined', 'completed', 'canceled', 'expired');

-- mentorship_requests -------------------------------------------------------------

CREATE TABLE mentorship_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentee_id uuid NOT NULL REFERENCES profiles (id),
  mentor_id uuid NOT NULL REFERENCES profiles (id),
  kind request_kind NOT NULL DEFAULT 'mentorship',
  topic_id text REFERENCES mentorship_topics (id),
  -- Emptied (to '') by purge_request_text and the deletion sweep, which set
  -- text_purged_at; until then the limits from shared/limits.ts apply.
  why text NOT NULL,
  goals text CHECK (char_length(goals) <= 400),
  format mentoring_format NOT NULL CHECK (format IN ('one-time', 'recurring')),
  mode meeting_mode NOT NULL,
  scheduling_note text CHECK (char_length(scheduling_note) <= 200),
  status request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  mentor_note text CHECK (char_length(mentor_note) <= 600),
  decline_reason text CHECK (
    decline_reason IN ('not_fit', 'no_capacity', 'outside_experience', 'other', 'member_left', '')
  ),
  reminders_sent int NOT NULL DEFAULT 0 CHECK (reminders_sent BETWEEN 0 AND 2),
  text_purged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentorship_requests_not_self CHECK (mentee_id <> mentor_id),
  CONSTRAINT mentorship_requests_why_length CHECK (
    char_length(why) BETWEEN 30 AND 800 OR (why = '' AND text_purged_at IS NOT NULL)
  ),
  -- A mentorship request names a topic; an introduction has none and is one-time.
  CONSTRAINT mentorship_requests_kind_shape CHECK (
    (kind = 'mentorship' AND topic_id IS NOT NULL)
    OR (kind = 'introduction' AND topic_id IS NULL AND format = 'one-time')
  ),
  CONSTRAINT mentorship_requests_declined_has_reason CHECK (
    status <> 'declined' OR decline_reason IS NOT NULL
  ),
  CONSTRAINT mentorship_requests_responded_consistent CHECK (
    status IN ('pending', 'canceled', 'expired') OR responded_at IS NOT NULL
  )
);

-- One open pair at a time.
CREATE UNIQUE INDEX mentorship_requests_open_pair_idx ON mentorship_requests (mentee_id, mentor_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX mentorship_requests_mentee_idx ON mentorship_requests (mentee_id, created_at DESC);
CREATE INDEX mentorship_requests_mentor_idx ON mentorship_requests (mentor_id, created_at DESC);
-- What the expiry and reminder jobs scan.
CREATE INDEX mentorship_requests_pending_idx ON mentorship_requests (created_at) WHERE status = 'pending';

CREATE TRIGGER mentorship_requests_set_updated_at BEFORE UPDATE ON mentorship_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- mentorship_relationships --------------------------------------------------------

CREATE TABLE mentorship_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES mentorship_requests (id),
  mentee_id uuid NOT NULL REFERENCES profiles (id),
  mentor_id uuid NOT NULL REFERENCES profiles (id),
  topic_id text REFERENCES mentorship_topics (id),
  -- The subset of the mentor's methods handed to this mentee. The values
  -- live in contact_preferences and are resolved at release time.
  shared_methods contact_method[] NOT NULL DEFAULT '{}'
    CHECK (NOT ('mest' = ANY (shared_methods))),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid REFERENCES profiles (id),
  CONSTRAINT mentorship_relationships_completed_consistent CHECK ((completed_at IS NULL) = (completed_by IS NULL))
);
-- Active relationships count against the mentor's max_active.
CREATE INDEX mentorship_relationships_active_mentor_idx ON mentorship_relationships (mentor_id)
  WHERE completed_at IS NULL;
CREATE INDEX mentorship_relationships_mentee_idx ON mentorship_relationships (mentee_id);

-- Internal helpers (definer functions call these; app_user cannot) ---------------------

-- Whether an account is in good standing: what is_member() says about the
-- caller, asked about anyone. A suspended, deleted or deleting mentor takes
-- no requests.
CREATE FUNCTION member_in_good_standing(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM users u
      JOIN profiles p ON p.id = u.id
     WHERE u.id = $1
       AND u.email_verified_at IS NOT NULL
       AND u.suspended_at IS NULL
       AND u.deleted_at IS NULL
       AND p.anonymized_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM account_deletions d
          WHERE d.profile_id = u.id AND d.canceled_at IS NULL AND d.executed_at IS NULL
       )
  )
$$;

-- The listing rule alone, for a caller who is a member (`as_member`) or not:
-- `visible`, `members_only` or `none`. profile_access adds the owner, the
-- administrator and the counterparty on top; preview_my_access asks it
-- about the owner's own profile. One body, so the two cannot drift.
CREATE FUNCTION profile_listed_access(target uuid, as_member boolean) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM profiles pr WHERE pr.id = target;
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
    RETURN CASE WHEN coalesce(as_member, false) THEN 'visible' ELSE 'members_only' END;
  END IF;
  RETURN 'none';
END
$$;

-- Active mentorship relationships a mentor holds. Introductions are not
-- mentoring, so they never use up a slot.
CREATE FUNCTION mentor_active_count(mentor uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
    FROM mentorship_relationships rel
    JOIN mentorship_requests r ON r.id = rel.request_id
   WHERE rel.mentor_id = $1 AND rel.completed_at IS NULL AND r.kind = 'mentorship'
$$;

-- `wanted` methods of `target`'s contact preferences, each resolved to its
-- value: `email` to contact_email or the sign-in address, `linkedin` to the
-- profile link. A method the owner no longer uses, `mest`, or one without
-- a value is left out. The one resolution rule behind release_contact,
-- get_request_handoff and preview_my_contact.
CREATE FUNCTION contact_values(target uuid, wanted contact_method[]) RETURNS TABLE (method contact_method, value text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.method, r.value
    FROM (
      SELECT DISTINCT m AS method,
             CASE m
               WHEN 'email' THEN coalesce(c.contact_email::text, u.email::text)
               WHEN 'linkedin' THEN p.linkedin_url
               WHEN 'booking' THEN c.booking_url
               WHEN 'phone' THEN c.phone
             END AS value
        FROM contact_preferences c
        JOIN profiles p ON p.id = c.profile_id
        JOIN users u ON u.id = c.profile_id AND u.deleted_at IS NULL
        CROSS JOIN LATERAL unnest(coalesce($2, '{}'::contact_method[])) AS m
       WHERE c.profile_id = $1 AND m <> 'mest' AND m = ANY (c.methods)
    ) r
   WHERE r.value IS NOT NULL
   ORDER BY r.method
$$;

-- One `contact.viewed` entry per caller, profile and set of methods: a
-- second view of the same methods is not logged again, a view that adds a
-- method (a handoff after the member-visible ones) is. Names the methods,
-- never their values.
CREATE FUNCTION audit_contact_viewed(target uuid, released contact_method[], extra jsonb DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  methods jsonb;
BEGIN
  IF me IS NULL OR target IS NULL OR me = target OR released IS NULL OR cardinality(released) = 0 THEN
    RETURN;
  END IF;
  SELECT to_jsonb(array_agg(m ORDER BY m)) INTO methods FROM (SELECT DISTINCT unnest(released) AS m) x;
  PERFORM pg_advisory_xact_lock(hashtext('contact.viewed:' || me::text || ':' || target::text));
  IF NOT EXISTS (
    SELECT 1 FROM audit_log a
     WHERE a.action = 'contact.viewed' AND a.actor_id = me AND a.subject_id = target
       AND a.detail -> 'methods' @> methods
  ) THEN
    PERFORM write_audit('contact.viewed', 'profile', target, jsonb_build_object('methods', methods) || coalesce(extra, '{}'));
  END IF;
END
$$;

-- A display name for notification text and payloads.
CREATE FUNCTION profile_first_name(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(nullif(btrim(p.first_name), ''), 'A member') FROM profiles p WHERE p.id = $1
$$;

-- What a notification about a request may carry (section 4.3): names, the
-- topic label, the kind and dates. Never the request's free text.
CREATE FUNCTION request_payload(r mentorship_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'requestId', r.id,
    'kind', r.kind,
    'menteeFirstName', profile_first_name(r.mentee_id),
    'mentorFirstName', profile_first_name(r.mentor_id),
    'topicLabel', (SELECT t.label FROM mentorship_topics t WHERE t.id = r.topic_id),
    'createdOn', to_char(r.created_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD'),
    'expiresOn', to_char(r.expires_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD')
  )
$$;

-- "mentorship request" or "introduction request", for notification text.
CREATE FUNCTION request_noun(kind request_kind) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE $1 WHEN 'introduction' THEN 'introduction request' ELSE 'mentorship request' END
$$;

-- The counterparty rule (section 5.2) -----------------------------------------------------

-- True when a pending or accepted request, or an active relationship, links
-- the caller and `profile_id` in either direction. This is how a mentor
-- sees the student who asked them, and how either party keeps seeing the
-- other while the request is open, whatever the profile's visibility.
CREATE FUNCTION is_counterparty(profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_uid() IS NOT NULL AND $1 IS NOT NULL AND $1 <> app_uid() AND (
    EXISTS (
      SELECT 1 FROM mentorship_requests r
       WHERE r.status IN ('pending', 'accepted')
         AND ((r.mentee_id = app_uid() AND r.mentor_id = $1) OR (r.mentor_id = app_uid() AND r.mentee_id = $1))
    )
    OR EXISTS (
      SELECT 1 FROM mentorship_relationships rel
       WHERE rel.completed_at IS NULL
         AND ((rel.mentee_id = app_uid() AND rel.mentor_id = $1) OR (rel.mentor_id = app_uid() AND rel.mentee_id = $1))
    )
  )
$$;

-- Re-created with the counterparty case (replaces 0002 and 0004_self_reads) -------

CREATE OR REPLACE FUNCTION profile_access(id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_access.id) THEN
    RETURN 'none';
  END IF;
  IF profile_access.id = app_uid() OR is_admin() THEN
    RETURN 'visible';
  END IF;
  -- A member in good standing keeps seeing the other party of an open request.
  IF is_member() AND is_counterparty(profile_access.id) THEN
    RETURN 'visible';
  END IF;
  RETURN profile_listed_access(profile_access.id, is_member());
END
$$;

-- What profile_access would answer about the caller's own profile for a
-- visitor, or for a member who is neither the owner, an administrator nor a
-- counterparty: exactly the listing rule profile_access ends with.
CREATE OR REPLACE FUNCTION preview_my_access(viewer text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF viewer IS NULL OR viewer NOT IN ('visitor', 'member') THEN
    RAISE EXCEPTION 'mest.invalid_viewer' USING ERRCODE = '22023';
  END IF;
  IF app_uid() IS NULL THEN
    RETURN 'none';
  END IF;
  RETURN profile_listed_access(app_uid(), viewer = 'member');
END
$$;

-- The single path by which a contact value leaves the database for another
-- member: `share_with_members` when a member could see the profile in the
-- directory, plus the `shared_methods` of an accepted relationship in which
-- the caller is the mentee and `profile_id` the mentor. Administrators get
-- nothing a member could not (02 section 5.4).
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

  SELECT array_agg(DISTINCT m) INTO handed
    FROM mentorship_relationships rel
    JOIN mentorship_requests r ON r.id = rel.request_id
    CROSS JOIN LATERAL unnest(rel.shared_methods) AS m
   WHERE rel.mentee_id = me AND rel.mentor_id = target
     AND rel.completed_at IS NULL AND r.status = 'accepted';

  wanted := coalesce(wanted, '{}') || coalesce(handed, '{}');
  IF cardinality(wanted) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v.method, v.value FROM contact_values(target, wanted) AS v;

  SELECT array_agg(v.method ORDER BY v.method) INTO released FROM contact_values(target, wanted) AS v;
  PERFORM audit_contact_viewed(target, released);
END
$$;

-- What release_contact would hand a member (with no relationship) for the
-- caller's own profile, without the audit entry. Empty unless a member
-- could see the profile.
CREATE OR REPLACE FUNCTION preview_my_contact() RETURNS TABLE (method contact_method, value text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.method, v.value
    FROM contact_preferences c
    CROSS JOIN LATERAL contact_values(c.profile_id, c.share_with_members) AS v
   WHERE c.profile_id = app_uid() AND app_uid() IS NOT NULL AND preview_my_access('member') = 'visible'
   ORDER BY v.method
$$;

-- Whether a mentor can take another mentee: mentoring is active, the
-- account is in good standing and the active mentorship relationships are
-- below max_active (replaces 0004's stub). Only for a profile the caller
-- may see; max_active itself stays the owner's.
CREATE OR REPLACE FUNCTION mentor_has_capacity(profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile_access($1) = 'visible' AND member_in_good_standing($1) AND EXISTS (
    SELECT 1 FROM mentorship_settings s
     WHERE s.profile_id = $1 AND s.status = 'active' AND s.max_active > mentor_active_count($1)
  )
$$;

-- Whether a professional takes requests at all: listed in the directory
-- for members and in good standing. Creation checks it; the availability
-- answer starts from it.
CREATE FUNCTION mentor_listed(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile_listed_access($1, true) = 'visible' AND member_in_good_standing($1)
$$;

-- Requests ------------------------------------------------------------------------------

-- A member asks a mentor for mentorship on one of their topics, or a
-- networking professional for an introduction. The checks run in the
-- order of section 4.5 and raise the first that fails.
CREATE FUNCTION create_mentorship_request(
  mentor uuid,
  kind request_kind,
  topic text,
  why text,
  goals text,
  format mentoring_format,
  mode meeting_mode,
  scheduling_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  settings mentorship_settings%ROWTYPE;
  cfg_paused boolean;
  cfg_pending_cap int;
  cfg_daily int;
  cfg_expiry int;
  new_request mentorship_requests%ROWTYPE;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = me AND p.kind IS NOT NULL) THEN
    RAISE EXCEPTION 'mest.not_onboarded' USING ERRCODE = '23514';
  END IF;
  IF mentor IS NULL OR kind IS NULL OR format IS NULL OR mode IS NULL OR mentor = me
     OR format NOT IN ('one-time', 'recurring')
     OR (kind = 'mentorship' AND topic IS NULL)
     OR (kind = 'introduction' AND (topic IS NOT NULL OR format <> 'one-time'))
     OR why IS NULL OR char_length(btrim(why)) NOT BETWEEN 30 AND 800
     OR char_length(btrim(coalesce(goals, ''))) > 400
     OR char_length(btrim(coalesce(scheduling_note, ''))) > 200 THEN
    RAISE EXCEPTION 'mest.invalid_request' USING ERRCODE = '22023';
  END IF;

  -- The mentee's own counts (pending cap, daily limit) are serialized by
  -- this lock; the mentor's capacity by the settings row below.
  PERFORM pg_advisory_xact_lock(hashtext('requests.mentee:' || me::text));

  SELECT (c.value = 'true'::jsonb) INTO cfg_paused FROM config c WHERE c.key = 'platform_paused';
  IF coalesce(cfg_paused, false) THEN
    RAISE EXCEPTION 'mest.platform_paused' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO settings FROM mentorship_settings s WHERE s.profile_id = mentor FOR UPDATE;
  IF NOT FOUND OR NOT mentor_listed(mentor) OR profile_access(mentor) <> 'visible' THEN
    RAISE EXCEPTION 'mest.mentor_unavailable' USING ERRCODE = '23514';
  END IF;

  IF kind = 'mentorship' THEN
    IF settings.status <> 'active' THEN
      RAISE EXCEPTION 'mest.mentor_unavailable' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mentor_topics mt WHERE mt.profile_id = mentor AND mt.topic_id = topic) THEN
      RAISE EXCEPTION 'mest.topic_not_offered' USING ERRCODE = '23514';
    END IF;
    IF mentor_active_count(mentor) >= settings.max_active THEN
      RAISE EXCEPTION 'mest.mentor_full' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM professional_details d WHERE d.profile_id = mentor AND 'networking' = ANY (d.participation)
    ) THEN
      RAISE EXCEPTION 'mest.mentor_unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT c.value::int INTO cfg_pending_cap FROM config c WHERE c.key = 'pending_cap';
  IF (SELECT count(*) FROM mentorship_requests r WHERE r.mentee_id = me AND r.status = 'pending')
     >= coalesce(cfg_pending_cap, 3) THEN
    RAISE EXCEPTION 'mest.pending_cap' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM mentorship_requests r
     WHERE r.mentee_id = me AND r.mentor_id = mentor AND r.status IN ('pending', 'accepted')
  ) THEN
    RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505';
  END IF;

  SELECT c.value::int INTO cfg_daily FROM config c WHERE c.key = 'daily_request_limit';
  IF (SELECT count(*) FROM mentorship_requests r WHERE r.mentee_id = me AND r.created_at > now() - interval '1 day')
     >= coalesce(cfg_daily, 5) THEN
    RAISE EXCEPTION 'mest.rate_limited' USING ERRCODE = '23514';
  END IF;

  SELECT c.value::int INTO cfg_expiry FROM config c WHERE c.key = 'request_expiry_days';

  INSERT INTO mentorship_requests (
    mentee_id, mentor_id, kind, topic_id, why, goals, format, mode, scheduling_note, expires_at
  ) VALUES (
    me, mentor, kind, CASE WHEN kind = 'mentorship' THEN topic END,
    btrim(why), nullif(btrim(coalesce(goals, '')), ''), format, mode,
    nullif(btrim(coalesce(scheduling_note, '')), ''),
    now() + make_interval(days => coalesce(cfg_expiry, 14))
  )
  RETURNING * INTO new_request;

  PERFORM create_notification(
    mentor, 'request',
    'New ' || request_noun(kind) || ' from ' || profile_first_name(me),
    profile_first_name(me) || ' sent you a ' || request_noun(kind) || '. It expires in '
      || coalesce(cfg_expiry, 14) || ' days if there is no reply.',
    '/network/mentor/requests/' || new_request.id,
    'request-received',
    request_payload(new_request) || jsonb_build_object('link', '/network/mentor/requests/' || new_request.id),
    true,
    'mentorship_request', new_request.id
  );
  PERFORM write_audit('request.created', 'mentorship_request', new_request.id,
    jsonb_build_object('kind', kind, 'mentor', mentor, 'topic', new_request.topic_id));
  RETURN new_request.id;
END
$$;

-- The mentee withdraws a pending request; the mentor hears about it in the app only.
CREATE FUNCTION cancel_request(request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  r mentorship_requests%ROWTYPE;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM mentorship_requests mr WHERE mr.id = cancel_request.request_id FOR UPDATE;
  IF NOT FOUND OR me NOT IN (r.mentee_id, r.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF r.mentee_id <> me THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'mest.not_pending' USING ERRCODE = '23514';
  END IF;

  UPDATE mentorship_requests mr SET status = 'canceled' WHERE mr.id = r.id;
  PERFORM create_notification(
    r.mentor_id, 'request',
    profile_first_name(me) || ' canceled a ' || request_noun(r.kind),
    profile_first_name(me) || ' withdrew their ' || request_noun(r.kind) || '. There is nothing for you to do.',
    '/network/mentor/requests/' || r.id,
    'default', request_payload(r), false,
    'mentorship_request', r.id
  );
  PERFORM write_audit('request.canceled', 'mentorship_request', r.id, '{}'::jsonb);
END
$$;

-- The mentor accepts (sharing some contact methods for this relationship)
-- or declines (with a reason) a pending request.
CREATE FUNCTION respond_to_request(
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

  -- Accept. The handoff is a subset of the methods the mentor uses that
  -- have a value; `mest` is not a handoff.
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

-- Either party ends an active relationship; the other hears about it in
-- the app only.
CREATE FUNCTION complete_relationship(request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  r mentorship_requests%ROWTYPE;
  other uuid;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM mentorship_requests mr WHERE mr.id = complete_relationship.request_id FOR UPDATE;
  IF NOT FOUND OR me NOT IN (r.mentee_id, r.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF r.status <> 'accepted' THEN
    RAISE EXCEPTION 'mest.not_active' USING ERRCODE = '23514';
  END IF;

  UPDATE mentorship_relationships rel SET completed_at = now(), completed_by = me
   WHERE rel.request_id = r.id AND rel.completed_at IS NULL;
  UPDATE mentorship_requests mr SET status = 'completed' WHERE mr.id = r.id;

  other := CASE WHEN me = r.mentee_id THEN r.mentor_id ELSE r.mentee_id END;
  PERFORM create_notification(
    other, CASE WHEN other = r.mentee_id THEN 'response' ELSE 'request' END::notification_category,
    profile_first_name(me) || ' marked your ' || CASE r.kind WHEN 'introduction' THEN 'introduction' ELSE 'mentorship' END
      || ' as completed',
    'Thank you for taking part.',
    CASE WHEN other = r.mentee_id THEN '/network/me/requests/' ELSE '/network/mentor/requests/' END || r.id,
    'default', request_payload(r), false,
    'mentorship_request', r.id
  );
  PERFORM write_audit('request.completed', 'mentorship_request', r.id, '{}'::jsonb);
END
$$;

-- The contact methods the mentor handed to the mentee of an accepted
-- request, resolved to their values. Only the mentee gets them; each new
-- set of methods is logged once (contact.viewed).
CREATE FUNCTION get_request_handoff(request_id uuid) RETURNS TABLE (method contact_method, value text)
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
  SELECT rel.shared_methods INTO handed
    FROM mentorship_relationships rel
   WHERE rel.request_id = r.id AND rel.completed_at IS NULL;

  RETURN QUERY SELECT v.method, v.value FROM contact_values(r.mentor_id, handed) AS v;

  SELECT array_agg(v.method ORDER BY v.method) INTO released FROM contact_values(r.mentor_id, handed) AS v;
  PERFORM audit_contact_viewed(r.mentor_id, released, jsonb_build_object('request', r.id));
END
$$;

-- Lifecycle functions for the jobs (Task 21). System context only: app_user
-- has no EXECUTE, and each refuses a call with an acting user. Each moves a
-- row at most once and returns whether it did, so a job that runs twice, or
-- two instances during a deploy, cannot notify twice. `at` is the
-- scheduler's clock (`as_of`, which defaults to now()).

-- A pending request past its expiry becomes `expired`; the mentee is told.
CREATE FUNCTION expire_request(request_id uuid, as_of timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r mentorship_requests%ROWTYPE;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM mentorship_requests mr WHERE mr.id = expire_request.request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at > coalesce(as_of, now()) THEN
    RETURN false;
  END IF;
  UPDATE mentorship_requests mr SET status = 'expired' WHERE mr.id = r.id;
  PERFORM create_notification(
    r.mentee_id, 'response',
    'Your ' || request_noun(r.kind) || ' to ' || profile_first_name(r.mentor_id) || ' expired',
    'There was no reply in time. Mentors are volunteers and sometimes miss a request; you can ask someone else.',
    '/network/me/requests/' || r.id,
    'request-expired',
    request_payload(r) || jsonb_build_object('link', '/network/me/requests/' || r.id),
    true,
    'mentorship_request', r.id
  );
  PERFORM write_audit('request.expired', 'mentorship_request', r.id, '{}'::jsonb);
  RETURN true;
END
$$;

-- Reminder `n` to the mentor of a pending request, where `n` is the number
-- of reminders already sent (0 for the first, at config.reminder_days[1];
-- 1 for the second, at reminder_days[2]). Sends only when reminders_sent
-- is still `n` and the request is old enough, then counts it.
CREATE FUNCTION send_request_reminder(request_id uuid, n int, as_of timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r mentorship_requests%ROWTYPE;
  day_count int;
  days_left int;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT (c.value ->> n)::int INTO day_count FROM config c WHERE c.key = 'reminder_days';
  IF n IS NULL OR n < 0 OR day_count IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO r FROM mentorship_requests mr WHERE mr.id = send_request_reminder.request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.reminders_sent <> n
     OR r.created_at + make_interval(days => day_count) > coalesce(as_of, now())
     OR r.expires_at <= coalesce(as_of, now()) THEN
    RETURN false;
  END IF;
  UPDATE mentorship_requests mr SET reminders_sent = n + 1 WHERE mr.id = r.id;
  days_left := greatest(ceil(extract(epoch FROM (r.expires_at - coalesce(as_of, now()))) / 86400)::int, 0);
  PERFORM create_notification(
    r.mentor_id, 'reminder',
    profile_first_name(r.mentee_id) || '''s ' || request_noun(r.kind) || ' is waiting for your reply',
    'It expires in ' || days_left || CASE WHEN days_left = 1 THEN ' day.' ELSE ' days.' END,
    '/network/mentor/requests/' || r.id,
    'request-reminder',
    request_payload(r) || jsonb_build_object('daysLeft', days_left, 'reminder', n + 1,
                                             'link', '/network/mentor/requests/' || r.id),
    true,
    'mentorship_request', r.id
  );
  RETURN true;
END
$$;

-- A paused mentor whose resume date has come back takes requests again (or
-- goes off, if the offer is no longer complete).
CREATE FUNCTION resume_mentor(profile_id uuid, as_of date DEFAULT current_date) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s mentorship_settings%ROWTYPE;
  complete boolean;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM mentorship_settings ms WHERE ms.profile_id = resume_mentor.profile_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'paused' OR s.paused_until IS NULL OR s.paused_until > coalesce(as_of, current_date) THEN
    RETURN false;
  END IF;
  complete := cardinality(s.audience) > 0
    AND EXISTS (SELECT 1 FROM mentor_topics mt WHERE mt.profile_id = s.profile_id)
    AND EXISTS (SELECT 1 FROM professional_details d WHERE d.profile_id = s.profile_id AND 'mentoring' = ANY (d.participation));
  UPDATE mentorship_settings ms
     SET status = CASE WHEN complete THEN 'active'::mentor_status ELSE 'off'::mentor_status END,
         paused_until = NULL
   WHERE ms.profile_id = s.profile_id;
  PERFORM write_audit('mentorship.resumed', 'profile', s.profile_id,
    jsonb_build_object('status', CASE WHEN complete THEN 'active' ELSE 'off' END));
  RETURN true;
END
$$;

-- Retention (A9): the free text of expired and declined requests created
-- before `before` is emptied. Returns how many requests were purged.
CREATE FUNCTION purge_request_text(before timestamptz) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purged int;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF before IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE mentorship_requests r
     SET why = '', goals = NULL, scheduling_note = NULL, mentor_note = NULL, text_purged_at = now()
   WHERE r.status IN ('expired', 'declined') AND r.created_at < before AND r.text_purged_at IS NULL;
  GET DIAGNOSTICS purged = ROW_COUNT;
  IF purged > 0 THEN
    PERFORM write_audit('request.text_purged', 'mentorship_request', NULL,
      jsonb_build_object('count', purged, 'before', before));
  END IF;
  RETURN purged;
END
$$;

-- Availability ---------------------------------------------------------------------------

-- What a profile's request buttons should say, in this order: `off` (takes
-- no requests at all), `networking_only` (no mentoring, but open to an
-- introduction), `paused` (with the resume date), `full`, `taking`. No row
-- when the caller cannot see the profile.
CREATE FUNCTION mentor_availability(profile_id uuid) RETURNS TABLE (state text, resume_on date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  target uuid := mentor_availability.profile_id;
  s mentorship_settings%ROWTYPE;
  networking boolean;
BEGIN
  IF target IS NULL OR profile_access(target) <> 'visible' THEN
    RETURN;
  END IF;
  SELECT * INTO s FROM mentorship_settings ms WHERE ms.profile_id = target;
  networking := EXISTS (
    SELECT 1 FROM professional_details d WHERE d.profile_id = target AND 'networking' = ANY (d.participation)
  );
  IF NOT mentor_listed(target) OR ((s.profile_id IS NULL OR s.status = 'off') AND NOT networking) THEN
    RETURN QUERY SELECT 'off'::text, NULL::date;
  ELSIF s.profile_id IS NULL OR s.status = 'off' THEN
    RETURN QUERY SELECT 'networking_only'::text, NULL::date;
  ELSIF s.status = 'paused' THEN
    RETURN QUERY SELECT 'paused'::text, s.paused_until;
  ELSIF mentor_active_count(target) >= s.max_active THEN
    RETURN QUERY SELECT 'full'::text, NULL::date;
  ELSE
    RETURN QUERY SELECT 'taking'::text, NULL::date;
  END IF;
END
$$;

-- The caller's own mentorship numbers for the home screen and the mentor
-- dashboard: status and cap (null for anyone without a settings row),
-- active mentorships, and pending requests in each direction.
CREATE FUNCTION my_mentorship_summary()
RETURNS TABLE (status mentor_status, max_active int, active_count int, pending_incoming int, pending_outgoing int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.status, s.max_active,
         CASE WHEN app_uid() IS NULL THEN 0 ELSE mentor_active_count(app_uid()) END,
         (SELECT count(*)::int FROM mentorship_requests r WHERE r.mentor_id = app_uid() AND r.status = 'pending'),
         (SELECT count(*)::int FROM mentorship_requests r WHERE r.mentee_id = app_uid() AND r.status = 'pending')
    FROM (SELECT 1) one
    LEFT JOIN mentorship_settings s ON s.profile_id = app_uid()
   WHERE app_uid() IS NOT NULL
$$;

-- Views (section 4.4) --------------------------------------------------------------------

-- A member's requests in both directions, with the other party's public
-- fields only (name, credentials, and title and organization for a
-- professional). Runs as the view owner and filters to the caller, so a
-- closed request still shows who it was with after the counterparty rule
-- stops applying. Mentee details (program, goals) are not here: they follow
-- student_details' own policy.
CREATE VIEW my_requests WITH (security_barrier = true) AS
SELECT
  r.id,
  CASE WHEN r.mentee_id = app_uid() THEN 'mentee' ELSE 'mentor' END AS role,
  r.kind,
  r.status,
  r.topic_id,
  t.label AS topic_label,
  r.mentee_id,
  r.mentor_id,
  cp.id AS counterparty_id,
  cp.kind AS counterparty_kind,
  cp.first_name AS counterparty_first_name,
  cp.last_name AS counterparty_last_name,
  CASE WHEN cp.anonymized_at IS NULL THEN cp.credentials END AS counterparty_credentials,
  CASE WHEN cp.anonymized_at IS NULL THEN cd.title END AS counterparty_title,
  CASE WHEN cp.anonymized_at IS NULL THEN cd.organization END AS counterparty_organization,
  cp.anonymized_at IS NOT NULL AS counterparty_former,
  r.why,
  r.goals,
  r.format,
  r.mode,
  r.scheduling_note,
  r.mentor_note,
  r.decline_reason,
  r.reminders_sent,
  r.text_purged_at IS NOT NULL AS text_purged,
  r.created_at,
  r.expires_at,
  r.responded_at,
  r.updated_at,
  rel.id AS relationship_id,
  rel.started_at,
  rel.completed_at,
  rel.completed_by,
  coalesce(rel.shared_methods, '{}')::text[] AS shared_methods
FROM mentorship_requests r
JOIN profiles cp ON cp.id = CASE WHEN r.mentee_id = app_uid() THEN r.mentor_id ELSE r.mentee_id END
LEFT JOIN professional_details cd ON cd.profile_id = cp.id
LEFT JOIN mentorship_topics t ON t.id = r.topic_id
LEFT JOIN mentorship_relationships rel ON rel.request_id = r.id
WHERE app_uid() IS NOT NULL AND (r.mentee_id = app_uid() OR r.mentor_id = app_uid());

-- Privileges (section 5.3) ----------------------------------------------------------------

-- Internal helpers: only definer functions call them.
REVOKE EXECUTE ON FUNCTION member_in_good_standing(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION profile_listed_access(uuid, boolean) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION mentor_active_count(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION contact_values(uuid, contact_method[]) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION audit_contact_viewed(uuid, contact_method[], jsonb) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION profile_first_name(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION request_payload(mentorship_requests) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION mentor_listed(uuid) FROM PUBLIC, app_user;

-- Lifecycle functions: the jobs (system context) only.
REVOKE EXECUTE ON FUNCTION expire_request(uuid, timestamptz) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION send_request_reminder(uuid, int, timestamptz) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION resume_mentor(uuid, date) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION purge_request_text(timestamptz) FROM PUBLIC, app_user;

-- Requests and relationships: read by policy, written only by the functions.
REVOKE ALL ON mentorship_requests, mentorship_relationships FROM app_user;
GRANT SELECT ON mentorship_requests, mentorship_relationships TO app_user;

REVOKE ALL ON my_requests FROM app_user;
GRANT SELECT ON my_requests TO app_user;

-- Row-level security ----------------------------------------------------------------------

ALTER TABLE mentorship_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentorship_relationships ENABLE ROW LEVEL SECURITY;

-- The two parties; administrators read requests only through the masked
-- admin_requests view (Task 24).
CREATE POLICY mentorship_requests_party_read ON mentorship_requests FOR SELECT TO app_user
  USING (mentee_id = app_uid() OR mentor_id = app_uid());

-- The two parties and administrators (the shared method names are not
-- secret; the values live in contact_preferences).
CREATE POLICY mentorship_relationships_party_read ON mentorship_relationships FOR SELECT TO app_user
  USING (mentee_id = app_uid() OR mentor_id = app_uid());
CREATE POLICY mentorship_relationships_admin_read ON mentorship_relationships FOR SELECT TO app_user
  USING (is_admin());

-- Counterparties (section 5.3): the other party's profile row, whatever its
-- visibility, and so every detail table that follows the profile; and a
-- student's details, which follow no profile policy.
CREATE POLICY profiles_counterparty_read ON profiles FOR SELECT TO app_user
  USING (is_member() AND is_counterparty(id));
CREATE POLICY student_details_counterparty_read ON student_details FOR SELECT TO app_user
  USING (is_member() AND is_counterparty(profile_id));
