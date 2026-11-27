# Product requirements: Professional Directory, Networking and Mentorship Platform

Muslim Engineers in Science & Tech (MEST) is a volunteer-run professional and community organization in Greater New Orleans, Louisiana. This document describes what the member platform must do. It is the product side of the plan; the technical design is in [02-technical-architecture.md](02-technical-architecture.md), the screens and flows in [03-ux-information-architecture.md](03-ux-information-architecture.md), the build order in [04-implementation-roadmap.md](04-implementation-roadmap.md), and the undecided points in [05-open-questions.md](05-open-questions.md).

People and organizations named as examples in this document (for instance Layla Haddad of Crescent Coastal Engineering, or the student Amina Rahman) come from the prototype's `src/preview/network/data/mock.ts` and are fictional.

## 1. Platform vision

MEST's mission names three activities: connect, mentor, advance. Today the public site can describe them but cannot do them. A member who wants to find a Muslim coastal engineer in New Orleans, or a student who wants someone to review a resume before an internship deadline, has no route except asking around at an event.

The platform gives MEST three capabilities:

1. **A professional directory.** Professionals in engineering, science and technology who choose to be listed can be found by discipline, expertise, location and what they are open to (networking, mentoring, speaking, volunteering, collaborating).
2. **A mentorship request flow.** Students and early-career members ask a specific professional for help on a specific topic. The professional accepts or declines. Nothing personal is shared until they accept, and only what they chose to share.
3. **Administration for a volunteer board.** Approve professionals before they appear, verify affiliations, handle reports, and see enough activity to know whether the program is working, all without reading private data they do not need.

The guiding rule for every feature is **private by default, opt in to more**. A professional controls three independent things: whether they appear in the directory, whether people can contact them and how, and whether they mentor. None of these implies another.

The platform starts with Greater New Orleans. The data model carries a region on every profile so a larger Louisiana or Gulf South network can be added later without starting over.

## 2. Target audiences

| Audience | Who they are | What they want from the platform |
| --- | --- | --- |
| Students | High school seniors, undergraduates and graduate students in STEM programs in the region (for example Idris Fofana, a high school senior deciding on an engineering major, or Hamza Ali, a first-year MS student) | Find a professional in the field they are considering; get specific help: choosing a major, a resume review, an internship lead, a licensure question |
| Early-career professionals | Working zero to five years (for example Leen Saleh, two years into agency web development, who wants to move into product engineering) | Guidance on offers, interviews and career moves; peers and seniors in their discipline |
| Established professionals | Engineers, scientists, technologists and academics in the region (for example Layla Haddad, PE, a senior coastal engineer, or Yahya Abdullah, an associate professor of physics) | Be found by the right people; give back on their own terms and within limits they set; meet peers across disciplines |
| MEST administrators | Board-authorized volunteers | Approve profiles, keep the directory trustworthy, handle complaints, see whether mentorship is happening |
| Public visitors | Prospective members, employers, partner organizations | Understand what the network is and see the public portion of the directory |

Students and professionals are not fixed categories. A professional may ask for mentorship (Leen Saleh is early career and a mentee), and a student becomes a professional when they start working. The platform treats "student" and "professional" as a profile kind that can change, not a permanent account type.

## 3. Primary workflows

| # | Workflow | Who | Outcome |
| --- | --- | --- | --- |
| W1 | Join and create a profile | Student or professional | A verified account with a profile. Students are listed to mentors they contact; professionals enter the approval queue |
| W2 | Browse and search the directory | Visitor or member | A list of professionals matching discipline, expertise, location, participation and mentorship filters; a profile page per professional |
| W3 | Request mentorship | Mentee | A pending request to one mentor on one topic, with a reason and goals, and an expiry 14 days out |
| W4 | Answer a request | Mentor | Accept (with a note and chosen handoff: booking link, email or LinkedIn) or decline (with an optional reason) |
| W5 | Meet and follow up | Mentor and mentee | Contact outside the platform using the handoff; mark the relationship completed when done |
| W6 | Manage visibility, contact and mentorship settings | Professional | Directory visibility, contact methods, mentorship status and capacity, all changeable at any time |
| W7 | Approve a professional | Administrator | A decision (approved or declined) with notes, and optional affiliation verification |
| W8 | Handle a report | Administrator | A resolved or dismissed report, with any action taken on the profile recorded in an audit log |
| W9 | Leave | Any member | Self-service deletion with a 14-day grace period |

