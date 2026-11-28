-- 0014_meetings: proposed times, meetings and the "Did you meet?" prompt
-- (Phase 2; 02-technical-architecture.md sections 4.3, 5.3, 5.4 and 8;
-- 07-build-plan-phases-2-4.md, Task 30).
--
-- A pair in an active relationship schedules by one party proposing one to
-- three times (`propose_times`) and the other choosing one (`choose_time`),
-- which declines the batch's other times, creates the meeting and tells the
-- proposer. Either party may cancel an upcoming meeting or say whether it
-- happened (`record_meeting_outcome`). A daily job completes meetings whose
-- time has passed (`complete_past_meetings`) and another asks both parties,
-- a day after the start, whether they met (`meeting_prompt`).
--
-- Both parties of the relationship read its slots and meetings; nobody
-- writes them except the SECURITY DEFINER functions below, each of which
-- checks the caller first. Administrators see counts only, through the
-- dashboard. Lock order: the relationship row first, then its slots or
-- meeting, so two parties acting at once cannot deadlock or both win.
--
-- Columns beyond 02 section 4.3, kept for bookkeeping: a slot's `batch_id`
-- (which proposal it belongs to) and timestamps; a meeting's `slot_id`, the
-- outcome (`met`, `outcome_by`, `outcome_at`), the cancellation
-- (`canceled_by`, `canceled_at`) and `check_in_sent_at`, which makes the
-- prompt go out once.

CREATE TYPE slot_status AS ENUM ('proposed', 'chosen', 'declined', 'withdrawn');
CREATE TYPE meeting_status AS ENUM ('upcoming', 'completed', 'canceled');

-- availability_slots ---------------------------------------------------------------

CREATE TABLE availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES mentorship_relationships (id),
  proposed_by uuid NOT NULL REFERENCES profiles (id),
  -- The proposal the slot came in with; choosing one declines the rest of it.
  batch_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status slot_status NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 15 to 180 minutes (shared/limits.ts fieldLimits.slotMinutes).
  CONSTRAINT availability_slots_length CHECK (
    ends_at >= starts_at + interval '15 minutes' AND ends_at <= starts_at + interval '180 minutes'
  )
);
CREATE INDEX availability_slots_relationship_idx ON availability_slots (relationship_id, status);
CREATE INDEX availability_slots_batch_idx ON availability_slots (batch_id);

CREATE TRIGGER availability_slots_set_updated_at BEFORE UPDATE ON availability_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- meetings ------------------------------------------------------------------------

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES mentorship_relationships (id),
  -- The chosen time it was made from.
  slot_id uuid UNIQUE REFERENCES availability_slots (id),
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL CHECK (duration_min BETWEEN 15 AND 180),
  mode meeting_mode NOT NULL CHECK (mode IN ('online', 'in-person')),
  -- Emptied (to '') by the deletion sweep (02 section 8).
  place text NOT NULL DEFAULT '' CHECK (char_length(place) <= 200),
  agenda text NOT NULL DEFAULT '' CHECK (char_length(agenda) <= 400),
  status meeting_status NOT NULL DEFAULT 'upcoming',
  created_by uuid NOT NULL REFERENCES profiles (id),
  -- "Did you meet?": the latest answer from either party.
  met boolean,
  outcome_by uuid REFERENCES profiles (id),
  outcome_at timestamptz,
  canceled_by uuid REFERENCES profiles (id),
  canceled_at timestamptz,
  check_in_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetings_outcome_consistent CHECK (
    (met IS NULL) = (outcome_by IS NULL) AND (met IS NULL) = (outcome_at IS NULL)
  ),
  CONSTRAINT meetings_canceled_consistent CHECK ((canceled_at IS NULL) = (canceled_by IS NULL)),
  -- Canceled means someone canceled it, or someone said it did not happen.
  CONSTRAINT meetings_canceled_has_cause CHECK (status <> 'canceled' OR canceled_at IS NOT NULL OR met = false)
);
CREATE INDEX meetings_relationship_idx ON meetings (relationship_id, starts_at DESC);
-- What the two jobs scan.
CREATE INDEX meetings_upcoming_idx ON meetings (starts_at) WHERE status = 'upcoming';
CREATE INDEX meetings_check_in_idx ON meetings (starts_at) WHERE check_in_sent_at IS NULL;

