-- 0015_feedback: post-completion feedback (Task 32, 07-build-plan-phases-2-4.md;
-- REL-8, 04 section 7 "Post-completion feedback").
--
-- Once a relationship is completed, each party may answer two questions
-- once: how helpful it was (1 to 5) and, optionally, anything to add (up to
-- 600 characters). `leave_feedback` is the only writer. Whoever did not mark
-- the relationship completed is invited by `complete_relationship`, which
-- is re-created below so its completion notice becomes that invitation
-- (template `feedback-invite`, emailed under the member's preferences).
--
-- Who reads what (02 section 5.3):
-- - The author reads their own answer. The other party never reads it, not
--   the rating and not the comment.
-- - Administrators never read the table. They see the average helpfulness
--   and the number of answers on the dashboard (`admin_dashboard`, re-created
--   from 0014 with two columns appended), and the comments only through
--   `admin_feedback`, which names no author, request, relationship or topic
--   and dates each comment by month only.
-- - Leaving feedback is not written to the audit log: the log names the
--   actor and the time, and would tie an anonymous comment to its author.
--
-- Deletion (02 section 8): the sweep empties the leaver's comments and keeps
-- their ratings, and takes the leaver's names out of the comments the other
-- party wrote about their relationships. This is a trigger on the tombstone
-- (`profiles.anonymized_at` being set), not a step added to
-- `execute_account_deletion`: this file sorts before 0016_photos.sql, which
-- re-creates that function, so a fresh database would run 0016's copy last
-- and a database that already applied 0016 would run this one last. A
-- trigger holds under either order.

-- relationship_feedback -----------------------------------------------------------

CREATE TABLE relationship_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES mentorship_relationships (id),
  author_id uuid NOT NULL REFERENCES profiles (id),
  -- shared/limits.ts fieldLimits.feedbackHelpful and feedbackComment.
  helpful smallint NOT NULL CHECK (helpful BETWEEN 1 AND 5),
  -- Trimmed; null when there was nothing to add or the sweep emptied it.
  comment text CHECK (char_length(comment) BETWEEN 1 AND 600),
  comment_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_feedback_one_per_author UNIQUE (relationship_id, author_id),
  CONSTRAINT relationship_feedback_purged_is_empty CHECK (comment_purged_at IS NULL OR comment IS NULL)
);
CREATE INDEX relationship_feedback_author_idx ON relationship_feedback (author_id);
-- The administrators' comment list, newest first.
CREATE INDEX relationship_feedback_comments_idx ON relationship_feedback (created_at DESC) WHERE comment IS NOT NULL;

-- Functions -------------------------------------------------------------------------

-- A party of a completed relationship answers once. `request_id` is the
-- request the relationship came from, as on the request pages. Returns the
-- new row's id. The invitation to answer, if there was one, is marked read.
CREATE FUNCTION leave_feedback(request_id uuid, helpful int, comment text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  rel mentorship_relationships%ROWTYPE;
  clean text := nullif(btrim(leave_feedback.comment), '');
  new_id uuid;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  -- The relationship row is the lock: two answers from the same party at
  -- once meet here, and the second finds the first.
  SELECT * INTO rel FROM mentorship_relationships mr WHERE mr.request_id = leave_feedback.request_id FOR UPDATE;
  IF NOT FOUND OR me NOT IN (rel.mentee_id, rel.mentor_id) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF rel.completed_at IS NULL THEN
    RAISE EXCEPTION 'mest.not_completed' USING ERRCODE = '23514';
  END IF;
  IF leave_feedback.helpful IS NULL OR leave_feedback.helpful NOT BETWEEN 1 AND 5
     OR char_length(clean) > 600 THEN
    RAISE EXCEPTION 'mest.invalid_feedback' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM relationship_feedback f WHERE f.relationship_id = rel.id AND f.author_id = me) THEN
    RAISE EXCEPTION 'mest.feedback_exists' USING ERRCODE = '23514';
  END IF;

  INSERT INTO relationship_feedback (relationship_id, author_id, helpful, comment)
  VALUES (rel.id, me, leave_feedback.helpful, clean)
  RETURNING id INTO new_id;

  UPDATE notifications n SET read_at = now()
   WHERE n.recipient_id = me AND n.template = 'feedback-invite' AND n.read_at IS NULL
     AND n.subject_type = 'mentorship_request' AND n.subject_id = rel.request_id;
  RETURN new_id;
END
$$;