## 4. User roles and permissions

### 4.1 Roles

The prototype's `Role` type is `visitor | mentee | mentor | admin`. In the real system these map to one account with a profile kind and a set of settings:

| Role | Definition | How it is obtained |
| --- | --- | --- |
| Public visitor | Anyone not signed in | None |
| Student / mentee | A signed-in member whose profile kind is `student`, or any member acting as the requester of mentorship | Sign up, verify email, complete the student onboarding. Self-serve; no approval queue |
| Professional directory member | A signed-in member whose profile kind is `professional` and whose profile has been approved | Sign up, verify email, complete the professional onboarding, approved by an administrator |
| Mentor | A professional whose mentorship status is `active` (or `paused`, in which case they keep the role but take no new requests) | Turn mentorship on in settings and complete the mentorship section (topics, audience, format, mode, availability, duration, maximum active mentees) |
| Administrator | A board-authorized volunteer | Granted in the `admin_roles` table by an existing administrator; the first administrator is created during setup |

A professional can also act as a mentee. A student cannot be a mentor. An administrator is also an ordinary member with their own profile; administrative rights are a separate grant, not a profile kind.

### 4.2 Permissions matrix

Legend: Y = allowed, O = own records only, C = counterparty only (the other side of an accepted request), A = after approval, dash = not allowed.

| Capability | Visitor | Student / mentee | Professional | Mentor | Administrator |
| --- | --- | --- | --- | --- | --- |
| View public directory entries (visibility `public`) | Y | Y | Y | Y | Y |
| View members-only entries (visibility `members`) | - | Y | Y | Y | Y |
| View hidden entries (visibility `hidden`) | - | - | O | O | Y |
| View a professional's email or phone | - | C | C | O | Y (only when handling a report) |
| View a student's profile | - | O | - | C (the student requested them) | Y |
| Create or edit own profile | - | O | O | O | O |
| Appear in the directory | - | - | A | A | A |
| Save a profile to a personal list | - | Y | Y | Y | Y |
| Send a mentorship request | - | Y | Y | Y | Y |
| Receive mentorship requests | - | - | - | Y | - |
| Accept or decline a request | - | - | - | O | - |
| Cancel a pending request | - | O | O | O | - |
| Mark a relationship completed | - | O | O | O | Y |
| Set directory visibility, contact methods, mentorship settings | - | - | O | O | O |
| Pause or stop mentoring | - | - | - | O | - |
| Report a profile | - | Y | Y | Y | Y |
| Review the approval queue, approve or decline | - | - | - | - | Y |
| Mark an affiliation verified | - | - | - | - | Y |
| Hide or unlist a profile for moderation | - | - | - | - | Y |
| Resolve or dismiss reports | - | - | - | - | Y |
| Grant or revoke administrator rights | - | - | - | - | Y |
| Read the audit log | - | - | - | - | Y |
| Export own data | - | O | O | O | O |
| Delete own account | - | O | O | O | O |
| Delete another account | - | - | - | - | Y (with audit entry) |

Administrators do not get a general view of email addresses and phone numbers. They see contact details only when the specific task requires it (a report about that profile, a deletion request), and the access is logged.

## 5. Functional requirements

Requirements are numbered for cross-reference from the roadmap. "Must" marks the first release (MVP); "Later" marks a later phase.

