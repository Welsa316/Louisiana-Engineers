-- 0016_photos: profile photos with moderation (Task 33,
-- 07-build-plan-phases-2-4.md; PRO-12).
--
-- A photo lives in Postgres (bytea), resized in the browser to at most 512
-- px and 200 000 bytes, one current photo per profile. It is shown only
-- after an administrator approves it, and only to callers who may see the
-- profile itself (`profile_access`, the same rule as the profile page).
-- Initials stay the default everywhere else.
--
-- Every write is a SECURITY DEFINER function: `set_my_photo` and
-- `delete_my_photo` for the owner, `admin_review_photo` for administrators
-- (audited, and the owner is notified with the `photo-reviewed` template).
-- `app_user` reads rows through the policy below and has no INSERT, UPDATE
-- or DELETE. The API serves approved bytes through `photo_for_profile`.
--
-- Deletion: the sweep deletes the row (execute_account_deletion is
-- re-created below from 0010 with that one addition, plus clearing the
-- leaver's id from photos they reviewed as an administrator).

CREATE TYPE photo_status AS ENUM ('pending', 'approved', 'rejected');

-- profile_photos ----------------------------------------------------------------

CREATE TABLE profile_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One current photo per profile: a new upload replaces the row.
  profile_id uuid NOT NULL UNIQUE REFERENCES profiles (id),
  image bytea NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/webp')),
  byte_size int NOT NULL CHECK (byte_size BETWEEN 1 AND 200000),
  status photo_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_photos_size_is_the_bytes CHECK (byte_size = octet_length(image)),
  -- The same magic numbers the upload route checks: a JPEG starts FF D8 FF;
  -- a WebP is a RIFF container whose form type is WEBP.
  CONSTRAINT profile_photos_bytes_match_type CHECK (
    (content_type = 'image/jpeg' AND substring(image FROM 1 FOR 3) = '\xffd8ff'::bytea)
    OR (content_type = 'image/webp'
        AND substring(image FROM 1 FOR 4) = '\x52494646'::bytea
        AND substring(image FROM 9 FOR 4) = '\x57454250'::bytea)
  ),
  CONSTRAINT profile_photos_reviewed_when_decided CHECK ((status = 'pending') = (reviewed_at IS NULL))
);
-- The administrators' queue: pending photos, oldest first.
CREATE INDEX profile_photos_pending_idx ON profile_photos (created_at) WHERE status = 'pending';
CREATE INDEX profile_photos_reviewed_by_idx ON profile_photos (reviewed_by) WHERE reviewed_by IS NOT NULL;

CREATE TRIGGER profile_photos_set_updated_at BEFORE UPDATE ON profile_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Functions -------------------------------------------------------------------

-- The magic-number rule, once, for set_my_photo (the CHECK above repeats it).
CREATE FUNCTION photo_bytes_match(image bytea, content_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT image IS NOT NULL AND (
    (content_type = 'image/jpeg' AND substring(image FROM 1 FOR 3) = '\xffd8ff'::bytea)
    OR (content_type = 'image/webp'
        AND substring(image FROM 1 FOR 4) = '\x52494646'::bytea
        AND substring(image FROM 9 FOR 4) = '\x57454250'::bytea)
  )
$$;

-- The caller's new photo, replacing any earlier one (approved or not), which
-- then waits for review again. A member in good standing only. Returns the
-- new row's id, which is also the version in the photo's URL.
CREATE FUNCTION set_my_photo(image bytea, content_type text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  new_id uuid;
  size int := octet_length(set_my_photo.image);
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = me) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF size IS NULL OR size < 1 OR size > 200000 THEN
    RAISE EXCEPTION 'mest.photo_too_large' USING ERRCODE = '22023';
  END IF;
  IF NOT photo_bytes_match(set_my_photo.image, set_my_photo.content_type) THEN
    RAISE EXCEPTION 'mest.invalid_photo' USING ERRCODE = '22023';
  END IF;

  DELETE FROM profile_photos ph WHERE ph.profile_id = me;
  INSERT INTO profile_photos (profile_id, image, content_type, byte_size)
  VALUES (me, set_my_photo.image, set_my_photo.content_type, size)
  RETURNING id INTO new_id;
  PERFORM write_audit('photo.uploaded', 'profile', me,
    jsonb_build_object('photo_id', new_id, 'content_type', set_my_photo.content_type, 'byte_size', size));
  RETURN new_id;
END
$$;

-- Removes the caller's photo, whatever its state. Any signed-in owner may,
-- including one whose account is being deleted: taking a photo down only
-- ever shares less. Returns whether there was one.
CREATE FUNCTION delete_my_photo() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  removed uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM profile_photos ph WHERE ph.profile_id = me RETURNING ph.id INTO removed;
  IF removed IS NULL THEN
    RETURN false;
  END IF;
  PERFORM write_audit('photo.removed', 'profile', me, jsonb_build_object('photo_id', removed));
  RETURN true;
END
$$;

-- An administrator approves or rejects a photo. A pending photo takes either
-- decision; a decided one can be changed (an approved photo taken down, a
-- rejection reversed), but the same decision twice is `review_closed`. The
-- owner is notified each time; the entry is audited against their profile.
CREATE FUNCTION admin_review_photo(photo_id uuid, decision photo_status) RETURNS void
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

-- What the API serves at /api/photos/:profileId: the approved photo of a
-- profile the caller may see (`profile_access`, as the profile page), or no
-- row. `shareable` is whether a visitor could see it too, which lets the
-- route mark the answer cacheable by anyone or private to the caller.
CREATE FUNCTION photo_for_profile(profile_id uuid)
RETURNS TABLE (version uuid, image bytea, content_type text, shareable boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF profile_access(photo_for_profile.profile_id) <> 'visible' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT ph.id, ph.image, ph.content_type, profile_listed_access(ph.profile_id, false) = 'visible'
      FROM profile_photos ph
     WHERE ph.profile_id = photo_for_profile.profile_id AND ph.status = 'approved';
END
$$;

-- Privileges and row-level security (02 section 5.3) ----------------------------

REVOKE ALL ON profile_photos FROM app_user;
-- Everything but who reviewed it (that stays in the audit log).
GRANT SELECT (id, profile_id, image, content_type, byte_size, status, reviewed_at, created_at, updated_at)
  ON profile_photos TO app_user;
REVOKE EXECUTE ON FUNCTION photo_bytes_match(bytea, text) FROM PUBLIC, app_user;

ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;

-- The owner and administrators read a photo in any state; anyone else only an
-- approved photo, and only of a profile they may see. Directory cards and the
-- profile page ask for approved photos through this policy.
CREATE POLICY profile_photos_read ON profile_photos FOR SELECT TO app_user
  USING (
    profile_access(profile_id) = 'visible'
    AND (status = 'approved' OR profile_id = app_uid() OR is_admin())
  );

-- The sweep (re-created from 0010) ------------------------------------------------

-- As in 0010, with the photo deleted among the per-member tables and the
-- leaver's id cleared from photos they reviewed as an administrator.

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
