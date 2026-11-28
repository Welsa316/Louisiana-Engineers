# MEST Network (Phases 2 to 4) Implementation Plan

> **For agentic workers:** Execute task by task with the same multi-agent wave workflow as Phase 1 (`06-build-plan-phase-1.md`, "Multi-agent workflow"): one implementer per task in its own worktree, an independent reviewer, one repair loop, then integration.

**Goal:** Build the rest of the roadmap (`04-implementation-roadmap.md`, sections 7 to 9) on top of the released Phase 1: scheduling and meetings, feedback, profile photos, vocabulary tooling and a member digest (Phase 2); a calendar feed (Phase 3); regions and chapter administrators (Phase 4).

**Architecture:** Unchanged from Phase 1: one Node/Hono service on Railway with Railway Postgres, row-level security with requests as `app_user` through `withUser`, every state change in a `SECURITY DEFINER` SQL function, email through the outbox. Read `06-build-plan-phase-1.md` (Global Constraints, Review Focus) first: every rule there still applies.

**Spec:** `docs/professional-network/02-technical-architecture.md` (sections 4.3 meetings and availability_slots, 5.3, 5.4, 8) and `04-implementation-roadmap.md` sections 7 to 9.

## Decisions taken for this plan (2026-11-28)

The roadmap gates Phase 2 on two months of use and a board decision, Phase 3 on Phase 2 data, and marks Phase 4 "not planned". The organizer asked for all of it now. These defaults stand until the board decides otherwise:

| Question | Default |
| --- | --- |
| Photo moderation | A photo is visible only after an administrator approves it. Initials stay the default. |
| Photo storage | In Postgres (`bytea`), resized in the browser to at most 512 px and 200 KB, served by the API with cache headers. No new storage account. |
| Calendar | Phase 3 is a private iCal feed per member (a secret URL). No Google Calendar OAuth. |
| Regions | Phase 4 adds a `regions` table seeded with `greater-new-orleans`, a region filter and administrators scoped to one region (a null scope means every region). |
| Error monitoring | Sentry needs an account; it is left out until one exists. |

## Global Constraints (in addition to 06)

- **Migrations** are new files only. Production has applied 0001 to 0013, so never edit those. Numbers are assigned per task below so parallel tasks never collide.
- **Deletion and export.** Every task that stores member data extends `execute_account_deletion` (as a `CREATE OR REPLACE` in its own migration, copied from the latest definition) and the export service, with a test that the sweep leaves no personal field and the export holds only the caller's data.
- **Pushing to main.** After each wave is integrated, every check passes (typecheck, server tests, `npm run e2e`, build), and the wave's review findings are fixed, the integrator fast-forwards `main` to `network-build` and pushes. That deploys to production; nothing half-built is pushed mid-wave.
- **Ports and databases.** The organizer's dev server uses port 8787 and database `mest`; workers use private databases and `E2E_PORT`.

## Tasks

### Task 30: Meetings and availability (schema, functions, routes) — migration `0014_meetings.sql`

**Depends on:** Phase 1.
- Tables `availability_slots` and `meetings` exactly as 02 section 4.3, `slot_status` (`proposed`, `chosen`, `declined`, `withdrawn`), `meeting_status` gains `canceled`. Policies per 02 section 5.3: both parties of the relationship read; writes only through functions.
- Functions: `propose_times(relationship_id, slots jsonb)` (1 to 3 future slots, 15 to 180 minutes, by either party of an active relationship, replacing that party's open proposals); `choose_time(slot_id, mode, place, agenda)` (the other party; declines the batch's other slots, creates the meeting, notifies the proposer, template `meeting-scheduled`); `cancel_meeting(meeting_id)`; `record_meeting_outcome(meeting_id, met boolean)` ("Did you meet?"); `complete_past_meetings(as_of)` for the job; `meeting_prompt(as_of)` notifying both parties a day after `starts_at` (template `meeting-check-in`). All definer, caller checked first.
- Jobs `complete-past-meetings` and `meeting-check-in` (daily). Dashboard: `meetings_held` and `meetings_upcoming`.
- Routes under `/api/relationships/:requestId/{slots,meetings}` and `/api/meetings/:id/{cancel,outcome}`; shared types `shared/types/meetings.ts`.
- Deletion: meetings and slots kept, `place` and `agenda` emptied (02 section 8). Export: meetings and slots, counterparty as display name.
- Tests: propose and choose round trip; only parties read; a third slot batch replaces the first; choosing declines siblings; past meeting completes once; check-in once; sweep empties place and agenda.

### Task 31: Scheduling screens — no migration

**Depends on:** Task 30.
- The relationship card (mentor `features/mentor/Relationship.tsx`, mentee `features/me/RequestDetail.tsx`) gets "Propose times" (up to three date and time pickers), the other party's choice view, the upcoming meeting with cancel, and the "Did you meet?" answer.
- A meetings log at `/network/me/meetings` (nav item) listing upcoming and past meetings for both roles.
- e2e `e2e/meetings.spec.ts` at 375 and 1280, axe on the new screens; route matrix updated.

