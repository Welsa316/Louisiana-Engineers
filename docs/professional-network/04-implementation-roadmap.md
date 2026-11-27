# Implementation roadmap: Professional Directory, Networking and Mentorship Platform

This document orders the work to build the member platform for Muslim Engineers in Science & Tech (MEST): phases with goals, scope, dependencies, complexity estimates, risks, acceptance criteria, and a feature-by-feature table. Requirements are in [01-product-requirements.md](01-product-requirements.md) (IDs such as REQ-6), the schema and policies in [02-technical-architecture.md](02-technical-architecture.md), the screens in [03-ux-information-architecture.md](03-ux-information-architecture.md), and the undecided items in [05-open-questions.md](05-open-questions.md).

People named as examples come from the prototype's `src/preview/network/data/mock.ts` and are fictional.

## 1. How to read the estimates

Every number in this document is an **estimate**. It assumes one developer who knows React and SQL, working in focused blocks, with a second person available for review and testing. Estimates are given in **volunteer-weeks**: one volunteer-week is roughly 8 to 10 focused hours by one person. A phase estimated at "4 to 6 volunteer-weeks" could be a month for someone with a day a week, or six weeks of evenings.

| Size | Volunteer-weeks (estimate) | Meaning |
| --- | --- | --- |
| S | 0.5 to 1 | A screen or a table with its policy and tests |
| M | 1 to 3 | A feature with several screens, a function and notifications |
| L | 3 to 6 | A subsystem touching schema, policies, functions, several screens and email |

Estimates exclude board decisions, copy review and waiting for accounts (domain, Supabase, Resend, Google OAuth). Those are listed as dependencies because they have blocked projects like this before.

## 2. Phases at a glance

| Phase | Name | Goal | Estimate (volunteer-weeks) |
| --- | --- | --- | --- |
| 1A | Foundations | Supabase project, auth, router, app shell, CI, legal pages | 3 to 5 |
| 1B | Profiles and directory | Onboarding, approval queue, directory, profile pages | 5 to 8 |
| 1C | Mentorship and moderation | Requests, relationships, notifications, reports, audit, dashboard | 6 to 9 |
| 1D | Launch hardening | Accessibility pass, data export and deletion, backups, soft launch | 2 to 4 |
| **MVP total (1A to 1D)** | | | **16 to 26** |
| 2 | Scheduling and meetings | Propose three times, meetings log, feedback, photos | 4 to 7 |
| 3 | Calendar integration | Only if Phase 2 shows demand | 3 to 5 |
| 4 | Regional expansion | Regions table, chapters, chapter administrators | Not estimated; depends on the shape of the expansion |

Phases 1A to 1D together are the first release. They are split so that each has something checkable at the end and so that work can pause between them without leaving a half-built feature in production.

## 3. Phase 1A: Foundations

**Goal.** A signed-in, empty application that is secure, deployed to staging, and tested in CI. Nothing a member would use yet.

**Scope.**

- Supabase projects (staging, production) in us-east; Auth configured for magic link and Google; password sign-up disabled; custom SMTP through Resend.
- Repository layout from the architecture document (`src/network/`, `supabase/migrations/`, `supabase/functions/`, `supabase/tests/`).
- Client router added; the landing page remains the `/` route unchanged; SPA fallback rewrite configured on the host.
- First migration: enums, `profiles` with the `auth.users` trigger, `admin_roles`, `audit_log`, `config`, helper functions `is_member()`, `is_admin()`, RLS enabled on every table.
- App shell: public header with Directory, Sign in, Join; signed-in shell with left rail and mobile bottom bar; route guards.
- Sign-in, join, check-email, sign-out screens.
- Sentry wired with scrubbing.
- CI: typecheck, lint, unit tests, pgTAP against a local Supabase, Playwright smoke on the preview deploy.
- Public pages: Network home (placeholder copy flagged for review), Community guidelines and Privacy notice (drafts flagged for board review).
- Development seed from `mock.ts`.

