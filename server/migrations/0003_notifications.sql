-- Notifications, email preferences and the email outbox
-- (02-technical-architecture.md sections 4.3, 4.5 and 5.3).
--
-- Every notification is written by `create_notification`, a SECURITY DEFINER
-- function that only other definer functions and system jobs can execute.
-- Email never leaves from a request: `create_notification` (or the sign-in
-- module, for magic links) puts a row in `email_outbox` through
-- `enqueue_email`, and the `send-emails` job renders and sends it. `app_user`
-- cannot read the outbox at all.

CREATE TYPE notification_category AS ENUM (
  'request', 'response', 'reminder', 'profile', 'report', 'account', 'admin_digest'
);

-- notification_preferences ----------------------------------------------------

CREATE TABLE notification_preferences (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id),
  email_requests boolean NOT NULL DEFAULT true,
  email_responses boolean NOT NULL DEFAULT true,
  email_reminders boolean NOT NULL DEFAULT true,
  email_profile boolean NOT NULL DEFAULT true,
  email_reports boolean NOT NULL DEFAULT true,
  email_admin_digest boolean NOT NULL DEFAULT true,
  email_product_updates boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- notifications -----------------------------------------------------------------

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES profiles (id),
  category notification_category NOT NULL,
  subject_type text CHECK (char_length(subject_type) <= 60),
  subject_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 1000),
  -- An in-app path such as /network/me/requests/<id>; never an outside URL.
  link text CHECK (char_length(link) <= 300 AND (link = '/' OR link ~ '^/[^/\\]')),
  template text NOT NULL DEFAULT 'default' CHECK (template ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- What the email template may use. create_notification strips the private
  -- keys (why, goals, scheduling_note, mentor_note, email, phone) on the way in.
  payload jsonb NOT NULL DEFAULT '{}',
  email_status text NOT NULL DEFAULT 'skipped'
    CHECK (email_status IN ('skipped', 'queued', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_recipient_created_idx ON notifications (recipient_id, created_at DESC);
CREATE INDEX notifications_recipient_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

-- email_outbox ----------------------------------------------------------------

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES notifications (id) ON DELETE SET NULL, -- null for magic links
  to_email citext NOT NULL,
  template text NOT NULL CHECK (template ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  payload jsonb NOT NULL DEFAULT '{}',
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text CHECK (char_length(last_error) <= 1000),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- What the send-emails job picks up: unsent rows that have not given up.
CREATE INDEX email_outbox_pending_idx ON email_outbox (created_at) WHERE sent_at IS NULL AND attempts < 3;
-- The deletion sweep removes a member's rows by address.
CREATE INDEX email_outbox_to_email_idx ON email_outbox (to_email);
CREATE INDEX email_outbox_notification_idx ON email_outbox (notification_id);

-- Functions (section 4.5) -------------------------------------------------------

-- Inserts one outbox row and returns its id. Callable only by definer
-- functions (create_notification) and the sign-in module (withSystem); the
-- payload passes through the same private-key filter as the audit log.
CREATE FUNCTION enqueue_email(
  to_email citext,
  template text,
  payload jsonb DEFAULT '{}',
  notification_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  -- Caller check: app_user has no EXECUTE on this function (revoked below),
  -- so only the table owner (definer functions, jobs, the auth module) gets here.
  IF enqueue_email.to_email IS NULL OR char_length(enqueue_email.to_email) = 0 THEN
    RAISE EXCEPTION 'mest.invalid_email' USING ERRCODE = '22023';
  END IF;
  IF enqueue_email.template IS NULL OR enqueue_email.template !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'mest.invalid_template' USING ERRCODE = '22023';
  END IF;
  INSERT INTO email_outbox (notification_id, to_email, template, payload)
  VALUES (
    enqueue_email.notification_id,
    enqueue_email.to_email,
    enqueue_email.template,
    audit_strip_private(coalesce(enqueue_email.payload, '{}'::jsonb))
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

-- Inserts the in-app notification and, when `email` is true, queues the
-- email if the category is `account` (always sent) or the recipient's
-- preference column for that category is on (a recipient with no preference
-- row yet has the column defaults, which are on for every category here).
-- The outbox payload is `{ title, body, link }` overlaid with `payload`, so
-- the `default` template can render any notification.
--
-- `subject_type` and `subject_id` are optional trailing arguments: callers
-- written against the eight-argument form in section 4.5 keep working.
CREATE FUNCTION create_notification(
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
    SELECT CASE create_notification.category
             WHEN 'request' THEN np.email_requests
             WHEN 'response' THEN np.email_responses
             WHEN 'reminder' THEN np.email_reminders
             WHEN 'profile' THEN np.email_profile
             WHEN 'report' THEN np.email_reports
             WHEN 'admin_digest' THEN np.email_admin_digest
             ELSE false
           END
      INTO wants
      FROM notification_preferences np
     WHERE np.profile_id = create_notification.recipient;
    IF NOT FOUND THEN
      wants := true;
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

-- Privileges (section 5.3) ------------------------------------------------------

-- Only definer functions, jobs and the auth module write notifications and email.
REVOKE EXECUTE ON FUNCTION enqueue_email(citext, text, jsonb, uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION
  create_notification(uuid, notification_category, text, text, text, text, jsonb, boolean, text, uuid)
  FROM PUBLIC, app_user;

-- The outbox is for the send-emails job and the deletion sweep only.
REVOKE ALL ON email_outbox FROM app_user;

-- Recipients read, mark read (read_at only) and delete their own notifications.
REVOKE ALL ON notifications FROM app_user;
GRANT SELECT, DELETE ON notifications TO app_user;
GRANT UPDATE (read_at) ON notifications TO app_user;

-- Owners read and change their own preferences; the row is created by
-- complete_onboarding (Task 11).
REVOKE ALL ON notification_preferences FROM app_user;
GRANT SELECT ON notification_preferences TO app_user;
GRANT UPDATE (
  email_requests, email_responses, email_reminders, email_profile,
  email_reports, email_admin_digest, email_product_updates
) ON notification_preferences TO app_user;

-- Row-level security ----------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_recipient_read ON notifications FOR SELECT TO app_user
  USING (recipient_id = app_uid());
CREATE POLICY notifications_recipient_update ON notifications FOR UPDATE TO app_user
  USING (recipient_id = app_uid()) WITH CHECK (recipient_id = app_uid());
CREATE POLICY notifications_recipient_delete ON notifications FOR DELETE TO app_user
  USING (recipient_id = app_uid());

CREATE POLICY notification_preferences_owner_read ON notification_preferences FOR SELECT TO app_user
  USING (profile_id = app_uid());
CREATE POLICY notification_preferences_owner_update ON notification_preferences FOR UPDATE TO app_user
  USING (profile_id = app_uid()) WITH CHECK (profile_id = app_uid());