CREATE TRIGGER meetings_set_updated_at BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Helpers ------------------------------------------------------------------------

-- Whether the caller is the mentee or the mentor of the relationship. The
-- row policies of both tables use it, so app_user may execute it (it
-- answers only about the caller), and the policies need no subquery against
-- mentorship_relationships (whose administrator policy would otherwise
-- widen what an administrator's subquery finds). The helpers after it are
-- for the definer functions only.
CREATE FUNCTION is_relationship_party(relationship uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM mentorship_relationships rel
     WHERE rel.id = $1 AND app_uid() IN (rel.mentee_id, rel.mentor_id)
  )
$$;

-- The request page for the recipient's side of the relationship.
CREATE FUNCTION relationship_path(rel mentorship_relationships, recipient uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN recipient = rel.mentee_id THEN '/network/me/requests/' ELSE '/network/mentor/requests/' END
         || rel.request_id
$$;

-- What a notification about a meeting may carry: the other party's first
-- name, the date and time in Louisiana, the length and the mode. Never the
-- place or the agenda, which are the pair's own words.
CREATE FUNCTION meeting_payload(m meetings, recipient uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rel mentorship_relationships%ROWTYPE;
BEGIN
  SELECT * INTO rel FROM mentorship_relationships r WHERE r.id = m.relationship_id;
  RETURN jsonb_build_object(
    'requestId', rel.request_id,
    'meetingId', m.id,
    'otherFirstName', profile_first_name(CASE WHEN recipient = rel.mentee_id THEN rel.mentor_id ELSE rel.mentee_id END),
    'startsOn', to_char(m.starts_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD'),
    'startsAtTime', to_char(m.starts_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM'),
    'durationMin', m.duration_min,
    'mode', m.mode,
    'link', relationship_path(rel, recipient)
  );
END
$$;

-- The relationship, locked, when the caller is one of its parties and it is
-- still active; raises otherwise. Every write below starts here.
CREATE FUNCTION lock_active_relationship(relationship uuid) RETURNS mentorship_relationships
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
  RETURN rel;
END
$$;

-- Functions (section 4.5) ------------------------------------------------------------

-- Either party of an active relationship proposes one to three future times,
-- each 15 to 180 minutes long and within a year. A new proposal replaces the
-- caller's own open one (its times are withdrawn); the other party's open
-- proposal stays. The other party is told (request, emailed). Returns the
-- proposal's batch id.
CREATE FUNCTION propose_times(relationship_id uuid, slots jsonb) RETURNS uuid
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
  PERFORM create_notification(
    other, 'request',
    profile_first_name(me) || ' proposed ' || CASE WHEN n = 1 THEN 'a time' ELSE n || ' times' END || ' to meet',
    'Open the mentorship to choose one, or propose other times.',
    relationship_path(rel, other),
    'default',
    jsonb_build_object('requestId', rel.request_id, 'link', relationship_path(rel, other)),
    true,
    'mentorship_request', rel.request_id
  );
  PERFORM write_audit('meeting.times_proposed', 'mentorship_request', rel.request_id,
    jsonb_build_object('batch', batch, 'count', n));
  RETURN batch;
END
$$;

-- The other party picks one proposed time. The rest of that proposal is
-- declined, and the chooser's own open proposal (now moot) is withdrawn; the
-- meeting is created with the chosen time, the mode (online or in person),
-- and an optional place and agenda; the proposer is told (response,
-- template meeting-scheduled, emailed). Returns the meeting's id.
CREATE FUNCTION choose_time(slot_id uuid, mode meeting_mode, place text, agenda text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  rel mentorship_relationships%ROWTYPE;
  slot availability_slots%ROWTYPE;
  clean_place text := btrim(coalesce(place, ''));
  clean_agenda text := btrim(coalesce(agenda, ''));
  m meetings%ROWTYPE;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO slot FROM availability_slots sl WHERE sl.id = choose_time.slot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  rel := lock_active_relationship(slot.relationship_id);
  SELECT * INTO slot FROM availability_slots sl WHERE sl.id = choose_time.slot_id FOR UPDATE;

  IF slot.proposed_by = me THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501', DETAIL = 'the other party chooses';
  END IF;
  IF slot.status <> 'proposed' THEN
    RAISE EXCEPTION 'mest.slot_unavailable' USING ERRCODE = '23514';
  END IF;
  IF slot.starts_at <= now() THEN
    RAISE EXCEPTION 'mest.slot_past' USING ERRCODE = '23514';
  END IF;
  IF mode IS NULL OR mode NOT IN ('online', 'in-person') THEN
    RAISE EXCEPTION 'mest.invalid_mode' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_place) > 200 OR char_length(clean_agenda) > 400 THEN
    RAISE EXCEPTION 'mest.invalid_meeting' USING ERRCODE = '22023';
  END IF;

  UPDATE availability_slots sl SET status = 'chosen' WHERE sl.id = slot.id;
  UPDATE availability_slots sl SET status = 'declined'
   WHERE sl.batch_id = slot.batch_id AND sl.id <> slot.id AND sl.status = 'proposed';
  UPDATE availability_slots sl SET status = 'withdrawn'
   WHERE sl.relationship_id = rel.id AND sl.proposed_by = me AND sl.status = 'proposed';

  INSERT INTO meetings (relationship_id, slot_id, starts_at, duration_min, mode, place, agenda, created_by)
  VALUES (
    rel.id, slot.id, slot.starts_at,
    (extract(epoch FROM slot.ends_at - slot.starts_at) / 60)::int,
    mode, clean_place, clean_agenda, me
  )
  RETURNING * INTO m;

  PERFORM create_notification(
    slot.proposed_by, 'response',
    profile_first_name(me) || ' chose a time to meet',
    'You meet on ' || to_char(m.starts_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') || ' at '
      || to_char(m.starts_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM') || ' (Louisiana time).',
    relationship_path(rel, slot.proposed_by),
    'meeting-scheduled',
    meeting_payload(m, slot.proposed_by),
    true,
    'mentorship_request', rel.request_id
  );
  PERFORM write_audit('meeting.scheduled', 'meeting', m.id,
    jsonb_build_object('request', rel.request_id, 'mode', m.mode));
  RETURN m.id;
END
$$;

-- Either party cancels a meeting that has not started; the other is told
-- (emailed). Canceling an ended relationship's meeting is still allowed.
CREATE FUNCTION cancel_meeting(meeting_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  m meetings%ROWTYPE;
  rel mentorship_relationships%ROWTYPE;
  other uuid;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM meetings mt WHERE mt.id = cancel_meeting.meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO rel FROM mentorship_relationships r WHERE r.id = m.relationship_id FOR UPDATE;
  IF me NOT IN (rel.mentee_id, rel.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO m FROM meetings mt WHERE mt.id = cancel_meeting.meeting_id FOR UPDATE;
  IF m.status <> 'upcoming' THEN
    RAISE EXCEPTION 'mest.not_upcoming' USING ERRCODE = '23514';
  END IF;
  IF m.starts_at <= now() THEN
    RAISE EXCEPTION 'mest.meeting_started' USING ERRCODE = '23514';
  END IF;

  UPDATE meetings mt SET status = 'canceled', canceled_by = me, canceled_at = now() WHERE mt.id = m.id;

  other := CASE WHEN me = rel.mentee_id THEN rel.mentor_id ELSE rel.mentee_id END;
  PERFORM create_notification(
    other, CASE WHEN other = rel.mentee_id THEN 'response' ELSE 'request' END::notification_category,
    profile_first_name(me) || ' canceled your meeting on '
      || to_char(m.starts_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD'),
    'You can propose new times in the mentorship.',
    relationship_path(rel, other),
    'default',
    jsonb_build_object('requestId', rel.request_id, 'meetingId', m.id, 'link', relationship_path(rel, other)),
    true,
    'mentorship_request', rel.request_id
  );
  PERFORM write_audit('meeting.canceled', 'meeting', m.id, jsonb_build_object('request', rel.request_id));
END
$$;

-- "Did you meet?": either party answers once the meeting has started. Yes
-- makes it completed, no makes it canceled; a later answer (from either
-- party) replaces an earlier one. A canceled meeting cannot be answered.
CREATE FUNCTION record_meeting_outcome(meeting_id uuid, met boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  m meetings%ROWTYPE;
  rel mentorship_relationships%ROWTYPE;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM meetings mt WHERE mt.id = record_meeting_outcome.meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO rel FROM mentorship_relationships r WHERE r.id = m.relationship_id FOR UPDATE;
  IF me NOT IN (rel.mentee_id, rel.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF record_meeting_outcome.met IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM meetings mt WHERE mt.id = record_meeting_outcome.meeting_id FOR UPDATE;
  IF m.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'mest.meeting_canceled' USING ERRCODE = '23514';
  END IF;
  IF m.starts_at > now() THEN
    RAISE EXCEPTION 'mest.meeting_not_started' USING ERRCODE = '23514';
  END IF;

  UPDATE meetings mt
     SET met = record_meeting_outcome.met, outcome_by = me, outcome_at = now(),
         status = CASE WHEN record_meeting_outcome.met THEN 'completed' ELSE 'canceled' END::meeting_status
   WHERE mt.id = m.id;
  PERFORM write_audit('meeting.outcome', 'meeting', m.id,
    jsonb_build_object('request', rel.request_id, 'met', record_meeting_outcome.met));
END
$$;

-- Lifecycle functions for the jobs. System context only: app_user has no
-- EXECUTE, and each refuses a call with an acting user. `as_of` is the
-- scheduler's clock. Each moves a meeting at most once.

-- Upcoming meetings whose time is over become completed (unless a party
-- already answered "Did you meet?", which moved them out of upcoming).
-- Returns how many.
CREATE FUNCTION complete_past_meetings(as_of timestamptz DEFAULT now()) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  done int;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE meetings m SET status = 'completed'
   WHERE m.status = 'upcoming'
     AND m.starts_at + make_interval(mins => m.duration_min) <= coalesce(as_of, now());
  GET DIAGNOSTICS done = ROW_COUNT;
  IF done > 0 THEN
    PERFORM write_audit('meeting.completed', 'meeting', NULL, jsonb_build_object('count', done));
  END IF;
  RETURN done;
END
$$;

-- A day after a meeting's start, both parties (those still in good
-- standing) are asked whether they met (reminder, template
-- meeting-check-in, emailed). Once per meeting; none for a canceled one or
-- one already answered. Returns how many meetings were asked about.
CREATE FUNCTION meeting_prompt(as_of timestamptz DEFAULT now()) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m meetings%ROWTYPE;
  rel mentorship_relationships%ROWTYPE;
  party uuid;
  asked int := 0;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  FOR m IN
    SELECT * FROM meetings mt
     WHERE mt.check_in_sent_at IS NULL AND mt.canceled_at IS NULL AND mt.met IS NULL
       AND mt.status IN ('upcoming', 'completed')
       AND mt.starts_at + interval '1 day' <= coalesce(as_of, now())
     ORDER BY mt.starts_at, mt.id
       FOR UPDATE
  LOOP
    SELECT * INTO rel FROM mentorship_relationships r WHERE r.id = m.relationship_id;
    FOREACH party IN ARRAY ARRAY[rel.mentee_id, rel.mentor_id] LOOP
      IF member_in_good_standing(party) THEN
        PERFORM create_notification(
          party, 'reminder',
          'Did you meet ' || profile_first_name(CASE WHEN party = rel.mentee_id THEN rel.mentor_id ELSE rel.mentee_id END) || '?',
          'Tell us whether your meeting on ' || to_char(m.starts_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD')
            || ' happened. It takes one tap.',
          relationship_path(rel, party),
          'meeting-check-in',
          meeting_payload(m, party),
          true,
          'mentorship_request', rel.request_id
        );
      END IF;
    END LOOP;
    UPDATE meetings mt SET check_in_sent_at = now() WHERE mt.id = m.id;
    asked := asked + 1;
  END LOOP;
  RETURN asked;
END
$$;

-- The deletion sweep's part (02 section 8): the departing member's open
-- proposals are withdrawn and their meetings still to come are canceled;
-- every slot and meeting stays, the meetings' place and agenda emptied.
-- Called from execute_account_deletion.
CREATE FUNCTION close_meetings_of_departing(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE availability_slots sl SET status = 'withdrawn'
    FROM mentorship_relationships rel
   WHERE sl.relationship_id = rel.id AND target IN (rel.mentee_id, rel.mentor_id) AND sl.status = 'proposed';
  UPDATE meetings m SET status = 'canceled', canceled_by = target, canceled_at = now()
    FROM mentorship_relationships rel
   WHERE m.relationship_id = rel.id AND target IN (rel.mentee_id, rel.mentor_id)
     AND m.status = 'upcoming' AND m.starts_at > now();
  UPDATE meetings m SET place = '', agenda = ''
    FROM mentorship_relationships rel
   WHERE m.relationship_id = rel.id AND target IN (rel.mentee_id, rel.mentor_id)
     AND (m.place <> '' OR m.agenda <> '');
END
$$;

-- Views (section 4.4) --------------------------------------------------------------------

-- The caller's meetings in both roles, with the request they belong to and
-- the other party's name only. Runs as the view owner and filters to the
-- caller, so an ended relationship's meetings still show who they were with
-- after the counterparty rule stops applying (as my_requests does).
CREATE VIEW my_meetings WITH (security_barrier = true) AS
SELECT
  m.id,
  rel.request_id,
  m.relationship_id,
  CASE WHEN rel.mentee_id = app_uid() THEN 'mentee' ELSE 'mentor' END AS role,
  r.kind,
  t.label AS topic_label,
  cp.first_name AS counterparty_first_name,
  cp.last_name AS counterparty_last_name,
  cp.anonymized_at IS NOT NULL AS counterparty_former,
  m.starts_at,
  m.starts_at + make_interval(mins => m.duration_min) AS ends_at,
  m.duration_min,
  m.mode,
  m.place,
  m.agenda,
  m.status,
  m.created_by = app_uid() AS created_by_me,
  m.met,
  CASE WHEN m.outcome_by IS NULL THEN NULL ELSE m.outcome_by = app_uid() END AS outcome_by_me,
  m.outcome_at,
  CASE WHEN m.canceled_by IS NULL THEN NULL ELSE m.canceled_by = app_uid() END AS canceled_by_me,
  m.canceled_at,
  m.created_at
FROM meetings m
JOIN mentorship_relationships rel ON rel.id = m.relationship_id
JOIN mentorship_requests r ON r.id = rel.request_id
JOIN profiles cp ON cp.id = CASE WHEN rel.mentee_id = app_uid() THEN rel.mentor_id ELSE rel.mentee_id END
LEFT JOIN mentorship_topics t ON t.id = rel.topic_id
WHERE app_uid() IS NOT NULL AND app_uid() IN (rel.mentee_id, rel.mentor_id);

-- The deletion sweep (re-created from 0010) ---------------------------------------------

-- As in 0010, with the departing member's slots and meetings handled by
-- close_meetings_of_departing before their relationships end.
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

-- The dashboard (re-created from 0009) --------------------------------------------------

-- As in 0009, with two meeting measures appended (01 section 8, "Meetings
-- held"): meetings_held counts completed meetings, meetings_upcoming the
-- meetings still to come. Counts only: no row names a person.
CREATE OR REPLACE VIEW admin_dashboard AS
WITH mreq AS (
  SELECT r.*,
         r.status IN ('accepted', 'completed') AS was_accepted,
         r.status = 'declined' AND r.decline_reason IS DISTINCT FROM 'member_left' AS was_declined,
         r.responded_at IS NOT NULL AND r.responded_at <= r.created_at + interval '7 days' AS within_week
    FROM mentorship_requests r
   WHERE r.kind = 'mentorship'
),
mrel AS (
  SELECT rel.*
    FROM mentorship_relationships rel
    JOIN mentorship_requests r ON r.id = rel.request_id
   WHERE r.kind = 'mentorship'
),
months AS (
  SELECT m::date AS month_start
    FROM generate_series(
           date_trunc('month', now() AT TIME ZONE 'America/Chicago') - interval '2 months',
           date_trunc('month', now() AT TIME ZONE 'America/Chicago'),
           interval '1 month'
         ) AS m
)
SELECT
  (SELECT count(*) FROM profiles p
    WHERE p.kind = 'professional' AND p.approval_state = 'approved' AND p.anonymized_at IS NULL)::int AS approved_professionals,
  (SELECT count(*) FROM profiles p
    WHERE p.kind = 'professional' AND p.approval_state = 'pending' AND p.anonymized_at IS NULL)::int AS pending_professionals,
  (SELECT count(*) FROM profiles p WHERE p.kind = 'student' AND p.anonymized_at IS NULL)::int AS students,
  (SELECT count(*) FROM mentorship_settings s JOIN profiles p ON p.id = s.profile_id
    WHERE s.status = 'active' AND p.approval_state = 'approved' AND p.admin_hidden_at IS NULL
      AND p.anonymized_at IS NULL
      -- mentor_active_count's rule, inlined: a view's function calls are
      -- checked against the caller, and app_user cannot execute that helper.
      AND (SELECT count(*) FROM mrel WHERE mrel.mentor_id = s.profile_id AND mrel.completed_at IS NULL)
          < s.max_active)::int AS active_mentors,
  (SELECT count(*) FROM reports r WHERE r.status = 'open')::int AS open_reports,
  (SELECT min(r.created_at) FROM reports r WHERE r.status = 'open') AS oldest_open_report_at,
  (SELECT count(*) FROM mentorship_settings s JOIN profiles p ON p.id = s.profile_id
    WHERE s.status = 'paused' AND p.anonymized_at IS NULL)::int AS paused_mentors,
  (SELECT round((percentile_cont(0.5) WITHIN GROUP (
            ORDER BY extract(epoch FROM now() - s.paused_at) / 86400))::numeric, 1)::float8
     FROM mentorship_settings s JOIN profiles p ON p.id = s.profile_id
    WHERE s.status = 'paused' AND s.paused_at IS NOT NULL AND p.anonymized_at IS NULL) AS median_paused_days,
  (SELECT round((percentile_cont(0.5) WITHIN GROUP (
            ORDER BY extract(epoch FROM rv.decided_at - rv.submitted_at) / 3600))::numeric, 1)::float8
     FROM profile_reviews rv WHERE rv.decided_at IS NOT NULL) AS median_hours_to_approval,
  (SELECT count(*) FROM mreq)::int AS requests_sent,
  (SELECT count(*) FROM mentorship_requests r WHERE r.kind = 'introduction')::int AS introductions_sent,
  (SELECT round(100.0 * count(*) FILTER (WHERE (q.was_accepted OR q.was_declined) AND q.within_week)
                / nullif(count(*), 0))::int
     FROM mreq q
    WHERE q.status <> 'canceled'
      AND q.decline_reason IS DISTINCT FROM 'member_left'
      AND (q.created_at <= now() - interval '7 days' OR q.responded_at IS NOT NULL)) AS answered_within_7_days_pct,
  (SELECT round(100.0 * count(*) FILTER (WHERE q.was_accepted)
                / nullif(count(*) FILTER (WHERE q.was_accepted OR q.was_declined), 0))::int
     FROM mreq q) AS acceptance_rate_pct,
  (SELECT round(100.0 * count(*) FILTER (WHERE q.status = 'expired') / nullif(count(*), 0))::int
     FROM mreq q WHERE q.status <> 'pending') AS expiry_rate_pct,
  (SELECT count(*) FROM mrel WHERE mrel.completed_at IS NULL)::int AS active_relationships,
  (SELECT count(*) FROM mrel WHERE mrel.completed_at IS NOT NULL)::int AS completed_relationships,
  (SELECT count(*) FROM profiles p JOIN users u ON u.id = p.id
    WHERE p.anonymized_at IS NULL AND u.deleted_at IS NULL
      AND coalesce(p.last_active_at, p.created_at) < now() - interval '6 months')::int AS members_inactive_6_months,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('topicId', t.id, 'label', t.label, 'requests', t.n)
                             ORDER BY t.n DESC, t.id COLLATE "C"), '[]'::jsonb)
     FROM (SELECT mt.id, mt.label, count(*)::int AS n
             FROM mreq q JOIN mentorship_topics mt ON mt.id = q.topic_id
            GROUP BY mt.id, mt.label) t) AS requests_by_topic,
  (SELECT jsonb_agg(jsonb_build_object(
            'month', to_char(mo.month_start, 'YYYY-MM'),
            'requestsSent', (SELECT count(*) FROM mreq q
                              WHERE (q.created_at AT TIME ZONE 'America/Chicago')::date >= mo.month_start
                                AND (q.created_at AT TIME ZONE 'America/Chicago')::date < (mo.month_start + interval '1 month')::date),
            'answeredWithin7Days', (SELECT count(*) FROM mreq q
                              WHERE (q.was_accepted OR q.was_declined) AND q.within_week
                                AND (q.created_at AT TIME ZONE 'America/Chicago')::date >= mo.month_start
                                AND (q.created_at AT TIME ZONE 'America/Chicago')::date < (mo.month_start + interval '1 month')::date),
            'expired', (SELECT count(*) FROM mreq q
                              WHERE q.status = 'expired'
                                AND (q.created_at AT TIME ZONE 'America/Chicago')::date >= mo.month_start
                                AND (q.created_at AT TIME ZONE 'America/Chicago')::date < (mo.month_start + interval '1 month')::date),
            'completedRelationships', (SELECT count(*) FROM mrel
                              WHERE (mrel.completed_at AT TIME ZONE 'America/Chicago')::date >= mo.month_start
                                AND (mrel.completed_at AT TIME ZONE 'America/Chicago')::date < (mo.month_start + interval '1 month')::date)
          ) ORDER BY mo.month_start)
     FROM months mo) AS by_month,
  (SELECT count(*) FROM meetings m WHERE m.status = 'completed')::int AS meetings_held,
  (SELECT count(*) FROM meetings m WHERE m.status = 'upcoming' AND m.starts_at > now())::int AS meetings_upcoming
WHERE is_admin();

REVOKE ALL ON admin_dashboard FROM app_user;
GRANT SELECT ON admin_dashboard TO app_user;

-- Privileges (section 5.3) ----------------------------------------------------------------

-- Internal helpers: only definer functions call them.
REVOKE EXECUTE ON FUNCTION relationship_path(mentorship_relationships, uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION meeting_payload(meetings, uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION lock_active_relationship(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION close_meetings_of_departing(uuid) FROM PUBLIC, app_user;

-- The policies' helper: app_user evaluates it, and it answers only about the caller.
REVOKE EXECUTE ON FUNCTION is_relationship_party(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_relationship_party(uuid) TO app_user;

-- Lifecycle functions: the jobs (system context) only.
REVOKE EXECUTE ON FUNCTION complete_past_meetings(timestamptz) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION meeting_prompt(timestamptz) FROM PUBLIC, app_user;

-- The member functions: app_user, which each checks the caller of.
REVOKE EXECUTE ON FUNCTION propose_times(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION choose_time(uuid, meeting_mode, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_meeting(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_meeting_outcome(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION propose_times(uuid, jsonb) TO app_user;
GRANT EXECUTE ON FUNCTION choose_time(uuid, meeting_mode, text, text) TO app_user;
GRANT EXECUTE ON FUNCTION cancel_meeting(uuid) TO app_user;
GRANT EXECUTE ON FUNCTION record_meeting_outcome(uuid, boolean) TO app_user;

-- Slots and meetings: read by policy, written only by the functions.
REVOKE ALL ON availability_slots, meetings FROM app_user;
GRANT SELECT ON availability_slots, meetings TO app_user;

REVOKE ALL ON my_meetings FROM app_user;
GRANT SELECT ON my_meetings TO app_user;

-- Row-level security ----------------------------------------------------------------------

ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Both parties of the relationship; nobody else, administrators included
-- (they see counts on the dashboard).
CREATE POLICY availability_slots_party_read ON availability_slots FOR SELECT TO app_user
  USING (is_relationship_party(relationship_id));
CREATE POLICY meetings_party_read ON meetings FOR SELECT TO app_user
  USING (is_relationship_party(relationship_id));
