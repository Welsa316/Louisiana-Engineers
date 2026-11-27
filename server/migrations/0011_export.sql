-- 0011_export: the caller's own audit entries for the personal data export
-- (Task 27, ACC-7). audit_log is readable by administrators only and the
-- export route runs as the member, so the entries about the caller come
-- through this definer function instead.
--
-- Numbered 0011 so it never collides with 0010_deletions (Task 26), which is
-- written in parallel; the runner applies any unrecorded file in name order.
--
-- Only entries whose subject is the caller. Who acted is reduced to 'you',
-- 'system' (a job or the seed) or 'other' (an administrator or another
-- member): another person's id never leaves through the export. The detail
-- was stripped of private keys when it was written; it is stripped again
-- here so a row that reached the table another way cannot carry one out.

CREATE FUNCTION my_audit_entries()
RETURNS TABLE (id bigint, action text, subject_type text, actor text, detail jsonb, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id,
         a.action,
         a.subject_type,
         CASE
           WHEN a.actor_id IS NULL THEN 'system'
           WHEN a.actor_id = app_uid() THEN 'you'
           ELSE 'other'
         END,
         audit_strip_private(a.detail),
         a.created_at
    FROM audit_log a
   WHERE app_uid() IS NOT NULL
     AND a.subject_id = app_uid()
   ORDER BY a.created_at, a.id
$$;

REVOKE EXECUTE ON FUNCTION my_audit_entries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_audit_entries() TO app_user;
