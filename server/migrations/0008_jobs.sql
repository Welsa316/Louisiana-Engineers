-- The weekly administrator digest (02-technical-architecture.md sections
-- 4.5 and 4.6; Task 21). The request lifecycle functions the other jobs call
-- live in 0005; this file adds only admin_digest().
--
-- The admin-digest job runs daily, and the scheduler stamps its own
-- job_runs row after every run, so that row cannot say when a digest last
-- went out. admin_digest() keeps that on a row of its own,
-- 'admin-digest.sent' (a name the scheduler cannot register, since job
-- names have no dots), and checks it under a row lock, so two processes
-- running the job at once still send one digest a week.

CREATE FUNCTION admin_digest(as_of timestamptz DEFAULT now()) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  at timestamptz := coalesce(as_of, now());
  last_sent timestamptz;
  queue_size int;
  open_reports int;
  waiting int;
  oldest timestamptz;
  payload jsonb;
  body text;
  admin_id uuid;
  notified int := 0;
BEGIN
  -- System context only (the job, through withSystem); app_user has no
  -- EXECUTE either.
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO job_runs (job) VALUES ('admin-digest.sent') ON CONFLICT (job) DO NOTHING;
  SELECT jr.last_run_at INTO last_sent FROM job_runs jr WHERE jr.job = 'admin-digest.sent' FOR UPDATE;
  IF last_sent IS NOT NULL AND last_sent > at - interval '7 days' THEN
    RETURN NULL;
  END IF;

  -- What the review queue lists: every open review.
  SELECT count(*)::int INTO queue_size FROM profile_reviews r WHERE r.decision IS NULL;
  SELECT count(*)::int INTO open_reports FROM reports rep WHERE rep.status = 'open';
  SELECT count(*)::int, min(r.created_at) INTO waiting, oldest
    FROM mentorship_requests r WHERE r.status = 'pending';

  -- Counts and a date only; no names, no request text. Dates are Louisiana
  -- days, as request_payload states them.
  payload := jsonb_strip_nulls(jsonb_build_object(
    'queueSize', queue_size,
    'openReports', open_reports,
    'requestsWaiting', waiting,
    'oldestWaitingOn', to_char(oldest AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD'),
    'link', '/network/admin'
  ));
  body := 'Profiles waiting for review: ' || queue_size
       || '. Open reports: ' || open_reports
       || '. Requests waiting for a reply: ' || waiting || '.';

  -- The administrators notify_admins reaches: an unrevoked role on an
  -- account that is neither suspended nor deleted.
  FOR admin_id IN
    SELECT a.profile_id
      FROM admin_roles a JOIN users u ON u.id = a.profile_id
     WHERE a.revoked_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
     ORDER BY a.profile_id
  LOOP
    PERFORM create_notification(
      admin_id, 'admin_digest',
      'Your weekly MEST Network summary',
      body,
      '/network/admin',
      'admin-digest',
      payload,
      true
    );
    notified := notified + 1;
  END LOOP;

  UPDATE job_runs jr SET last_run_at = at WHERE jr.job = 'admin-digest.sent';
  RETURN notified;
END
$$;

REVOKE EXECUTE ON FUNCTION admin_digest(timestamptz) FROM PUBLIC, app_user;
