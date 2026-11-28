-- 0019_calendar_feed: a private iCalendar feed of a member's meetings
-- (Phase 3; 07-build-plan-phases-2-4.md, Task 37).
--
-- A member turns the feed on in Settings, Calendar and gets a secret
-- address, /api/calendar/<token>.ics, to add to a calendar app. The token is
-- 32 random bytes made by the API; only its sha256 is stored here, so a
-- database read never yields a working address, and the address is shown
-- once. Making a new one revokes the old one; turning the feed off revokes
-- it too. A member holds at most one working token.
--
-- The feed is read without a session (calendar apps carry no cookie), so
-- the route calls calendar_feed(token_hash) as app_user with no user. It
-- answers null for an unknown or revoked token and for an owner who cannot
-- use the platform right now (unverified, suspended, deletion scheduled or
-- done); otherwise the owner's upcoming meetings and those of the last 30
-- days, with the other party's first name only. Never the place or the
-- agenda (the pair's own words) and no contact value.
--
-- Deletion: the sweep deletes the leaver's tokens (execute_account_deletion
-- re-created below from 0016 with that one step added). Export: whether a
-- feed is on and since when, never the hash.

-- calendar_tokens --------------------------------------------------------------

CREATE TABLE calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id),
  -- sha256 of the token, lowercase hex, as sessions store theirs.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
-- One working token per member.
CREATE UNIQUE INDEX calendar_tokens_one_active_idx ON calendar_tokens (profile_id) WHERE revoked_at IS NULL;

-- Functions ------------------------------------------------------------------------

-- Turns the caller's feed on, or gives it a new address: any working token
-- of theirs is revoked and the new hash stored. Returns when it was made.
CREATE FUNCTION create_calendar_token(token_hash text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  replaced int;
  made timestamptz;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF create_calendar_token.token_hash IS NULL OR create_calendar_token.token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'mest.invalid_token' USING ERRCODE = '22023';
  END IF;
  -- Two requests at once from the same member queue here, so only one
  -- token stays working.
  PERFORM 1 FROM profiles p WHERE p.id = me FOR UPDATE;
  UPDATE calendar_tokens ct SET revoked_at = now() WHERE ct.profile_id = me AND ct.revoked_at IS NULL;
  GET DIAGNOSTICS replaced = ROW_COUNT;
  INSERT INTO calendar_tokens (profile_id, token_hash)
  VALUES (me, create_calendar_token.token_hash)
  RETURNING created_at INTO made;
  PERFORM write_audit('calendar_feed.created', 'profile', me, jsonb_build_object('replaced', replaced > 0));
  RETURN made;
END
$$;

-- Turns the caller's feed off. True when there was one to turn off.
CREATE FUNCTION revoke_calendar_token() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  revoked int;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM profiles p WHERE p.id = me FOR UPDATE;
  UPDATE calendar_tokens ct SET revoked_at = now() WHERE ct.profile_id = me AND ct.revoked_at IS NULL;
  GET DIAGNOSTICS revoked = ROW_COUNT;
  IF revoked > 0 THEN
    PERFORM write_audit('calendar_feed.revoked', 'profile', me, '{}'::jsonb);
  END IF;
  RETURN revoked > 0;
END
$$;

-- The feed behind a token: null unless the token is working and its owner
-- may use the platform; otherwise a JSON array of the owner's meetings that
-- start after `as_of` less 30 days, soonest first, at most 500. Each event
-- carries the other party's first name (or that the account was deleted),
-- the time, length, mode and status, and which side of the request the
-- owner is on, for the link back to the request page. Nothing else.
CREATE FUNCTION calendar_feed(token_hash text, as_of timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owner uuid;
  events jsonb;
BEGIN
  IF calendar_feed.token_hash IS NULL OR calendar_feed.token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT ct.profile_id INTO owner
    FROM calendar_tokens ct
    JOIN users u ON u.id = ct.profile_id
    JOIN profiles p ON p.id = ct.profile_id
   WHERE ct.token_hash = calendar_feed.token_hash
     AND ct.revoked_at IS NULL
     AND u.email_verified_at IS NOT NULL
     AND u.suspended_at IS NULL
     AND u.deleted_at IS NULL
     AND p.anonymized_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM account_deletions d
        WHERE d.profile_id = ct.profile_id AND d.canceled_at IS NULL AND d.executed_at IS NULL
     );
  IF owner IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(e.item ORDER BY e.starts_at, e.id), '[]'::jsonb) INTO events
    FROM (
      SELECT m.id, m.starts_at,
             jsonb_build_object(
               'id', m.id,
               'requestId', rel.request_id,
               'role', CASE WHEN rel.mentee_id = owner THEN 'mentee' ELSE 'mentor' END,
               'otherFirstName', cp.first_name,
               'otherFormer', cp.anonymized_at IS NOT NULL,
               'startsAt', m.starts_at,
               'durationMin', m.duration_min,
               'mode', m.mode,
               'status', m.status,
               'createdAt', m.created_at,
               'updatedAt', m.updated_at
             ) AS item
        FROM meetings m
        JOIN mentorship_relationships rel ON rel.id = m.relationship_id
        JOIN profiles cp ON cp.id = CASE WHEN rel.mentee_id = owner THEN rel.mentor_id ELSE rel.mentee_id END
       WHERE owner IN (rel.mentee_id, rel.mentor_id)
         AND m.starts_at >= coalesce(as_of, now()) - interval '30 days'
       ORDER BY m.starts_at, m.id
       LIMIT 500
    ) e;
  RETURN events;
