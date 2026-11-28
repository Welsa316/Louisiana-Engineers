# MEST Network runbook

How to set up, run and recover the MEST Network in production. It is written for the volunteer who operates the service, not for a developer changing the code; the architecture behind each step is in [02-technical-architecture.md](02-technical-architecture.md), and the local development setup is in the repository [README](../../README.md).

The service is one Railway service built from the repository's `Dockerfile`, plus the Railway Postgres plugin. The same process serves the landing page at `/`, the network app under `/network`, the API under `/api`, and runs the background jobs. It sends email through Resend and offers Google sign-in as an alternative to email links.

Contents:

1. [Accounts and who holds them](#1-accounts-and-who-holds-them)
2. [First deployment](#2-first-deployment)
3. [Routine operations](#3-routine-operations)
4. [Incidents](#4-incidents)
5. [Before launch](#5-before-launch)

## Working against the production database

Several steps below connect to the production database from a computer, not from the service. Two rules apply every time.

- **Use the public connection string**, `DATABASE_PUBLIC_URL`, from the Postgres service's Variables tab in Railway. The service itself uses the private `DATABASE_URL`, which only works inside Railway. The public string carries the database owner's password: never paste it into a chat, a ticket or a file in the repository. Read it into the shell without echoing it:

  ```sh
  read -rs PROD_DB_URL && export PROD_DB_URL
  ```

- **The owner connection bypasses every privacy rule.** It sees every row, including email addresses. Run only the commands written in this runbook. Every change to a member, a request or a role goes through the SQL function this runbook names, never through a hand-written `UPDATE`, because the functions check the rules, notify the people affected and write the audit log.

The `npm run` commands below are run from a checkout of the repository with `npm ci` done and a `.env` file copied from `.env.example`. A value set on the command line wins over the `.env` file, which is how they reach production. The `psql`, `pg_dump` and `pg_restore` commands need the PostgreSQL client tools installed on that computer.

## 1. Accounts and who holds them

Every account below needs two holders, so one person leaving or being unreachable never locks MEST out. Record the holders' names in the board's private records, not in this repository: the repository is shared with volunteers and carries no board member names.

| Account | What it is for | What it holds |
| --- | --- | --- |
| Railway project | Runs the service and the database | Every service variable, including the database and Resend secrets; deploy history; logs |
| Railway Postgres (inside the project) | All member data | Profiles, requests, sign-in addresses, the audit log |
| Resend | Sends every email | The API key and the sending domain's verification |
| DNS for MEST's domain | The service's address and the sending domain's records | The records in sections 2.6 and 2.7 |
| Google Cloud project | Google sign-in | The OAuth client id and secret |
| GitHub repository | The code Railway deploys from | Deploy access; branch protection |
| Backup storage | The weekly database copies | Encrypted dump files and the passphrase (section 3.2) |

When a holder steps down, remove their access to each account the same week, and rotate any secret they could read (section 3.6).

## 2. First deployment

Do these in order. Steps 2.2 and 2.3 must be finished before the first deploy, or the service refuses to start.

### 2.1 Create the Railway project and the database

1. Create a Railway project and add the **Postgres** plugin. Railway names the service `Postgres`; the variable references below assume that name.
2. Add a service from the GitHub repository. Railway reads `railway.json`: it builds the `Dockerfile`, starts `node server/dist/index.js`, and treats `/api/health` as the health check.
3. Set the deploy branch in the service's settings. Railway deploys every push to it, so protect that branch on GitHub.
4. Do not deploy yet; set the variables first.

### 2.2 Create the request login

The API runs every request as the database role `mest_request`, which cannot bypass the privacy rules. Railway's own database user is a superuser, so the API must not use it for requests. In production the service checks at start that `REQUEST_DATABASE_URL` logs in as `mest_request` and that the role cannot bypass row-level security; it refuses to start otherwise.

1. Apply the migrations once from a checkout. They create the tables and the `mest_request` role (without a password):

   ```sh
   read -rs PROD_DB_URL && export PROD_DB_URL
   DATABASE_URL="$PROD_DB_URL" npm run migrate
   ```

   It prints `11 migrations recorded` (or more, as later releases add migrations). The service also applies new migrations itself each time it starts; this first run only makes the role exist before the first deploy.

2. Generate a password and give it to the role:

   ```sh
   openssl rand -hex 32
   psql "$PROD_DB_URL" -c "ALTER ROLE mest_request PASSWORD '<the generated password>'"
   ```

   A hex password needs no escaping in a URL. Keep it only in Railway's variables (next step).

3. In the app service's Variables, set `REQUEST_DATABASE_URL` to the same host and database as `DATABASE_URL`, with the user `mest_request`:

   ```
   postgresql://mest_request:<the generated password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
   ```

If the service was deployed before this step, its first start already created the role and then refused to continue; do steps 2 and 3 the same way and redeploy.

### 2.3 Set the service variables

Set these on the app service (not the Postgres service). `.env.example` lists the same variables with comments.

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (a Railway reference to the private connection) |
| `REQUEST_DATABASE_URL` | From section 2.2 |
| `APP_ORIGIN` | The public address members use, with `https://` and no trailing slash, for example `https://network.example.org`. Links in email and the check on every form submission use it, so it must match exactly |
| `SESSION_SECRET` | 32 or more random characters: `openssl rand -hex 32` (see section 3.6 for what it does today) |
| `EMAIL_FROM` | The sender, on the domain verified in Resend, for example `MEST Network <network@example.org>` |
| `RESEND_API_KEY` | From section 2.6. Without it, production records every email as failed instead of sending |
| `ADMIN_EMAILS` | Optional. Addresses made administrators the first time they sign in, comma separated (section 2.8) |
| `EMAIL_REPLY_TO` | Where replies to the network's emails go, for example `admin@mestnola.com` forwarded to the organizers' inbox (section 2.6). Optional; without it replies go to `EMAIL_FROM`, which has no inbox |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From section 2.7. Leave both unset to hide the Google button; email links still work |
| `NODE_ENV` | `production` (the image sets it; leave it) |
| `PORT` | Leave unset; Railway provides it |
| `JOBS_ENABLED` | `true`. Without it no email is sent and no request ever expires |
| `TRUST_PROXY` | `true` |
| `TRUST_PROXY_HOPS` | `1` to start; confirm it in section 2.5 |

### 2.4 Deploy and check

Deploy, then check from any computer:

```sh
curl -s https://<APP_ORIGIN host>/api/health                 # {"ok":true,"migrations":11} or more
curl -s -o /dev/null -w "%{http_code}\n" https://<APP_ORIGIN host>/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<APP_ORIGIN host>/network/directory   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<APP_ORIGIN host>/nothing-here        # 404
```

The deploy log should show `[db] requests log in as mest_request` and `[http] listening`. If it shows an error naming `REQUEST_DATABASE_URL`, go back to section 2.2.

For a custom domain, add it in the service's Networking settings and create the DNS record Railway shows, then set `APP_ORIGIN` to it and redeploy.

### 2.5 Confirm how many proxies sit in front of the service

Sign-in links are limited per address and per network address (`magic_links_per_hour`, 5 by default). The service learns a visitor's network address from the `X-Forwarded-For` header, and it must read the entry Railway's edge added, not one a visitor typed. Until this is right, either every visitor shares one address (and five sign-ins an hour lock everyone out) or a visitor can choose their own address and dodge the limit.

1. With `TRUST_PROXY=true` and `TRUST_PROXY_HOPS=1` deployed, find your own public address (`curl -s https://api.ipify.org`).
2. Request a sign-in link for an address you control, adding a fake leading entry to the header:

   ```sh
   curl -s -X POST https://<APP_ORIGIN host>/api/auth/magic-link \
     -H "Origin: <APP_ORIGIN>" -H "Content-Type: application/json" \
     -H "X-Forwarded-For: 203.0.113.7" \
     -d '{"email":"<an address you control>"}'
   ```

3. Read the address the service stored:

   ```sh
   psql "$PROD_DB_URL" -c "SELECT host(ip) AS ip, created_at FROM auth_tokens ORDER BY created_at DESC LIMIT 1"
   ```

4. Compare:
   - **Your own public address:** correct. Nothing to change.
   - **`203.0.113.7`:** the header is not being added to as expected, so a visitor could choose their address. Do not launch; ask a developer to look at Railway's headers.
   - **A private or Railway-internal address** (`10.x`, `100.64.x` to `100.127.x`, `172.16.x` to `172.31.x`, `192.168.x`, or one starting `fd`): one more proxy adds an entry after the edge. Raise `TRUST_PROXY_HOPS` by one, redeploy, and repeat from step 2.

Repeat this check after any change Railway announces to its networking.

### 2.6 Resend and the sending domain

1. In Resend, add the domain that `EMAIL_FROM` uses.
2. Add the DNS records Resend shows for it, copied exactly: an MX record and an SPF TXT record on the sending subdomain, and a DKIM TXT record. Wait until Resend shows the domain as verified.
3. Add a DMARC record if the domain has none: a TXT record at `_dmarc` with `v=DMARC1; p=none; rua=mailto:<a MEST address that receives reports>`. Tighten `p=none` to `quarantine` once a few weeks of reports show only Resend sending for the domain.
4. Create an API key with sending access limited to that domain, and set it as `RESEND_API_KEY`.
5. Request a sign-in link for your own address on the live site and confirm it arrives and is not marked as spam.

**Receiving mail without a mailbox.** `EMAIL_FROM` (for example `network@mestnola.com`) is send-only: nothing reads it. The public contact address (`contact.email` in `src/content/site.ts`, for example `admin@mestnola.com`) needs no mailbox either. Forward it to the organizers' existing inbox with the DNS provider's free email forwarding (Cloudflare Email Routing, or the registrar's own forwarding), and optionally add a catch-all rule so a reply sent to `EMAIL_FROM` is forwarded too. Set `EMAIL_REPLY_TO` to the contact address so replies reach that inbox. Resend's records sit on the sending subdomain and DKIM, so they do not clash with the forwarding service's MX records on the domain itself. Send a test message to the contact address from another account and confirm it arrives.

### 2.7 Google sign-in

1. In a Google Cloud project, configure the OAuth consent screen: external, app name "MEST Network", MEST's support address, MEST's domain as an authorized domain, and only the `openid` and `email` scopes (the service asks for nothing else). Publish it; a consent screen left in testing mode admits only listed test users.
2. Create an OAuth client of type **Web application** with:
   - Authorized JavaScript origin: `APP_ORIGIN`
   - Authorized redirect URI: `APP_ORIGIN/api/auth/google/callback`, for example `https://network.example.org/api/auth/google/callback`
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and redeploy. The sign-in screen shows the Google button only when both are set.

If `APP_ORIGIN` changes, update both entries in the Google client, or Google refuses the redirect.

### 2.8 The first administrators

Administrators are granted from the admin screen by another administrator. There are two ways to make the first ones.

**The simple way: `ADMIN_EMAILS`.** In the app service's Variables, set `ADMIN_EMAILS` to the addresses, separated by commas (for example `admin@mestnola.com,second@example.org`), and redeploy. Each listed address becomes an administrator for every region the first time it signs in, and lands on Administration with no member profile to fill in; it can join the network as a member later from the Join the network link. A role revoked later is not granted again, so the list can stay set. Sign-in itself needs email sending working first (`RESEND_API_KEY`, section 2.6) and the request login (section 2.2).

**From the command line**, which also recovers when no administrator can sign in:

1. Each future administrator signs in once on the live site (email link or Google), so their account exists.
2. Grant each one, typing the address they signed in with at the prompt (so the shell passes it through unchanged, quote marks included):

   ```sh
   read -r -p "Address: " ADDR
   DATABASE_URL="$PROD_DB_URL" npm run admin:grant -- "$ADDR"
   ```

   It prints the profile id and how many administrators are active. The role it grants acts for every region (section 3.10). It refuses an address with no account, an account that has not confirmed its address, and a suspended or departing account. It writes `admin.granted` to the audit log.

3. Grant at least two. The board's rule (A7) is two administrators at minimum; the admin screen refuses to remove one if that would leave fewer.

After that, administrators grant the role from Administration, Members and revoke it from Administration, Administrators. Run the command again only to recover when no administrator can sign in.

## 3. Routine operations

### 3.1 Deploying a change

A push to the deploy branch builds a new image. The new container applies any new migrations at start (under a lock, so two starting containers cannot both migrate), checks the request login, and takes traffic once `/api/health` answers. If the start fails, Railway keeps the previous deployment serving.

Migrations only move forward. To undo a change, redeploy the previous deployment from Railway's deploy history; that is safe as long as the newer migrations only added things, which every Phase 1 migration does. To undo a migration itself, a developer writes a new migration.

CI runs the type checks, the server tests (including the privacy tests on every email template), the build and the browser tests on every push. Do not deploy a commit whose CI failed.

### 3.2 Weekly backup

Railway's own Postgres backups depend on the plan; check what the project's plan includes. Independently of that, take a weekly copy that MEST owns.

1. Use a `pg_dump` whose major version is at least the server's (`psql "$PROD_DB_URL" -Atc "SHOW server_version"`).
2. Take the dump and check it reads back:

   ```sh
   pg_dump --format=custom --no-owner --file "mest-$(date +%F).dump" "$PROD_DB_URL"
   pg_restore --list "mest-$(date +%F).dump" | head
   ```

3. Encrypt it before it leaves the computer, then delete the unencrypted file:

   ```sh
   gpg --symmetric --cipher-algo AES256 "mest-$(date +%F).dump"
   rm "mest-$(date +%F).dump"
   ```

   The two backup holders keep the passphrase, separately from the files.

4. Store the `.gpg` file in MEST's private backup storage. Keep the last eight weekly copies and delete older ones.

A dump holds every member's sign-in address and profile. A member's deleted data stays in the copies taken before their deletion until those copies are deleted, so eight weeks is also how long a deletion takes to reach the backups. The privacy notice does not say this yet; it is a board decision alongside A9.

### 3.3 Restoring a backup

Restore into a **new** Postgres service and switch the app to it, rather than overwriting the live database. Rehearse this on a local database once a quarter.

1. Decrypt the copy: `gpg --output mest.dump --decrypt mest-<date>.dump.gpg`.
2. Add a second Postgres service to the Railway project (for example `Postgres-restore`) and read its public URL into `RESTORE_DB_URL` the same way as `PROD_DB_URL`.
3. Create the two roles the dump's permissions refer to. They belong to the database server, not to the dump:

   ```sh
   psql "$RESTORE_DB_URL" -c "CREATE ROLE app_user NOLOGIN"
   psql "$RESTORE_DB_URL" -c "CREATE ROLE mest_request LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT PASSWORD '<new generated password>'"
   psql "$RESTORE_DB_URL" -c "GRANT app_user TO mest_request"
   ```

4. Restore, then put back the one setting a dump does not carry (no temporary tables for anyone but the owner):

   ```sh
   pg_restore --no-owner --exit-on-error --dbname "$RESTORE_DB_URL" mest.dump
   psql "$RESTORE_DB_URL" -c 'REVOKE TEMPORARY ON DATABASE "<its database name>" FROM PUBLIC'
   ```

5. Check it: `DATABASE_URL="$RESTORE_DB_URL" npm run migrate` applies nothing and prints the same count as production; `psql "$RESTORE_DB_URL" -c "SELECT count(*) FROM profiles"` matches what you expect.
6. Point the app at it: change `DATABASE_URL` to `${{Postgres-restore.DATABASE_URL}}` and `REQUEST_DATABASE_URL` to the new host and the new `mest_request` password, then redeploy and run the checks in section 2.4.
7. Keep the old database until the board is satisfied, then remove it.

Everything written to the live database after the dump was taken is lost by a restore. Say so to the board before choosing it over a fix.

### 3.4 Pausing the platform

For an incident or a board decision, an administrator opens Administration, Settings, and turns on **Pause new requests and hide the directory**. While it is on, the directory shows nothing and no request can be sent; signed-in members keep their history. The change is in the audit log. Turn it off the same way.

### 3.5 A deletion request by email

Members delete their own account from Settings, Account: the profile is hidden at once, open requests are closed, and the account is erased after a 14-day grace period in which the member can keep it by signing in. That is the path to point people to.

When someone asks by email instead:

1. Reply to the address the request came from, never to an address written inside the message, and point them to Settings, Account. Signing in only needs access to that inbox.
2. If they cannot use it, confirm that the address they wrote from is the account's sign-in address. Do not act on a forwarded or third-party request.
3. Schedule the deletion on their behalf. This is the same function the settings screen calls, with the same 14-day grace period, notice email and audit entry:

   Type the address at the prompt rather than into the command, so `psql` quotes it (an address can contain a quote mark):

   ```sh
   read -r -p "Address: " ADDR
   psql "$PROD_DB_URL" -v addr="$ADDR" <<'SQL'
   SELECT schedule_account_deletion(u.id, false, NULL) FROM users u WHERE u.email = :'addr' AND u.deleted_at IS NULL;
   SQL
   ```

   One row with an id means it is scheduled; no rows means no live account uses that address. The grace period is a safeguard here too: if the request was forged, the real member gets the notice and can keep the account.

4. Reply with the date it will be erased (14 days from today). The `deletions` job erases it then.

An administrator's account cannot be deleted while that would leave fewer than two administrators; grant another first. The board's immediate removal of an account (no grace period) is a moderation decision made through Administration, Reports, not by email.

### 3.6 Rotating secrets

**`SESSION_SECRET`.** The service requires it at start, but nothing in Phase 1 signs or encrypts with it: sessions are random values stored only as hashes. Rotating it means setting a new value (`openssl rand -hex 32`) and redeploying; it signs nobody out. Rotate it when a holder steps down, so it is ready if a later release starts using it.

**Signing everyone out** (for example after a suspected session leak) is done by removing the session rows; every member signs in again with a fresh link:

```sh
psql "$PROD_DB_URL" -c "DELETE FROM sessions"
```

To sign out one account, again with the address typed at a prompt:

```sh
read -r -p "Address: " ADDR
psql "$PROD_DB_URL" -v addr="$ADDR" <<'SQL'
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = :'addr');
SQL
```

**The other secrets:**

| Secret | How to rotate |
| --- | --- |
| `RESEND_API_KEY` | Create a new key in Resend, set it, redeploy, then delete the old key |
| `GOOGLE_CLIENT_SECRET` | Add a new secret to the OAuth client, set it, redeploy, then disable the old one |
| `mest_request` password | `ALTER ROLE mest_request PASSWORD '<new>'`, update `REQUEST_DATABASE_URL`, redeploy at once (requests fail between the two) |
| Database owner password | Through Railway's Postgres service; `DATABASE_URL` follows by reference. Retake `PROD_DB_URL` afterwards |

### 3.7 Running a job by hand

The jobs run inside the service every day (expiry hourly, email every minute). To run one at once, for example the deletion sweep after scheduling a deletion with an earlier date:

```sh
DATABASE_URL="$PROD_DB_URL" npm run job -- deletions
```

The job names are `expire-requests`, `reminders`, `resume-paused`, `retention`, `admin-digest`, `deletions`, `complete-past-meetings`, `meeting-check-in` and `member-digest`. A job already running in the service holds a lock, and the command then says it skipped. Never run `send-emails` from a computer: outside production it marks messages as sent without sending them and prints them to the terminal.

The three jobs Phases 2 to 4 added each run once a day:

| Job | What it does |
| --- | --- |
| `complete-past-meetings` | Marks every upcoming meeting whose end (its start plus its length) has passed as completed. That is what "meetings held" on the dashboard counts. A meeting someone already answered "Did you meet?" for is left alone. Writes one `meeting.completed` audit entry with the count |
| `meeting-check-in` | A day after a meeting's start, asks both people "Did you meet?" in the app and by email, once per meeting. Skips a meeting that was canceled or already answered, and anyone no longer in good standing. It is a reminder, so a member who turned off reminder emails gets only the in-app notice |
| `member-digest` | Sends the opt-in weekly digest (section 3.11). It runs daily but sends each member at most one digest in seven days |

Running any of the three again by hand is safe: each moves a meeting, or sends a member a digest, at most once.

### 3.8 Profile photos

A photo is optional; every member shows their initials until an administrator approves one. Members add, change and remove their photo in Settings, Profile.

**Size limits.** The browser shrinks the chosen file before it is sent: the longer side to at most 512 pixels, saved as a JPEG of at most 200,000 bytes. Redrawing it also drops the file's camera, date and location details. The browser accepts a JPEG, PNG or WebP file of up to 25 MB to start from. The service then checks the upload itself: it takes only a JPEG or WebP, judged by the file's bytes rather than its name, and refuses anything over 200,000 bytes; the database checks both again. Photos are stored in the database, so each one adds at most 200 KB to the database and to every backup.

**The moderation queue** is Administration, Photos, with three tabs:

- **Waiting**: new photos, oldest first. Approve a clear photo of the member on their own; reject logos, group shots, other people, or anything you would not want on a professional profile.
- **Shown**: approved photos. **Take down** hides one again.
- **Not approved**: rejected photos. Approving one here reverses the rejection.

Nothing notifies administrators when a photo arrives; the number beside Photos in the administration menu is the only signal, so look at it when you look at the approval queue. A member who uploads a new photo replaces the old one, and the new one waits for review even if the old one was shown.

Each decision is written to the audit log (`photo.approved` or `photo.rejected`, as is each upload, `photo.uploaded`, and each removal by the member, `photo.removed`) and tells the member in the app and by email (template `photo-reviewed`, under their profile email setting). An approved photo shows only to people who may see the profile, and browsers check with the service before reusing a copy, so a takedown applies the next time anyone opens the page.

A chapter administrator sees and decides only the photos of members in its region; an administrator for every region sees them all. When an account is deleted its photo is deleted with it. The data export says whether a photo exists, its state, type and size, but not the image.

### 3.9 The calendar feed

A member turns the feed on in Settings, Calendar and gets a private address to add to Google Calendar, Apple Calendar, Outlook or any app that subscribes to a calendar by its address.

**What it shows.** The meetings the member scheduled on the network: every meeting ahead and those of the last 30 days, up to 500. Each event has the time and length, whether it is online or in person, a title of "MEST mentorship:" and the other person's first name, and a link back to the request page. A canceled meeting shows as canceled. It never shows the place, what the pair plan to talk about or anyone's contact details. The feed asks calendar apps to check hourly; each app decides how often it really does, from every hour to once a day.

**The address is shown once.** Only a fingerprint of it is stored (its sha256), so nobody can read a working address out of the database, administrators included, and there is no administrator screen for anyone's feed. The address stops working on its own when the account is suspended, scheduled for deletion or deleted, and the deletion sweep removes it.

**How a member resets the private link.** If the address was shared by mistake, or they need it again on a new device, the member opens Settings, Calendar and chooses **Make a new address**, then confirms. The old address stops working at once; they add the new one to their calendar app in place of the old. **Turn the feed off** stops it with no replacement. Both are written to the audit log (`calendar_feed.created`, `calendar_feed.revoked`). Point a member who asks by email to these two buttons; an administrator cannot do it for them.

### 3.10 Regions and chapter administrators

The network serves one region, Greater New Orleans, until another is added. There is no screen for adding a region: a developer adds it in a new migration (a row in the `regions` table). Once more than one region is active, onboarding and Settings, Profile ask members for their region and the directory offers a region filter; Administration, Members always has one. A member can move only to an active region; members already in a region that is later retired keep it.

**Granting for one region.** In Administration, Members, **Make administrator** asks what the new administrator administers: one region, or every region. A chapter administrator (one scoped to a region) acts only on members in that region: approving and verifying profiles, hiding and restoring them, deciding reports and granting or revoking the role. Their members list shows only their region, they can grant only their own region, and they never act on a region-wide administrator. Administration, Administrators shows each administrator's region.

A chapter administrator also reads only its region: profiles, student details, reviews, reports, photos and requests that involve a member there, and only the administrator notifications about its own members. Platform settings, the vocabulary, tags and the feedback comments change or show for the whole network, so only an administrator for every region can use them; a chapter administrator who tries is told the action is outside its region. The dashboard counts and the administrators list still cover everyone. Section 5.4 of [02-technical-architecture.md](02-technical-architecture.md) lists each path.

**Keeping an administrator for every region.** The last region-wide administrator who can act cannot be revoked, narrowed to one region, suspended or removed, and cannot delete their own account, so a region-wide role can always be granted from the screen. If none can act anyway (for example, none can sign in), the command in section 2.8 is the way back: `npm run admin:grant -- <email>` always grants for every region. On someone who is already a chapter administrator it widens their role to every region, prints `Widened the administrator role to every region`, and writes `admin.granted` to the audit log.

### 3.11 The member weekly digest

Members turn it on in Settings, Notifications (**Weekly digest**); it is off for everyone until they do. The `member-digest` job (section 3.7) sends each member who turned it on at most one digest in seven days, by email with the names (template `member-digest`) and in the app as counts, and only when something is new since their last one:

- a professional hears about professionals newly listed in the directory in their own discipline;
- a student hears about mentors who started taking requests for the topics they chose (none while the platform is paused).

A digest carries names and titles only, never contact details, organizations or request text, and names up to 10 people per list with the rest counted. A first digest looks back one week. A member with nothing new gets nothing, and their week does not restart.

## 4. Incidents

### 4.1 Steps

1. **Contain.** If members are at risk or data may be leaking, pause the platform (section 3.4). For a compromised account, sign it out (section 3.6); for an administrator's account, also revoke the role from Administration, Administrators. For a leaked secret, rotate it (section 3.6).
2. **Preserve.** Take a backup (section 3.2) before changing anything else, and save the Railway logs for the period. The audit log (`audit_log`) records approvals, contact views, moderation, configuration changes and deletions with their times.
3. **Fix**, through the admin screens and the functions in this runbook. A code fix goes through CI and a normal deploy.
4. **Tell the board** what happened, what was exposed and what was done. If personal information may have been exposed, the board decides with legal advice whether members must be told; Louisiana law can require notice to affected people.
5. **Unpause** and write down what changed so the next incident is shorter.

### 4.2 Common failures

| Symptom | Where to look |
| --- | --- |
| Deploy never becomes healthy | The deploy log. `REQUEST_DATABASE_URL` errors: section 2.2. `Invalid environment`: a variable in section 2.3 is missing or malformed. `Migration ... failed`: the previous deployment keeps serving; ask a developer |
| No email arrives | `JOBS_ENABLED` is `true`; `RESEND_API_KEY` is set; the domain is verified in Resend; the Resend dashboard's logs. Unsent rows: `psql "$PROD_DB_URL" -c "SELECT template, attempts, last_error FROM email_outbox WHERE sent_at IS NULL ORDER BY created_at DESC LIMIT 20"` |
| Everyone gets "too many links" | Section 2.5: the service is reading the proxy's address instead of the visitor's |
| Google sign-in fails | The redirect URI and origin in section 2.7 match `APP_ORIGIN` exactly; the consent screen is published |
| Requests never expire, reminders never go out | `JOBS_ENABLED` is `true`; the deploy log shows the jobs starting |
| A sign-in link says it is invalid | Links last 15 minutes and work once; the member requests a new one |
| A member's photo does not show | It is waiting in Administration, Photos, or was not approved (section 3.8) |
| A calendar app stopped showing meetings | The member made a new address or turned the feed off, or the account is suspended or being deleted (section 3.9). After a new address, the member adds it to the app in place of the old one |
| Meetings never become "held", nobody is asked "Did you meet?" | `JOBS_ENABLED` is `true`; the `complete-past-meetings` and `meeting-check-in` jobs (section 3.7) |

## 5. Before launch

These are open in the repository and need a decision or a value before members are invited:

- **Contact address.** `contact.email` in `src/content/site.ts` is `admin@mestnola.com`, shown in the footer, the membership section and the privacy notice. Members are told to use it for questions and deletion requests, so the domain must be owned and the address forwarded (section 2.6) before launch; until then it bounces.
- **Legal drafts.** The guidelines and privacy pages are marked "Draft for board review" (A12), including the retention periods (A9) and the backup retention in section 3.2.
- **Administrators.** At least two, granted as in section 2.8, with the board's decision on who they are (A7).
- **Accounts.** Two holders recorded for each account in section 1.
- **Checks.** Sections 2.4 to 2.7 done on the live address, and one full walk-through: sign up as a professional, approve from the admin screen, request mentorship as a student, accept, and delete a test account.
