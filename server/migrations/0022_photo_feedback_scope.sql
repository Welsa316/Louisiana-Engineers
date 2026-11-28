-- 0022: region scope for photo moderation, and less to re-identify in what
-- administrators read of feedback (Task 39 privacy audit).
--
-- 1. Photos. A chapter administrator moderates only the photos of profiles
--    in its own region, like the profile review queue (0020):
--    `admin_review_photo` (from 0016) checks the profile's region after the
--    photo is found and raises mest.out_of_region otherwise, and the
--    administrator branch of the `profile_photos_read` policy narrows from
--    is_admin() to admin_covers_profile(profile_id). An approved photo of a
--    profile the caller may see stays readable to everyone, as before; the
--    queue's service filters by region as well, so approved and rejected
--    tabs hold only the caller's region too.
-- 2. `admin_feedback` (from 0015). Only an administrator for every region
--    reads the comments (a chapter administrator gets mest.out_of_region).
--    The comments about a relationship the caller was a party to are left
--    out, as admin_reports leaves out reports about the caller. Each row
--    no longer carries the request kind and is dated by quarter instead of
--    month, and the rows run by quarter, newest first, then by id, so the
--    order no longer tells when within a quarter a comment was written.
-- 3. `admin_dashboard` (re-created from 0015, its latest definition):
--    `feedback_responses` and `feedback_average_helpful` are null until
--    there are at least 5 answers, so watching the two move cannot isolate
--    one answer, and neither counts answers about a relationship the caller
--    was a party to. Every other column is as in 0015.
--
-- Nothing here stores member data, so execute_account_deletion and the
-- export are unchanged.

-- 1. Photos ---------------------------------------------------------------------------

-- From 0016, with the region check after the photo is found (as
-- admin_review_profile in 0020).
CREATE OR REPLACE FUNCTION admin_review_photo(photo_id uuid, decision photo_status) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ph profile_photos%ROWTYPE;
  first_name_value text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF admin_review_photo.decision IS NULL OR admin_review_photo.decision = 'pending' THEN
    RAISE EXCEPTION 'mest.invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO ph FROM profile_photos p WHERE p.id = admin_review_photo.photo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  PERFORM assert_admin_covers(ph.profile_id);
  IF ph.status = admin_review_photo.decision THEN
    RAISE EXCEPTION 'mest.review_closed' USING ERRCODE = '23514';
  END IF;

  UPDATE profile_photos p
     SET status = admin_review_photo.decision, reviewed_by = app_uid(), reviewed_at = now()
   WHERE p.id = ph.id;

  SELECT p.first_name INTO first_name_value FROM profiles p WHERE p.id = ph.profile_id;
  IF admin_review_photo.decision = 'approved' THEN
    PERFORM create_notification(
      ph.profile_id, 'profile', 'Your profile photo is approved',
      'Your photo now shows on your profile in place of your initials.',
      '/network/settings/profile', 'photo-reviewed',
      jsonb_build_object('firstName', first_name_value, 'decision', 'approved'), true,
      'profile_photo', ph.id
    );
  ELSE
    PERFORM create_notification(
      ph.profile_id, 'profile', 'Your profile photo was not approved',
      'Your initials show on your profile instead. You can upload a different photo in Settings.',
      '/network/settings/profile', 'photo-reviewed',
      jsonb_build_object('firstName', first_name_value, 'decision', 'rejected'), true,
      'profile_photo', ph.id
    );
  END IF;
  PERFORM write_audit(
    'photo.' || admin_review_photo.decision::text, 'profile', ph.profile_id,
    jsonb_build_object('photo_id', ph.id, 'previous', ph.status::text)
  );
END
$$;

-- From 0016: the owner reads a photo in any state, an administrator any
-- state of a profile in its regions, anyone else an approved photo of a
-- profile they may see.
DROP POLICY profile_photos_read ON profile_photos;
CREATE POLICY profile_photos_read ON profile_photos FOR SELECT TO app_user
  USING (
    profile_access(profile_id) = 'visible'
    AND (status = 'approved' OR profile_id = app_uid() OR admin_covers_profile(profile_id))
  );

-- 2. admin_feedback -------------------------------------------------------------------

-- The return type changes (no kind; a quarter for the month), so the
-- function is dropped and created again, with 0015's privileges.
DROP FUNCTION admin_feedback(int, int);

-- The comments, for administrators for every region: by quarter, newest
-- first, then by id, `size` per page, with the total on every row. Each row
-- says which side wrote it and the quarter it was written; nothing names or
-- points back at a person, and nothing about a relationship the caller was
-- a party to is listed.
CREATE FUNCTION admin_feedback(page int, size int)
RETURNS TABLE (id uuid, author_role text, helpful smallint, comment text, quarter text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_for(NULL) THEN
    RAISE EXCEPTION 'mest.out_of_region' USING ERRCODE = '42501';
  END IF;
  IF admin_feedback.page IS NULL OR admin_feedback.page < 1
     OR admin_feedback.size IS NULL OR admin_feedback.size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'mest.invalid_page' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT q.id, q.author_role, q.helpful, q.comment, q.quarter, count(*) OVER ()
      FROM (
        SELECT f.id,
               CASE WHEN f.author_id = rel.mentee_id THEN 'mentee' ELSE 'mentor' END AS author_role,
               f.helpful,
               f.comment,
               to_char(f.created_at AT TIME ZONE 'America/Chicago', 'YYYY-"Q"Q') AS quarter
          FROM relationship_feedback f
          JOIN mentorship_relationships rel ON rel.id = f.relationship_id
         WHERE f.comment IS NOT NULL
           AND app_uid() NOT IN (rel.mentee_id, rel.mentor_id)
      ) q
     ORDER BY q.quarter DESC, q.id
     LIMIT admin_feedback.size OFFSET (admin_feedback.page - 1) * admin_feedback.size;
END
$$;

REVOKE EXECUTE ON FUNCTION admin_feedback(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_feedback(int, int) TO app_user;

-- 3. The dashboard (re-created from 0015) ---------------------------------------------

-- As in 0015, with the two feedback measures held back until 5 answers and
-- leaving out answers about the caller's own relationships.
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
  -- Answers about the caller's own relationships are left out, and both
  -- measures stay null under 5 answers. A swept member's rating still counts.
  (SELECT CASE WHEN count(*) >= 5 THEN count(*) END
     FROM relationship_feedback f JOIN mentorship_relationships rel ON rel.id = f.relationship_id
    WHERE app_uid() NOT IN (rel.mentee_id, rel.mentor_id))::int AS feedback_responses,
  (SELECT CASE WHEN count(*) >= 5 THEN round(avg(f.helpful), 1) END
     FROM relationship_feedback f JOIN mentorship_relationships rel ON rel.id = f.relationship_id
    WHERE app_uid() NOT IN (rel.mentee_id, rel.mentor_id))::float8 AS feedback_average_helpful
WHERE is_admin();

REVOKE ALL ON admin_dashboard FROM app_user;
GRANT SELECT ON admin_dashboard TO app_user;