### 5.1 Accounts and authentication (ACC)

| ID | Requirement | Scope |
| --- | --- | --- |
| ACC-1 | Sign up and sign in with an email magic link (passwordless). MEST stores no passwords | Must |
| ACC-2 | Sign in with Google as an alternative | Must |
| ACC-3 | Email verification is required before any profile is visible to anyone, including administrators' queues | Must |
| ACC-4 | An account has exactly one profile. The profile kind is `student` or `professional` and can be changed by the owner; changing to `professional` enters the approval queue | Must |
| ACC-5 | Sessions expire; signing out on one device does not affect others. The member can see and end their sessions | Later |
| ACC-6 | Self-service account deletion with a 14-day grace period; the profile disappears immediately; the member can cancel within the grace period by signing in | Must |
| ACC-7 | Self-service export of all personal data as a downloadable file | Must |
| ACC-8 | Rate limiting on sign-in attempts and on magic-link requests per address | Must |

### 5.2 Profiles (PRO)

| ID | Requirement | Scope |
| --- | --- | --- |
| PRO-1 | Every profile has: first and last name, optional credentials (PE, PhD, MD), region (default Greater New Orleans), location (city and state), short bio, optional links (LinkedIn, personal site), created and updated timestamps | Must |
| PRO-2 | Professional details: title, organization, one discipline from the controlled list, years of experience, expertise tags, interests, education entries, participation options | Must |
| PRO-3 | Student details: program, level (high school, undergraduate, graduate, early career, mid-career), institution, goals, interests, topics needed | Must |
| PRO-4 | Disciplines come from a controlled vocabulary in three groups (Engineering, Science, Technology), matching `taxonomy.ts`. Members choose, they do not type | Must |
| PRO-5 | Expertise tags are chosen from a curated list with suggestions; a member may propose a new tag, which is visible on their profile immediately and appears in filters only after an administrator approves it | Must (proposal flow may be Later; see open questions) |
| PRO-6 | Participation options: professional directory, open to networking, mentorship, volunteering, speaking at events, collaborating on projects. Any combination | Must |
| PRO-7 | Directory visibility per professional: `public` (anyone), `members` (signed-in members only), `hidden` (nobody; the profile still exists and the member can still send requests) | Must |
| PRO-8 | Contactability per professional: allow contact requests yes or no, and which methods: requests through MEST, email, LinkedIn, scheduling link, phone or text. "Requests through MEST" is on by default for everyone | Must |
| PRO-9 | Mentorship per professional: `off`, `active` or `paused` with an optional resume date. When active: topics offered, audiences, format (one-time, recurring, either), mode (online, in person, either), availability text, session length (30, 45 or 60 minutes), maximum active mentees (default 3) | Must |
| PRO-10 | The three settings in PRO-7, PRO-8 and PRO-9 are independent. A hidden professional can mentor people who already know them; a public professional can refuse all contact; a listed, contactable professional can have mentorship off | Must |
| PRO-11 | A profile shows a "verified affiliation" mark when an administrator has confirmed the organization (by work-email domain or LinkedIn). No document upload | Must |
| PRO-12 | Profile photo upload with moderation; initials avatar by default | Later |
| PRO-13 | A member can preview their profile as a visitor and as a member | Must |

### 5.3 Directory (DIR)

