import { renderAdminDigest } from "./admin-digest";
import { renderDeletionCanceled } from "./deletion-canceled";
import { renderDeletionRequested } from "./deletion-requested";
import { renderFeedbackInvite } from "./feedback-invite";
import { renderMeetingCheckIn } from "./meeting-check-in";
import { renderMeetingScheduled } from "./meeting-scheduled";
import { renderModerationAction } from "./moderation-action";
import { renderPhotoReviewed } from "./photo-reviewed";
import { renderProfileApproved } from "./profile-approved";
import { renderProfileDeclined } from "./profile-declined";
import { renderProfileSubmitted } from "./profile-submitted";
import { renderProfileVerified } from "./profile-verified";
import { registerTemplate } from "./registry";
import { renderReportReceived } from "./report-received";
import { renderReportStatus } from "./report-status";
import { renderRequestAccepted } from "./request-accepted";
import { renderRequestDeclined } from "./request-declined";
import { renderRequestExpired } from "./request-expired";
import { renderRequestReceived } from "./request-received";
import { renderRequestReminder } from "./request-reminder";

/**
 * Registers every named email template. Import this once wherever mail is
 * rendered (the outbox sender does); `registry.ts` itself registers only
 * `default` and `magic-link`.
 */
registerTemplate("request-received", renderRequestReceived);
registerTemplate("request-reminder", renderRequestReminder);
registerTemplate("request-accepted", renderRequestAccepted);
registerTemplate("request-declined", renderRequestDeclined);
registerTemplate("request-expired", renderRequestExpired);
registerTemplate("profile-submitted", renderProfileSubmitted);
registerTemplate("profile-approved", renderProfileApproved);
registerTemplate("profile-declined", renderProfileDeclined);
registerTemplate("profile-verified", renderProfileVerified);
registerTemplate("report-received", renderReportReceived);
registerTemplate("report-status", renderReportStatus);
registerTemplate("moderation-action", renderModerationAction);
registerTemplate("deletion-requested", renderDeletionRequested);
registerTemplate("deletion-canceled", renderDeletionCanceled);
registerTemplate("admin-digest", renderAdminDigest);
registerTemplate("meeting-scheduled", renderMeetingScheduled);
registerTemplate("meeting-check-in", renderMeetingCheckIn);
registerTemplate("photo-reviewed", renderPhotoReviewed);
registerTemplate("feedback-invite", renderFeedbackInvite);
