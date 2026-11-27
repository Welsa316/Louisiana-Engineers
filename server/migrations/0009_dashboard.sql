-- 0009_dashboard: the mentorship activity measures (01 section 8) on the
-- administrators' dashboard. Aggregates only: no row names a person, and no
-- request text is read.
--
-- Definitions, all over mentorship requests (introductions are counted on
-- their own and nowhere else):
--   requests sent             every mentorship request ever created
--   answered within 7 days    accepted or declined (completed ones were
--                             accepted) within 7 days of creation, out of the
--                             requests whose first 7 days are over or that
--                             were answered; canceled requests and declines
--                             recorded for a departing member are left out
--                             of both sides, since no mentor answered them
--   acceptance rate           accepted (with completed) / accepted + declined,
--                             the departing-member declines left out
--   expiry rate               expired, out of every request no longer pending
--   active relationships      relationships not yet completed
--   completed relationships   relationships that ended
--   median hours to approval  submission to decision, decided reviews
--   paused mentors            mentorship `paused` now, with the median of how
--                             long each has been paused (paused_at below)
--   members inactive 6 months last activity, or sign-up for a member never
--                             seen since, more than 6 months ago
--   requests by topic         most requested first
--   by month                  the last three calendar months in
--                             America/Chicago, oldest first
-- Active mentors now also need a free slot, as 01 section 8 defines them.
-- Rates are whole percentages and medians one decimal; both are null while
-- there is nothing to count.

-- When the current pause began ------------------------------------------------------------

-- Set when an offer becomes paused and kept while it stays paused, including
-- while an administrator's hide holds it as previous_status (it comes back
-- paused); cleared when the pause ends. Not granted to app_user: only the
-- dashboard reads it.
ALTER TABLE mentorship_settings ADD COLUMN paused_at timestamptz;

CREATE FUNCTION mentorship_settings_track_pause() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'paused' OR NEW.previous_status = 'paused' THEN
    NEW.paused_at := coalesce(NEW.paused_at, now());
  ELSE
    NEW.paused_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER mentorship_settings_track_pause BEFORE INSERT OR UPDATE ON mentorship_settings
  FOR EACH ROW EXECUTE FUNCTION mentorship_settings_track_pause();

-- Offers paused before this migration: the last change is the best date there is.
UPDATE mentorship_settings SET paused_at = updated_at
 WHERE status = 'paused' OR previous_status = 'paused';

-- The dashboard ---------------------------------------------------------------------------

-- Re-created from 0007 with the request measures appended. The first five
-- columns keep their names and order; active_mentors now needs a free slot.
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
     FROM months mo) AS by_month
WHERE is_admin();

REVOKE ALL ON admin_dashboard FROM app_user;
GRANT SELECT ON admin_dashboard TO app_user;