### Task 32: Post-completion feedback — migration `0015_feedback.sql`

**Depends on:** Phase 1.
- Table `relationship_feedback` (relationship, author, `helpful` 1 to 5, `comment` up to 600), one per author per relationship, written after completion through `leave_feedback(request_id, helpful, comment)`. The other party never reads the comment; administrators read aggregates in the dashboard (average helpfulness, response count) and comments only through `admin_feedback` without author names.
- Screen: after "Mark as completed" (both roles) a two-question form; a notification invites the other party (template `feedback-invite`).
- Deletion: comment emptied; rating kept. Export: own feedback only.

### Task 33: Profile photos with moderation — migration `0016_photos.sql`

**Depends on:** Phase 1.
- Table `profile_photos` (profile, `bytea` image, `content_type` image/jpeg or image/webp, `byte_size` up to 200 000, `status` pending/approved/rejected, `reviewed_by`, timestamps), one current photo per profile. Upload `POST /api/me/photo` (multipart, validated server-side by magic bytes and size), `DELETE /api/me/photo`, serve `GET /api/photos/:profileId` only when approved and the profile is visible to the caller (same rule as the profile), with `Cache-Control: private` for members-only profiles.
- Admin queue `/network/admin/photos` with approve and reject (`admin_review_photo`), audited; the owner is notified (template `photo-reviewed`).
- Client: resize to 512 px before upload; `Monogram` shows the approved photo with the initials as fallback. The photo is of a person: no filters, no tinting, `object-fit: cover` with a centred focal point.
- Deletion: the row is deleted. Export: notes that a photo exists, without the bytes.

### Task 34: Vocabulary tooling — migration `0017_vocabulary_tools.sql`

**Depends on:** Phase 1.
- `admin_merge_tags(from_tag, into_tag)` moves every profile's link, removes duplicates and retires the old tag (audited); `admin_rename_vocabulary(kind, id, label)`; `admin_retire_topic(id)` keeps existing choices but stops offering the topic.
- Admin vocabulary screen gains merge, rename and retire; the directory topic filter and `useTopics()` respect retired topics.

### Task 35: Member weekly digest (opt-in) — migration `0018_member_digest.sql`

**Depends on:** Phase 1.
- Preference `email_member_digest` default false, in Settings, Notifications. Job `member-digest` (daily, sends at most weekly per member) through `member_digest(as_of)`: new professionals in the member's discipline and mentors taking requests for the member's topics, names and titles only (template `member-digest`). Privacy test: no contact value, no request text.

### Task 37: Calendar feed — migration `0019_calendar_feed.sql`

**Depends on:** Task 30.
- `calendar_tokens` (profile, token hash, created, revoked). Settings, Calendar: create, copy and regenerate a private feed URL. `GET /api/calendar/:token.ics` returns the member's upcoming and recent meetings as iCalendar (summary "MEST mentorship: <first name>", no agenda text, no contact values), `Cache-Control: no-store`. Token is 32 random bytes, only its sha256 stored; regenerating revokes the old one.
- Deletion: tokens deleted. Tests: feed shows only the caller's meetings; revoked token 404; output escapes text per RFC 5545.

### Task 38: Regions and chapter administrators — migration `0020_regions.sql`

**Depends on:** Phase 1.
- `regions` (id slug, label, active) seeded with `greater-new-orleans`; `profiles.region` references it. `admin_roles.region_id` (null means every region). `is_admin()` unchanged; new `is_admin_for(region)`; every admin function that acts on a profile checks the profile's region against the caller's scope. Grant screen chooses a scope.
- Directory and admin member filters read regions from `GET /api/config/vocabulary` (regions added). Onboarding and settings offer the region when more than one is active.

### Task 39: Phases 2 to 4 integration and audits — no migration

**Depends on:** all of the above.
- Route matrix, axe and overflow specs cover every new screen; runbook adds photos, the calendar feed, regions and the new jobs; 02 and 04 record what was built; full Codex and privacy audits on the whole Phases 2 to 4 diff, findings fixed, then the final push.
- Decision carried from Task 38's review: administrator reads are still network-wide. A chapter administrator can read every region's profiles (`profiles_admin_read`), student details (`student_details_admin_read`), `profile_reviews_admin_read`, the `admin_reports` view, the dashboard counts and the administrator notifications; only the functions that act on a profile, and the members, review and report lists, are scoped. The privacy audit decides, with the board if needed, whether those reads take `admin_covers_profile(...)` too (student details from other regions first), and records the answer in 02.
- Runbook for regions: `npm run admin:grant -- <email>` acts for every region. On a current chapter administrator it widens the role to every region (status "widened", audited), which is the way back if no administrator for every region can act.

## Waves

| Wave | Tasks (parallel) | Then |
| --- | --- | --- |
| A | 30 meetings schema, 33 photos, 34 vocabulary tools, 38 regions | integrate, all checks, push to main |
| B | 31 scheduling screens, 32 feedback, 35 member digest, 37 calendar feed | integrate, all checks, push to main |
| C | 39 integration and audits | fix findings, all checks, push to main |
