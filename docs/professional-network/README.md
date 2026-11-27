# Professional Directory, Networking and Mentorship Platform: planning documents

This folder holds the planning documents for a member platform for Muslim Engineers in Science & Tech (MEST), the volunteer-run professional and community organization based in Greater New Orleans, Louisiana. The platform adds three things the current single-page landing site does not have: a directory of professionals who choose to be listed, a way for students and early-career members to request mentorship from those professionals, and the administration tools a volunteer board needs to approve profiles, handle reports and keep personal data private. The documents cover product requirements, technical architecture (one Node service with Postgres on Railway, serving the existing React and Vite frontend), information architecture and user experience, an implementation roadmap, the questions that still need an answer, and the task-by-task build plan for the first release. A frontend-only prototype let the board click through the proposed experience with fictional data before the build; the real screens have replaced it, and [runbook.md](runbook.md) covers running the service in production.

## Documents

| File | What it answers |
| --- | --- |
| [01-product-requirements.md](01-product-requirements.md) | Who the platform is for, what it must do, who may do what, what is in the first release and how the board will know it is working |
| [02-technical-architecture.md](02-technical-architecture.md) | The stack and why, the full database schema, authentication, Row Level Security, privacy, integrations, deletion and data ownership. Revised 2026-11-23 for Railway hosting |
| [03-ux-information-architecture.md](03-ux-information-architecture.md) | Sitemap, navigation per role, user journeys, onboarding fields, mentee, mentor and admin workflows, notifications, empty states, mobile behaviour, accessibility |
| [04-implementation-roadmap.md](04-implementation-roadmap.md) | Phases, scope, dependencies, complexity estimates, risks, order of work and acceptance criteria |
| [05-open-questions.md](05-open-questions.md) | What was decided on 2026-11-23, which board questions are running on their default, and the technical decisions as made |
| [06-build-plan-phase-1.md](06-build-plan-phase-1.md) | The task-by-task plan for the first release: constraints, interfaces, tests and commit messages per task, and the multi-agent workflow that executes it |
| [runbook.md](runbook.md) | Operating the service: accounts and holders, first deployment on Railway, the request login, Resend and Google setup, the first administrators, backups and restore, pausing, deletion requests by email, rotating secrets and incident steps |

Read them in order the first time. Each file is self-contained and links to the others where a topic continues. The build plan's task text wins where it and an earlier document differ; the architecture document is the reference for every table column, policy row, function signature and notification.

## Source of truth for vocabularies

The controlled vocabularies and entity shapes these documents use were first defined in the prototype's data modules and now live in the build:

- `shared/taxonomy.ts`: disciplines, mentorship topics (as `{ id, label }` with slug ids), audiences, experience bands, contact methods, participation options. The `disciplines` and `mentorship_topics` tables are seeded from it, and administrators add to them from the admin screen
- `shared/types/common.ts`: visibility levels, mentorship status, approval state, request statuses and the other enumerations, matching the database's enumerated types
- `server/seed/`: the fictional people, organizations, requests and reports used as examples and as the development seed

Every person and organization named in these documents comes from that fictional data.

## Status

Building Phase 1 on the `network-build` branch, following [06-build-plan-phase-1.md](06-build-plan-phase-1.md). The decisions recorded as fixed in these documents (Railway hosting, passwordless sign-in, approval queue, hybrid visibility with contact details behind sign-in, platform-mediated requests) are listed in [05-open-questions.md](05-open-questions.md) with the date they were taken; the same file lists the board questions still running on their default.