**Dependencies.** Domain or subdomain decision; Supabase account owned by MEST (not a volunteer's personal account); Resend account and DNS records (SPF, DKIM, DMARC); Google Cloud project for OAuth with MEST as owner; hosting provider that supports the SPA fallback.

**Complexity.** M to L, 3 to 5 volunteer-weeks (estimate). Most of the time is accounts, DNS and CI rather than code.

**Risks and mitigations.**

| Risk | Mitigation |
| --- | --- |
| Accounts created under a volunteer's personal email; access lost when they leave | Every account is created with a MEST-owned address and a second administrator added on day one |
| Email lands in spam | Set up SPF, DKIM and DMARC before sending the first magic link; test with several providers |
| Router change breaks the landing page | The landing page is rendered by the same component at `/`; Playwright asserts its sections and hero still render and the existing anchor links work |

**Acceptance criteria.**

- A new user can join by magic link and by Google on staging, lands in an empty shell, and signs out.
- A pgTAP suite proves an anonymous client can read nothing from `profiles` and an authenticated client can read only their own row.
- The landing page at `/` is pixel-equivalent to the current production page at 375px and 1280px.
- Sentry receives a test error with no email or name in it.
- Both administrators can sign in to the Supabase dashboard; a documented runbook lists every account and who holds it.

## 4. Phase 1B: Profiles and directory

**Goal.** Professionals can create profiles, be approved, and be found. Students can create profiles. No mentorship requests yet.

**Scope.**

- Migrations: `professional_details`, `student_details`, `education`, `disciplines`, `expertise_tags`, `profile_expertise`, `mentorship_topics`, `mentorship_settings`, `mentor_topics`, `contact_preferences`, `saved_profiles`, `profile_reviews`, `notification_preferences`, `notifications` (in-app only this phase), the `directory_entries` view, full-text search column and index. Seed vocabularies from `taxonomy.ts`.
- RLS for all of the above, with pgTAP tests for every row of the "Who can read what" table.
- Functions: `complete_onboarding`, `set_kind`, `save_profile`, `unsave_profile`, `admin_review_profile`, `admin_set_verified`, `touch_last_active`.
- Onboarding steps 1 to 5 with resumable progress; zod schemas shared with the server checks.
- Directory list with filters, search, mentors preset, result cards, visitor and member variants; profile page with the action matrix (actions disabled this phase with "Coming soon" replaced by the real buttons in 1C).
- My profile with preview as visitor and as member; edit screens; settings for visibility, contact and mentorship (settings exist now so profiles are complete when requests arrive).
- Saved profiles.
- Admin: approval queue, review screen, verified mark, members list, vocabulary screens (minimal), administrators screen.
- In-app notifications for profile approved, declined, verified.
- Search engine metadata for `public` profiles; `noindex` everywhere else.

**Dependencies.** Phase 1A. Board decisions on: default visibility for approved professionals, eligibility statement text, policy on members under 18 (the onboarding copy depends on it). The vocabulary review by the board (disciplines, topics) can happen in parallel.

**Complexity.** L, 5 to 8 volunteer-weeks (estimate). Onboarding and the policy test suite are the largest items.

**Risks and mitigations.**

| Risk | Mitigation |
| --- | --- |
| A policy gap exposes a phone number or a student's profile | `contact_preferences` has an owner-only policy and no view exposes it; pgTAP asserts a member cannot read another member's row; code review checklist includes "which policy allows this query" |
| Onboarding is too long and people abandon it | Steps are resumable; required fields are the minimum in the UX document; measure drop-off per step on staging with testers before launch |
| Vocabulary disagreements stall the launch | Ship the `taxonomy.ts` lists; administrators can edit them without a release |
| Approval queue is not worked | Immediate administrator notification when the queue goes from empty to one; the dashboard shows "oldest waiting" |

**Acceptance criteria.**

- Layla Haddad's fictional profile, entered through onboarding on staging, appears in the directory to a visitor; Tariq Mansour's (`members` visibility) appears only when signed in; a `hidden` profile appears to nobody but its owner and administrators.
- A student profile is never returned by any directory query, for any role.
- An administrator approves, declines with notes and verifies a profile; the member sees the notes; the audit log has three entries.
- Filters and search return correct results for every discipline and tag in the seed, checked by Playwright against known seed counts.
- No element overflows the viewport at 375px on the directory, profile and onboarding screens; keyboard-only completion of onboarding is recorded.
- pgTAP: every cell of the "Who can read what" table for the tables in this phase has at least one assertion.

## 5. Phase 1C: Mentorship and moderation

**Goal.** The full request loop with email, the abuse controls, reporting and the dashboard. This is the phase that makes the platform worth launching.

**Scope.**

- Migrations: `mentorship_requests`, `mentorship_relationships`, `reports`, `account_deletions` (table only; flow in 1D), constraints (one pending per pair, 3 pending per mentee, daily rate), `my_requests` and `admin_requests` views, `admin_dashboard` view.
- Functions: `create_mentorship_request`, `cancel_request`, `respond_to_request`, `get_request_handoff`, `complete_relationship`, `report_profile`, `admin_resolve_report`, `admin_grant`, `admin_revoke`.
- Scheduled jobs: `expire_requests`, `send_reminders`, `resume_paused_mentors`, `admin_digest`.
- Edge Function `send-email` triggered by a database webhook on `notifications`; templates for every row of the notification matrix; retry job.
- Mentee screens: request flow (4 steps), request detail with handoff, my requests list, suggested mentors on decline and expiry.
- Mentor screens: inbox with three tabs, incoming request detail, accept sheet with method selection, decline sheet, active relationships with complete, capacity line.
- Profile page actions wired to the real functions, including introduction requests for networking.
- Report a profile dialog; admin reports list and detail with actions (hide, suspend, remove); moderation state on profiles.
- Admin dashboard with the measures from the requirements.
- Notification preferences screen; in-app notification list with read state.
- Home screen blocks: requests waiting for you, your open requests, recent activity.

**Dependencies.** Phase 1B. Resend domain verified (from 1A). Board decisions on: the 14-day expiry and the 3-pending cap (confirm or change the defaults), decline reason list, report reason list, whether in-person meetings get any guidance text in the accept sheet.

**Complexity.** L, 6 to 9 volunteer-weeks (estimate). The request state machine and its tests, the email templates, and the two inboxes are the bulk.

**Risks and mitigations.**

| Risk | Mitigation |
| --- | --- |
| A race lets a mentor exceed `max_active` or a mentee exceed 3 pending | Capacity checks run inside the SQL function with row locks on the mentor's settings row; pgTAP tests exercise concurrent calls |
| Emails leak private details | Templates are reviewed against NOT-4 with a checklist; a unit test renders every template with seed data and asserts no `why`, `goals`, email or phone appears |
| Mentors never answer; requests expire silently | Reminders at day 5 and 10; dashboard surfaces the expiry rate; the board sees it monthly |
| Handoff values shown to the wrong person | `get_request_handoff` is the only path; pgTAP asserts that a mentee of a `pending` or `declined` request, a different member and an administrator all get nothing |
| Report flow used to harass | Rate limit of 3 reports per member per day; the reported member never learns the reporter; repeated dismissed reports from one member are visible to administrators |

**Acceptance criteria.**

- On staging, the fictional request from Amina Rahman to Zainab Qureshi runs end to end: created, mentor emailed, accepted with email shared, mentee emailed, handoff visible to the mentee and to nobody else, relationship counted against capacity, completed, slot freed.
- A fourth pending request from one mentee is refused with the explained message; a second pending request to the same mentor is refused; a request to Fatima Noor (paused) is refused and her profile shows "Not taking new requests right now".
- Setting the clock forward in a test database expires a request, sends the mentee notification and writes the audit entry; reminders fire at day 5 and 10 exactly once each.
- A report on Musa Grant's fictional profile is filed, listed, resolved with "hide profile"; the profile disappears from the directory; the audit log records who and why; the reporter receives a status email without the resolution note.
- Every email template passes the privacy assertion test.
- The dashboard numbers match hand-counted SQL on the seed.
- Screen reader run-through of the request flow and the accept sheet is recorded with no blocking issues.

## 6. Phase 1D: Launch hardening

**Goal.** Make it safe to invite real members.

**Scope.**

- Account deletion flow: request, grace screen, cancel, sweeper job, anonymization; data export Edge Function.
- Rate limits on magic links; session handling checked.
- Backups: paid tier with daily backups, or the weekly `pg_dump` action.
- Accessibility pass against the commitments in the UX document: keyboard, contrast with alpha compositing, screen reader, reduced motion, focus visibility.
- Performance pass: directory first load and search under a slow connection.
- Copy review of every screen and email by a board-authorized administrator; legal pages approved.
- Runbook: accounts, secrets rotation, how to add an administrator, how to restore a backup, how to handle a deletion request by email, how to pause the platform.
- Soft launch: invite 10 to 20 professionals and 5 to 10 students known to the board; two weeks of use; fix list.
- Remove the prototype (`src/preview/`) once the real routes cover it.

**Dependencies.** Phases 1A to 1C. Board sign-off on legal pages and copy. A list of soft-launch invitees.

**Complexity.** M, 2 to 4 volunteer-weeks (estimate), plus the two-week soft launch calendar time.

**Risks and mitigations.**

| Risk | Mitigation |
| --- | --- |
| Deletion sweep breaks foreign keys or deletes aggregate history | Sweep is a single SQL function with a test that runs it against the seed and asserts request counts are unchanged and no name survives |
| Soft launch finds a privacy issue | Soft launch is on production with real data but invitation-only; the "pause the platform" runbook step hides the directory in one config update |
| Nobody uses it during the soft launch | Invitees are people the board knows; a board member asks each for 20 minutes of use and one piece of feedback |

**Acceptance criteria.**

- A test account requests deletion, is hidden immediately, cancels within the grace period and is restored; a second account completes the grace period and is anonymized with requests preserved and no personal field left.
- The export file for the seed's Amina Rahman contains her data and only display names for counterparties.
- Zero WCAG AA failures on the audited screens from an automated run, plus the recorded manual checks.
- Backup restore rehearsed once on staging.
- Soft-launch fix list is empty of anything marked privacy or blocking.

## 7. Phase 2: Scheduling and meetings

**Goal.** Help pairs get from accepted to met, and give the board the "meetings held" measure.

**Scope.** `availability_slots` and `meetings` tables and policies; propose-three-times flow in the relationship card; "Did you meet?" prompt a day after a chosen time; meetings log with status; post-completion feedback (two questions); profile photos with Storage, signed URLs and administrator moderation; directory sorting by last active and experience; vocabulary tooling (merge tags); member weekly digest (optional).

**Dependencies.** MVP in use for at least two months, so the board can see whether mentors without booking links are the ones whose requests stall. Board decision on photo moderation.

**Complexity.** L, 4 to 7 volunteer-weeks (estimate).

**Risks.** Meetings log depends on people filling it in; the prompt after a chosen time is the mitigation. Photos add moderation load; initials avatars stay the default and photos are optional.

**Acceptance criteria.** A pair proposes three times, one is chosen, a meeting appears for both, becomes completed after the time passes, and the dashboard counts it. A photo uploaded by a test account is not visible until an administrator approves it. Existing pairs without meetings are unaffected.

## 8. Phase 3: Calendar integration

**Goal.** Calendar invites and reminders, only if the Phase 2 data shows pairs scheduling through the platform rather than through booking links.

**Scope.** iCal feed per member (low risk, no OAuth) first; Google Calendar OAuth only if the feed is not enough.

**Dependencies.** Phase 2 data; a board decision that the OAuth review and scope are worth it.

**Complexity.** M to L, 3 to 5 volunteer-weeks (estimate), the larger end if Google OAuth verification is required.

**Acceptance criteria.** A meeting created in the platform appears in a subscribed calendar within the feed refresh interval; no calendar data is read from the member's calendar in the iCal approach.

## 9. Phase 4: Regional expansion (possible)

Not planned, not estimated. The schema is ready: `profiles.region` exists from day one with the default `greater-new-orleans`. If a Louisiana or Gulf South network forms, the work is a `regions` table, a region filter in the directory, chapter administrators scoped by region in `admin_roles`, and copy. No existing data changes.

## 10. Recommended order and what can run in parallel

1. **Start the account work first**: domain, Supabase, Resend, Google OAuth, hosting. It is the longest wait and needs no code.
2. **Board decisions needed by 1B** (default visibility, eligibility statement, under-18 policy) should be on the next board agenda, before 1A finishes.
3. **1A, then 1B, then 1C, then 1D**, in order. 1B's admin screens can be built in parallel with its member screens by a second developer, since both sit on the same migrations.
4. **Copy and legal review** run alongside 1C.
5. **Vocabulary review** by the board runs alongside 1B and does not block it.
6. Phase 2 begins only after two months of MVP use and a board read of the dashboard.

## 11. Feature-by-feature table

Complexity and phase are estimates. "Privacy and security" lists the concern the implementer must address, not every control.

| Feature | Purpose | MVP | Complexity | Dependencies | Privacy and security considerations | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| Magic link sign-in | Passwordless accounts | Yes | S | Supabase Auth, Resend SMTP | Rate limit sends; single-use links; no passwords stored | 1A |
| Google sign-in | Alternative sign-in | Yes | S | Google Cloud project | Identity linking by verified email only | 1A |
| Client router and app shell | Navigation per role | Yes | M | Hosting SPA fallback | Route guards are convenience; policies are the gate | 1A |
| Legal pages | Guidelines, privacy notice | Yes | S | Board review | States what is collected and who sees it | 1A |
| CI with pgTAP and Playwright | Prevent regressions, especially in policies | Yes | M | Local Supabase in CI | A failing policy test blocks deploy | 1A |
| Profiles and details tables | Core data | Yes | M | 1A migrations | Email never in public schema; students never listed | 1B |
| Controlled vocabularies | Consistent filters | Yes | S | Seed from taxonomy.ts | Proposed tags visible only on proposer's profile until approved | 1B |
| Onboarding (5 steps) | Complete profiles | Yes | L | Zod schemas, functions | Each field labelled public, members or private in the UI | 1B |
| Three independent settings | Visibility, contact, mentorship | Yes | M | contact_preferences, mentorship_settings | Owner-only read on contact values | 1B |
| Approval queue | Trust in the directory | Yes | M | profile_reviews, admin screens | Snapshot stored; sign-up domain shown, not the address | 1B |
| Soft verification | Verified mark | Yes | S | Approval queue | Method recorded; no documents | 1B |
| Directory list, filters, search | Find people | Yes | L | directory_entries view, GIN index | View excludes contact columns; visitor sees `public` only | 1B |
| Profile page | See a person | Yes | M | Directory | Action matrix by viewer; never shows contact values | 1B |
| Saved profiles | Come back later | Yes | S | | Saved person never learns who saved them | 1B |
| Admin members and administrators | Manage people and roles | Yes | M | admin_roles | Two-administrator minimum; every action audited | 1B |
| In-app notifications | Record of events | Yes | S | notifications table | Recipient-only read | 1B |
| Search engine metadata | Public profiles discoverable | Yes | S | Hosting prerender or runtime meta | `noindex` for members, hidden, students, app routes | 1B |
| Mentorship requests | The core loop | Yes | L | mentorship_requests, functions | Caps, expiry, rate limit in SQL; status transitions server-side | 1C |
| Accept with handoff | Reveal only chosen methods | Yes | M | mentorship_relationships, get_request_handoff | Single release path, logged | 1C |
| Decline with reason | Honest answers | Yes | S | respond_to_request | Reason shown to mentee; nothing else | 1C |
| Capacity accounting | Protect mentors | Yes | S | relationships | Row lock on settings during accept | 1C |
| Expiry and reminders | Nobody waits forever | Yes | M | pg_cron | Mentor is reminded; mentee is told on expiry | 1C |
| Email notifications | Reach people where they are | Yes | M | Resend, Edge Function, webhook | No private details in emails; preferences respected; retries | 1C |
| Notification preferences | Control volume | Yes | S | | Account emails cannot be disabled | 1C |
| Introduction requests (networking) | Contact without mentorship | Yes | S | Request flow | Same caps and privacy as mentorship requests | 1C |
| Report a profile | Members police the directory | Yes | M | reports, admin screens | Reporter hidden from reported; rate limited | 1C |
| Moderation actions | Hide, suspend, remove | Yes | M | admin_resolve_report | Every action audited; member told without reporter identity | 1C |
| Audit log | Accountability | Yes | S | | Append-only; no contact values in detail | 1C |
| Admin dashboard | Observable measures | Yes | M | admin_dashboard view | Aggregates only | 1C |
| Home screen | What needs attention | Yes | S | Requests, notifications | Shows only the viewer's own items | 1C |
| Account deletion with grace | Right to leave | Yes | M | account_deletions, sweeper | Anonymization preserves aggregates; auth row deleted | 1D |
| Data export | Data ownership | Yes | S | Edge Function | Counterparties reduced to display names | 1D |
| Backups | Recovery | Yes | S | Paid tier or scheduled dump | Dump stored in a MEST-owned private location | 1D |
| Accessibility pass | WCAG 2.2 AA | Yes | M | All screens | | 1D |
| Runbook | Volunteer continuity | Yes | S | | Lists every account and who holds it | 1D |
| Propose three times | Lightweight scheduling | No | M | availability_slots | Both parties only | 2 |
| Meetings log | Evidence of meetings | No | M | meetings | Both parties; admin sees counts | 2 |
| Post-completion feedback | Program quality | No | S | relationships | Answers visible to administrators in aggregate | 2 |
| Profile photos | Recognition | No | M | Storage, moderation | Private bucket, signed URLs, admin approval | 2 |
| Directory sorting | Better browsing | No | S | last_active_at | last active shown as a band, not a timestamp | 2 |
| Member weekly digest | Re-engagement | No | S | Edge Function | Opt in | 2 |
| iCal feed | Calendar reminders | No | M | meetings | Per-member secret URL, revocable | 3 |
| Google Calendar | Invites | No | L | OAuth verification | Minimal scopes; only if demanded | 3 |
| Regions and chapters | Expansion | No | Not estimated | profiles.region | Chapter administrators scoped by region | 4 |

## 12. Cross-phase risks

| Risk | Why it matters here | Mitigation |
| --- | --- | --- |
| Volunteer turnover mid-build | The most likely way this project stalls | Everything in the repository; phases end in a shippable state; the runbook and these documents are kept current as part of each phase's acceptance |
| Scope creep toward a social network | Each added surface is a moderation duty | The non-goals list in the requirements; new features need a board decision and an entry in this roadmap |
| Supabase free-tier pause | A sleeping directory looks broken | Paid tier from the soft launch, or a keep-alive job if the board declines the cost |
| Board decisions arrive late | 1B and 1C have copy and defaults that depend on them | Decisions are listed per phase above and in [05-open-questions.md](05-open-questions.md); the defaults recommended there are used if no decision arrives, and are changeable in the `config` table |
| Low supply of mentors at launch | A directory with three mentors disappoints students | Soft launch recruits professionals first; the student invitation follows once at least 15 approved mentors across several disciplines are listed (a target the board should confirm) |
| Privacy incident | Trust is the whole product | Policies tested in CI; single release path for contact values; the "pause the platform" runbook step; a written incident response (who is told, within what time) drafted in 1D |

## 13. What the board sees at the end of each phase

Each phase ends with a short demonstration on staging so the board can judge progress without reading code. The estimates assume these demonstrations happen; skipping them is how a project drifts from what was asked.

| Phase end | Demonstration | Decision the board makes |
| --- | --- | --- |
| 1A | Join by magic link and Google; empty shell; landing page unchanged | Confirm the domain and the accounts list in the runbook |
| 1B | Three fictional professionals go through onboarding, the queue and the directory at the three visibility levels | Confirm default visibility and the vocabulary; approve the eligibility statement |
| 1C | One request runs from creation to completion with real emails to test inboxes; one report is handled | Confirm expiry, caps and the decline and report reason lists; approve email copy |
| 1D | Deletion and export on a test account; accessibility results; the soft-launch invitee list | Approve the legal pages; approve the soft launch |
| 2 | A pair schedules through proposed times and logs a meeting | Decide whether Phase 3 is worth it from the meetings data |

## 14. Definition of done for any phase

- Migrations applied to staging and production in order; no manual dashboard changes.
- pgTAP suite green, with new assertions for every new table and function.
- Playwright smoke green on the preview deploy at 375px and 1280px.
- Manual keyboard and screen reader pass on the new screens recorded in the pull request.
- Copy on new screens and emails reviewed by a board-authorized administrator.
- Runbook and these documents updated for anything that changed.
- The prototype under `src/preview/` either still runs or has been removed deliberately; it is never left half-broken.