END
$$;

-- The sweep (re-created from 0016) ------------------------------------------------

-- As in 0016 (which holds every earlier step: requests, meetings, photos),
-- with the leaver's calendar tokens deleted among the per-member tables.

CREATE OR REPLACE FUNCTION execute_account_deletion(id uuid, as_of timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d account_deletions%ROWTYPE;
  target uuid;
  address citext;
  names text[];
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
  PERFORM close_meetings_of_departing(target);
  UPDATE mentorship_requests r SET status = 'completed'
   WHERE r.status = 'accepted' AND (r.mentee_id = target OR r.mentor_id = target);
  UPDATE mentorship_relationships rel SET completed_at = now(), completed_by = target
   WHERE rel.completed_at IS NULL AND (rel.mentee_id = target OR rel.mentor_id = target);
  UPDATE mentorship_requests r
     SET why = '', goals = NULL, scheduling_note = NULL, mentor_note = NULL,
         text_purged_at = coalesce(r.text_purged_at, now())
   WHERE r.mentee_id = target OR r.mentor_id = target;

  -- Other members' notifications about this member's requests, reports and
  -- review carry their name; they become "Former member" too (02 section 8).
  SELECT array_remove(ARRAY[
           nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           nullif(btrim(p.first_name), ''),
           nullif(btrim(p.last_name), '')
         ], NULL)
    INTO names FROM profiles p WHERE p.id = target;
  IF cardinality(names) > 0 THEN
    WITH scrubbed AS (
      UPDATE notifications n
         SET title = scrub_name(n.title, names),
             body = scrub_name(n.body, names),
             payload = scrub_name_values(n.payload, names)
       WHERE n.recipient_id <> target
         AND ((n.subject_type = 'mentorship_request' AND n.subject_id IN (
                SELECT r.id FROM mentorship_requests r WHERE r.mentee_id = target OR r.mentor_id = target))
           OR (n.subject_type = 'report' AND n.subject_id IN (SELECT rp.id FROM reports rp WHERE rp.profile_id = target))
           -- Report notices written before they carried their subject.
           OR (n.payload ? 'reportId' AND n.payload->>'reportId' IN (
                SELECT rp.id::text FROM reports rp WHERE rp.profile_id = target))
           OR (n.subject_type = 'profile_review' AND n.subject_id IN (
                SELECT pr.id FROM profile_reviews pr WHERE pr.profile_id = target)))
      RETURNING n.id AS scrubbed_id
    )
    -- Their emails for the same notifications, sent or not: a delivered row
    -- still keeps its payload in the database.
    UPDATE email_outbox o
       SET payload = scrub_name_values(o.payload, names)
     WHERE o.notification_id IN (SELECT sc.scrubbed_id FROM scrubbed sc);
  END IF;

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
  -- The photo goes with the account (0016); photos the leaver reviewed as an
  -- administrator keep their decision without the reviewer.
  DELETE FROM profile_photos ph WHERE ph.profile_id = target;
  UPDATE profile_photos ph SET reviewed_by = NULL WHERE ph.reviewed_by = target;
  -- The calendar feed goes with the account too (0019), revoked or not.
  DELETE FROM calendar_tokens ct WHERE ct.profile_id = target;

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

-- Privileges and row-level security ---------------------------------------------

REVOKE ALL ON calendar_tokens FROM app_user;
-- Never the hash: the owner sees whether a feed is on and since when.
GRANT SELECT (id, profile_id, created_at, revoked_at) ON calendar_tokens TO app_user;

ALTER TABLE calendar_tokens ENABLE ROW LEVEL SECURITY;

-- The owner only. Administrators read no one's feed either.
CREATE POLICY calendar_tokens_owner_read ON calendar_tokens FOR SELECT TO app_user
  USING (app_uid() IS NOT NULL AND profile_id = app_uid());

REVOKE EXECUTE ON FUNCTION create_calendar_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revoke_calendar_token() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calendar_feed(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_calendar_token(text) TO app_user;
GRANT EXECUTE ON FUNCTION revoke_calendar_token() TO app_user;
-- Called with no user: the token is the whole authority.
GRANT EXECUTE ON FUNCTION calendar_feed(text, timestamptz) TO app_user;