| ID | Requirement | Scope |
| --- | --- | --- |
| DIR-1 | List approved professionals the viewer is allowed to see, newest first by default, with name, credentials, title, organization, discipline, location, verified mark and participation badges | Must |
| DIR-2 | Filters: discipline group and discipline, expertise tag, location, participation option, mentorship (active only), experience band, verified only | Must |
| DIR-3 | Keyword search across name, title, organization, expertise and bio | Must |
| DIR-4 | A profile page per professional showing everything the viewer is allowed to see. Contact details never appear here; the page offers "Request mentorship" (if mentoring and accepting) or "Request an introduction" (if open to networking), or neither | Must |
| DIR-5 | Visitors who are not signed in see only `public` entries and are invited to sign in to see more and to contact anyone | Must |
| DIR-6 | A "mentors" preset of the directory showing professionals with active mentorship, filterable by topic and audience | Must |
| DIR-7 | Students do not appear in the directory. A mentor sees a student's profile only when that student has sent them a request | Must |
| DIR-8 | Members can save profiles to a private list | Must |
| DIR-9 | Directory pages have search-engine metadata only for `public` entries; `members` and `hidden` entries are never indexable | Must |
| DIR-10 | Sorting by last active and by years of experience | Later |

### 5.4 Mentorship requests (REQ)

| ID | Requirement | Scope |
| --- | --- | --- |
| REQ-1 | A signed-in member sends a request to one mentor with: one topic from the mentor's offered topics, why they are asking, what they hope to get, preferred format (one-time or recurring), preferred mode (online, in person, either), optional scheduling note | Must |
| REQ-2 | A request is `pending` on creation and expires 14 days later if unanswered (`expired`) | Must |
| REQ-3 | The mentor is notified on creation and reminded at day 5 and day 10 if still pending | Must |
| REQ-4 | A mentee may have at most 3 `pending` requests at once, and at most one pending request per mentor | Must |
| REQ-5 | A mentor with mentorship `paused` or `off`, or who has reached their maximum active mentees, cannot receive new requests; the profile page says so without blaming anyone ("Not taking new requests right now") | Must |
| REQ-6 | The mentor can accept with an optional note and must choose which of their enabled handoff methods to share (booking link, email, LinkedIn, phone). Acceptance creates a relationship (REL-1) | Must |
| REQ-7 | The mentor can decline with an optional reason that is shown to the mentee, chosen from a short list plus free text ("Outside my expertise", "No capacity right now", "Not a fit") | Must |
| REQ-8 | The mentee can cancel a pending request (`canceled`) | Must |
| REQ-9 | Statuses are exactly: `pending`, `accepted`, `declined`, `completed`, `canceled`, `expired`. Transitions are enforced server-side | Must |
| REQ-10 | Rate limiting on request creation (per member per day) in addition to the pending cap | Must |
| REQ-11 | Request creation is blocked for members whose profile is not verified (email) or who are under moderation | Must |

### 5.5 Relationships and meetings (REL)

| ID | Requirement | Scope |
| --- | --- | --- |
| REL-1 | Accepting a request creates a mentorship relationship linking mentor and mentee, with the accepted topic, the shared handoff methods and the mentor's note | Must |
| REL-2 | The mentee sees the handoff (for example a booking link or email) only inside the accepted request, never on the profile page | Must |
| REL-3 | Either side can mark the relationship `completed`. Completion frees a slot against the mentor's maximum active mentees | Must |
| REL-4 | A relationship counts against the mentor's maximum while it is active. Mentors see "2 of 3 active" in their settings | Must |
| REL-5 | Lightweight scheduling: the mentee or mentor proposes up to three times; the other side picks one or asks for others | Phase 2 |
| REL-6 | Meetings log: a list of meetings per relationship with start time, duration, mode, place, agenda and status (`upcoming`, `completed`) | Phase 2 |
| REL-7 | Calendar integration (Google Calendar, iCal feed) | Phase 3, only if demand shows |
| REL-8 | Optional short feedback from mentee and mentor after completion (did the meeting happen, was it useful) | Phase 2 |

### 5.6 Notifications (NOT)