-- The comments, for administrators: newest first, `size` per page, with the
-- total on every row. Each row says which side wrote it and the month it
-- was written; nothing names or points back at a person.
CREATE FUNCTION admin_feedback(page int, size int)
RETURNS TABLE (id uuid, author_role text, kind request_kind, helpful smallint, comment text, month text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF admin_feedback.page IS NULL OR admin_feedback.page < 1
     OR admin_feedback.size IS NULL OR admin_feedback.size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'mest.invalid_page' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT f.id,
           CASE WHEN f.author_id = rel.mentee_id THEN 'mentee' ELSE 'mentor' END,
           r.kind,
           f.helpful,
           f.comment,
           to_char(f.created_at AT TIME ZONE 'America/Chicago', 'YYYY-MM'),
           count(*) OVER ()
      FROM relationship_feedback f
      JOIN mentorship_relationships rel ON rel.id = f.relationship_id
      JOIN mentorship_requests r ON r.id = rel.request_id
     WHERE f.comment IS NOT NULL
     ORDER BY f.created_at DESC, f.id
     LIMIT admin_feedback.size OFFSET (admin_feedback.page - 1) * admin_feedback.size;
END
$$;

-- Re-created from 0005: the completion notice to the other party is now the
-- invitation to leave feedback, emailed (under the member's preference for
-- the category) with the `feedback-invite` template. Everything else is as
-- in 0005.
CREATE OR REPLACE FUNCTION complete_relationship(request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  r mentorship_requests%ROWTYPE;
  other uuid;
  noun text;
  path text;
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
  noun := CASE r.kind WHEN 'introduction' THEN 'introduction' ELSE 'mentorship' END;
  path := CASE WHEN other = r.mentee_id THEN '/network/me/requests/' ELSE '/network/mentor/requests/' END || r.id;
  PERFORM create_notification(
    other, CASE WHEN other = r.mentee_id THEN 'response' ELSE 'request' END::notification_category,
    profile_first_name(me) || ' marked your ' || noun || ' as completed',
    'Thank you for taking part. Two short questions about how it went help MEST improve mentoring; '
      || profile_first_name(me) || ' never sees your answers.',
    path,
    'feedback-invite',
    request_payload(r) || jsonb_build_object(
      'otherFirstName', profile_first_name(me),
      'recipientRole', CASE WHEN other = r.mentee_id THEN 'mentee' ELSE 'mentor' END,
      'link', path
    ),
    true,
    'mentorship_request', r.id
  );
  PERFORM write_audit('request.completed', 'mentorship_request', r.id, '{}'::jsonb);
END
$$;

-- The sweep's step for feedback (see the header for why it is a trigger).
-- When a profile becomes the tombstone, the leaver's comments are emptied
-- (ratings kept), and their names, read from the row before it changed,
-- are taken out of the comments the other party wrote about their
-- relationships, as the sweep does for other members' notifications.
CREATE FUNCTION relationship_feedback_on_tombstone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  names text[] := array_remove(ARRAY[
    nullif(btrim(concat_ws(' ', OLD.first_name, OLD.last_name)), ''),
    nullif(btrim(OLD.first_name), ''),
    nullif(btrim(OLD.last_name), '')
  ], NULL);
BEGIN
  UPDATE relationship_feedback f
     SET comment = NULL, comment_purged_at = coalesce(f.comment_purged_at, now())
   WHERE f.author_id = NEW.id;
  IF cardinality(names) > 0 THEN
    UPDATE relationship_feedback f
       SET comment = scrub_name(f.comment, names)
      FROM mentorship_relationships rel
     WHERE rel.id = f.relationship_id
       AND (rel.mentee_id = NEW.id OR rel.mentor_id = NEW.id)
       AND f.author_id <> NEW.id
       AND f.comment IS NOT NULL;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER profiles_tombstone_feedback AFTER UPDATE OF anonymized_at ON profiles
  FOR EACH ROW
  WHEN (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
  EXECUTE FUNCTION relationship_feedback_on_tombstone();

-- The dashboard (re-created from 0014) -------------------------------------------------

-- As in 0014, with two feedback measures appended: feedback_responses counts
-- every answer, feedback_average_helpful is their mean helpfulness (one
-- decimal; null before the first answer). A swept member's rating still
-- counts. Aggregates only: no row names a person.
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
  (SELECT count(*) FROM meetings m WHERE m.status = 'upcoming' AND m.starts_at > now())::int AS meetings_upcoming,
  (SELECT count(*) FROM relationship_feedback f)::int AS feedback_responses,
  (SELECT round(avg(f.helpful), 1)::float8 FROM relationship_feedback f) AS feedback_average_helpful
WHERE is_admin();

REVOKE ALL ON admin_dashboard FROM app_user;
GRANT SELECT ON admin_dashboard TO app_user;

-- Privileges and row-level security (02 section 5.3) ---------------------------------------

-- The trigger's function runs only as the trigger.
REVOKE EXECUTE ON FUNCTION relationship_feedback_on_tombstone() FROM PUBLIC, app_user;

-- The member and administrator functions: app_user, which each checks the caller of.
REVOKE EXECUTE ON FUNCTION leave_feedback(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_feedback(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_feedback(uuid, int, text) TO app_user;
GRANT EXECUTE ON FUNCTION admin_feedback(int, int) TO app_user;

-- Read by policy, written only by leave_feedback and the sweep.
REVOKE ALL ON relationship_feedback FROM app_user;
GRANT SELECT ON relationship_feedback TO app_user;

ALTER TABLE relationship_feedback ENABLE ROW LEVEL SECURITY;

-- The author only. No policy for the other party or for administrators:
-- they read the dashboard's aggregates and admin_feedback instead.
CREATE POLICY relationship_feedback_author_read ON relationship_feedback FOR SELECT TO app_user
  USING (author_id = app_uid());