| ID | Requirement | Scope |
| --- | --- | --- |
| NOT-1 | Email notifications for the events listed in the notification matrix in [03-ux-information-architecture.md](03-ux-information-architecture.md): request received, reminder at day 5 and 10, accepted, declined, expired, profile approved or declined, report outcome for the reporter, deletion scheduled | Must |
| NOT-2 | An in-app notifications list with read state | Must |
| NOT-3 | Notification preferences per member: email on or off per category; the in-app list cannot be turned off; account and security emails cannot be turned off | Must |
| NOT-4 | Emails contain no private details of the other party. "You have a new mentorship request from a student at a Louisiana university" with a link, not the student's goals | Must |
| NOT-5 | Weekly digest for administrators: queue size, open reports, requests pending more than 7 days | Must |
| NOT-6 | Weekly digest for members (new mentors in your discipline) | Later |

### 5.7 Administration and moderation (ADM)

| ID | Requirement | Scope |
| --- | --- | --- |
| ADM-1 | Approval queue listing professional profiles awaiting review, oldest first, with the full profile as the member submitted it | Must |
| ADM-2 | Approve or decline with notes. Declining sends the member the notes and lets them edit and resubmit | Must |
| ADM-3 | Mark affiliation verified, with the method recorded (work-email domain, LinkedIn, personal knowledge) | Must |
| ADM-4 | Reports: any member can report a profile with a reason from a list ("Promotional or off-topic", "Misrepresentation", "Harassment or unsafe", "Spam", "Other") plus detail. Administrators see open reports and resolve or dismiss them | Must |
| ADM-5 | Moderation actions: hide a profile (sets visibility to `hidden` and mentorship to `off` until an administrator restores it), suspend request sending, remove an account | Must |
| ADM-6 | Every administrator action writes an audit entry: who, what, which record, when, and the note. Audit entries cannot be edited or deleted from the application | Must |
| ADM-7 | Members list with search, filters by kind, approval state and mentorship status, and counts | Must |
| ADM-8 | Program dashboard with the measures in section 8, computed from the database, no manual entry | Must |
| ADM-9 | Manage controlled vocabularies: add a discipline, approve proposed expertise tags, add a mentorship topic | Must (minimal form), fuller tooling Later |
| ADM-10 | Grant and revoke administrator rights; at least two administrators must remain | Must |

## 6. MVP scope and later enhancements

### 6.1 In the first release

- Accounts: magic link, Google, email verification, deletion with grace, data export
- Profiles for students and professionals with the three independent settings
- Approval queue and soft verification
- Directory with filters, search, profile pages, saved profiles and the mentors preset
- Mentorship requests with the full status set, caps, expiry, reminders, accept with handoff, decline with reason
- Relationships with completion and capacity accounting
- Email and in-app notifications with preferences
- Reports, moderation actions and audit log
- Administrator dashboard with the observable measures
- Region on every profile, defaulted to Greater New Orleans

### 6.2 Phase 2

- Propose-three-times scheduling and the meetings log
- Post-completion feedback
- Profile photos
- Sorting improvements, richer vocabulary management

### 6.3 Phase 3

- Calendar integration, only if the meetings log shows people want it

### 6.4 Phase 4 (possible, not planned)

- Regional chapters: a chapter entity, chapter administrators, directory scoping by region

The roadmap in [04-implementation-roadmap.md](04-implementation-roadmap.md) orders this work and gives estimates.

## 7. Non-goals

The following are deliberately out of scope. Listing them prevents the platform from drifting into a social network a volunteer board cannot moderate.

- **No internal messaging or chat.** Conversations happen over the handoff the mentor chose. A message queue would need moderation, retention policy and abuse handling the board cannot staff.
- **No public feed, posts, comments or likes.**
- **No job board** in the first three phases. Employers are visitors; they may use the public directory.
- **No payments, dues collection or membership tiers.** Whether directory access should require MEST membership is an open question, but the platform does not process money.
- **No native mobile app.** The web app is responsive and installable.
- **No automated matching or ranking of mentors.** The mentee chooses; filters help. Recommendations are a later discussion at most.
- **No document verification** (degrees, licenses). Verification is soft: email domain or LinkedIn.
- **No event management.** Events stay on the landing page and whatever registration tool MEST uses.
- **No analytics tracking of individuals.** Program measures come from aggregate database queries.

## 8. Success measures

A volunteer board cannot run surveys every quarter. The measures below are all observable from the database and shown on the administrator dashboard. Targets are not set here because there is no baseline; the board should read the first three months, then decide.

| Measure | Definition | Why it matters |
| --- | --- | --- |
| Approved professionals | Count of profiles with kind `professional` and state `approved`, by discipline group and by month approved | The directory is only useful once it has people in it |
| Active mentors | Approved professionals with mentorship `active` and at least one free slot | The supply side of mentorship |
| Paused mentors | Mentorship `paused`, with the median pause length | Distinguishes "no mentors" from "mentors resting" |
| Approval time | Median days from profile submission to decision | Shows whether the queue is being worked |
| Requests created | Count per month, by topic | Demand, and which topics students actually ask about |
| Requests answered within 7 days | Share of requests that reached `accepted` or `declined` within 7 days of creation | The promise to mentees is a timely answer, not necessarily a yes |
| Expired requests | Share that reached `expired` | The failure case; each is a mentee who heard nothing |
| Acceptance rate | `accepted` divided by (`accepted` + `declined`) | Whether mentees are asking the right people |
| Active relationships | Relationships not yet `completed` | How much mentoring is actually in progress |
| Completed relationships | Count per month | Mentoring that reached a natural end |
| Meetings held (Phase 2) | Meetings with status `completed` | Direct evidence that people met |
| Open reports | Count and oldest age | Moderation load and backlog |
| Members with no activity for 6 months | Count | Candidates for a gentle check-in email, and a signal for retention |

Two things these measures intentionally do not do: they do not count page views or sign-ins as success, and they do not rate individual mentors. A mentor who declines quickly and honestly is doing the platform a service.

## 9. Status vocabulary

All statuses used in the product, from `types.ts`:

| Entity | Statuses |
| --- | --- |
| Profile approval | `pending`, `approved`, `declined` |
| Directory visibility | `public`, `members`, `hidden` |
| Mentorship | `off`, `active`, `paused` (with optional `pausedUntil`) |
| Mentorship request | `pending`, `accepted`, `declined`, `completed`, `canceled`, `expired` |
| Meeting (Phase 2) | `upcoming`, `completed` |
| Report | `open`, `resolved`, `dismissed` |
| Account | `active`, `deletion_scheduled`, `deleted` |

User-facing labels for these are in [03-ux-information-architecture.md](03-ux-information-architecture.md), section 10.

## 10. Rules at a glance

The numbers members will notice, collected in one place. All of them are configuration values, not code constants, and the board owns them (see [05-open-questions.md](05-open-questions.md), A8).

| Rule | Value | Where it is enforced |
| --- | --- | --- |
| A request expires if unanswered | 14 days | Scheduled job; shown on the request as a date |
| Reminders to the mentor | Day 5 and day 10 | Scheduled job; in-app and email |
| Open (pending) requests per mentee | 3 at most | Request creation function |
| Pending requests to the same mentor | 1 at most | Unique index |
| Default maximum active mentees per mentor | 3 (mentor may set 1 to 10) | Accept function, with a row lock |
| Reports a member may file | 3 per day | Report function |
| Deletion grace period | 14 days | Deletion sweeper |
| Profile visible to administrators before email verification | Never | Membership helper used by every policy |
| Contact details shown before acceptance | Never | Single release function |

## 11. Assumptions

- MEST has or will have a domain for the platform and a sending address for email.
- At least two board-authorized administrators will check the queue weekly.
- The fictional vocabulary in `taxonomy.ts` (15 disciplines, 12 mentorship topics, 5 audiences, 5 contact methods, 6 participation options) is the starting vocabulary; the board may edit it before launch.
- The landing page stays as it is; the platform lives next to it on the same domain or a subdomain (see open questions).
