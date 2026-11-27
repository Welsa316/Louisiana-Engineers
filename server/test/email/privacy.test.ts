import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED, runSeed } from "../../seed/seed";
import { SEED_PROFESSIONAL_DETAILS, seedBookingUrl, seedLinkedinUrl, seedPhone } from "../../seed/profiles-details";
import { seedRequestId } from "../../seed/requests";
import "../../src/email/templates/all";
import { hasTemplate, renderTemplate, type RenderedEmail, type TemplateData } from "../../src/email/templates/registry";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";

/**
 * The email privacy test (02 section 9, NOT-4). Every template is rendered
 * from the payload its caller stores for the seeded Amina to Layla request
 * (req-1009, the one that still carries a why, goals and scheduling note),
 * and none of the request's free text, Amina's account email or Layla's
 * phone may appear in the subject, text or html.
 */

const APP_ORIGIN = "https://network.example.test";

/** Every template this task adds. `default` and `magic-link` come from Task 5. */
const TEMPLATES = [
  "request-received",
  "request-reminder",
  "request-accepted",
  "request-declined",
  "request-expired",
  "profile-submitted",
  "profile-approved",
  "profile-declined",
  "profile-verified",
  "report-received",
  "report-status",
  "moderation-action",
  "deletion-requested",
  "deletion-canceled",
  "admin-digest",
] as const;

type TemplateName = (typeof TEMPLATES)[number];

let db: TestDb;
const requestId = seedRequestId("req-1009");
const amina = SEED["amina-rahman"];
const layla = SEED["layla-haddad"];
const admin = SEED.admin;

/** The private values that must never reach an email. */
let secrets: { label: string; value: string }[];
let request: { why: string; goals: string; schedulingNote: string; payload: TemplateData };

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db.pool);
  await runSeed();

  // None of the seeded people opted into a phone, so Layla's contact row
  // gets the number the seed reserves for her: a real value in the database
  // the templates could leak if anything read it.
  const laylaIndex = SEED_PROFESSIONAL_DETAILS.findIndex((p) => p.key === "layla-haddad");
  await db.pool.query(
    "UPDATE contact_preferences SET phone = coalesce(phone, $2), methods = array_append(methods, 'phone') WHERE profile_id = $1",
    [layla.id, seedPhone(laylaIndex)],
  );

  const row = await db.pool.query<{ why: string; goals: string; scheduling_note: string; payload: TemplateData }>(
    "SELECT r.why, r.goals, r.scheduling_note, request_payload(r) AS payload FROM mentorship_requests r WHERE r.id = $1",
    [requestId],
  );
  expect(row.rows).toHaveLength(1);
  const r = row.rows[0];
  request = { why: r.why, goals: r.goals, schedulingNote: r.scheduling_note, payload: r.payload };

  const phone = await db.pool.query<{ phone: string }>("SELECT phone FROM contact_preferences WHERE profile_id = $1", [layla.id]);
  secrets = [
    { label: "why", value: r.why },
    { label: "goals", value: r.goals },
    { label: "scheduling_note", value: r.scheduling_note },
    { label: "Amina's email", value: amina.email },
    { label: "Layla's phone", value: phone.rows[0].phone },
    { label: "Layla's email", value: layla.email },
    { label: "Layla's LinkedIn", value: seedLinkedinUrl("layla-haddad") },
    { label: "Layla's booking link", value: seedBookingUrl("layla-haddad") },
  ];
  for (const secret of secrets) expect(secret.value, secret.label).toMatch(/\S{6,}/);
});

afterAll(async () => {
  await db.close();
});

interface Caller {
  recipient: string;
  category: string;
  title: string;
  body: string;
  link: string;
  payload: TemplateData;
  /** Text the rendered email must contain, so a template that renders nothing still fails. */
  mentions: string[];
}

/**
 * What each template's caller passes to `create_notification`, copied from
 * the SQL functions that exist (0004, 0005) and from the payload contracts
 * documented on the templates for the callers still to come (Tasks 21, 24, 26).
 */
function callers(): Record<TemplateName, Caller> {
  const p = request.payload;
  const mentee = `/network/me/requests/${requestId}`;
  const mentor = `/network/mentor/requests/${requestId}`;
  return {
    "request-received": {
      recipient: layla.id, category: "request", link: mentor,
      title: "New mentorship request from Amina", body: "Amina sent you a mentorship request. It expires in 14 days if there is no reply.",
      payload: { ...p, link: mentor }, mentions: ["Amina", String(p.topicLabel)],
    },
    "request-reminder": {
      recipient: layla.id, category: "reminder", link: mentor,
      title: "Amina's mentorship request is waiting for your reply", body: "It expires in 4 days.",
      payload: { ...p, daysLeft: 4, reminder: 2, link: mentor }, mentions: ["Amina", "4 days"],
    },
    "request-accepted": {
      recipient: amina.id, category: "response", link: mentee,
      title: "Layla accepted your mentorship request", body: "Open the request to see how to reach Layla.",
      payload: { ...p, link: mentee }, mentions: ["Layla", "accepted"],
    },
    "request-declined": {
      recipient: amina.id, category: "response", link: mentee,
      title: "Layla declined your mentorship request", body: "You can send a request to someone else.",
      payload: { ...p, reason: "no_capacity", link: mentee }, mentions: ["Layla", "No capacity right now"],
    },
    "request-expired": {
      recipient: amina.id, category: "response", link: mentee,
      title: "Your mentorship request to Layla expired", body: "There was no reply in time.",
      payload: { ...p, link: mentee }, mentions: ["Layla", "expired"],
    },
    "profile-submitted": {
      recipient: admin.id, category: "profile", link: "/network/admin/queue",
      title: "A profile is waiting for review", body: "A new professional profile was submitted to the directory.",
      payload: {}, mentions: ["review"],
    },
    "profile-approved": {
      recipient: layla.id, category: "profile", link: "/network/me",
      title: "Your profile is approved", body: "Your profile is now part of the MEST Network directory.",
      payload: { firstName: "Layla" }, mentions: ["Layla", "approved"],
    },
    "profile-declined": {
      recipient: layla.id, category: "profile", link: "/network/me",
      title: "Your profile needs changes", body: "Please add your current title.",
      payload: { firstName: "Layla", notes: "Please add your current title." }, mentions: ["Layla", "Please add your current title."],
    },
    "profile-verified": {
      recipient: layla.id, category: "profile", link: "/network/me",
      title: "Your affiliation is verified", body: "An administrator verified your title and organization.",
      payload: {}, mentions: ["verified"],
    },
    "report-received": {
      recipient: admin.id, category: "report", link: "/network/admin/reports",
      title: "A profile was reported", body: "A member reported a profile.",
      payload: { reason: "misrepresentation" }, mentions: ["Misrepresentation"],
    },
    "report-status": {
      recipient: amina.id, category: "report", link: "/network/notifications",
      title: "Your report was reviewed", body: "An administrator reviewed your report.",
      payload: { status: "resolved" }, mentions: ["resolved"],
    },
    "moderation-action": {
      recipient: layla.id, category: "account", link: "/network/me",
      title: "An administrator restricted your account", body: "You cannot send or accept requests for now.",
      payload: { firstName: "Layla", action: "suspend_requests" }, mentions: ["Layla", "requests"],
    },
    "deletion-requested": {
      recipient: amina.id, category: "account", link: "/network/scheduled-for-deletion",
      title: "Your account is scheduled for deletion", body: "",
      payload: { firstName: "Amina", executeOn: "2026-12-11" }, mentions: ["Amina", "December 11, 2026"],
    },
    "deletion-canceled": {
      recipient: amina.id, category: "account", link: "/network/me",
      title: "Your account will not be deleted", body: "",
      payload: { firstName: "Amina" }, mentions: ["Amina", "not be deleted"],
    },
    "admin-digest": {
      recipient: admin.id, category: "admin_digest", link: "/network/admin",
      title: "This week in MEST Network", body: "",
      payload: { queueSize: 3, openReports: 1, requestsWaiting: 5, oldestWaitingOn: "2026-11-10" }, mentions: ["3", "5", "November 10, 2026"],
    },
  };
}

/** The request's free text and contact values, under the keys a careless caller would use. */
function privateKeys(): TemplateData {
  return {
    why: request.why,
    goals: request.goals,
    scheduling_note: request.schedulingNote,
    mentor_note: request.why,
    email: amina.email,
    contact_email: layla.email,
    phone: secrets.find((s) => s.label === "Layla's phone")!.value,
  };
}

/**
 * Sends one notification through `create_notification` with email on and
 * returns the outbox payload the sender would render.
 */
async function storedPayload(template: TemplateName, caller: Caller, extra: TemplateData): Promise<TemplateData> {
  return asSystem(db.pool, async (client) => {
    const created = await client.query<{ id: string }>(
      "SELECT create_notification($1, $2::notification_category, $3, $4, $5, $6, $7::jsonb, true) AS id",
      [caller.recipient, caller.category, caller.title, caller.body, caller.link, template, JSON.stringify({ ...caller.payload, ...extra })],
    );
    const outbox = await client.query<{ payload: TemplateData }>(
      "SELECT payload FROM email_outbox WHERE notification_id = $1",
      [created.rows[0].id],
    );
    expect(outbox.rows, `${template} queued an email`).toHaveLength(1);
    return outbox.rows[0].payload;
  });
}

function leaks(email: RenderedEmail): string[] {
  const found: string[] = [];
  for (const secret of secrets) {
    for (const part of ["subject", "text", "html"] as const) {
      if (email[part].toLowerCase().includes(secret.value.toLowerCase())) found.push(`${secret.label} in ${part}`);
    }
  }
  return found;
}

describe("email templates", () => {
  it("registers every template from the plan", () => {
    expect(TEMPLATES.filter((name) => !hasTemplate(name))).toEqual([]);
  });

  it.each(TEMPLATES)("%s renders the stored payload without the request text or contact details", async (template) => {
    expect(hasTemplate(template), `${template} is registered`).toBe(true);
    const caller = callers()[template];
    // The caller even passes the private keys; create_notification drops them.
    const payload = await storedPayload(template, caller, privateKeys());
    const email = renderTemplate(template, payload, { appOrigin: APP_ORIGIN });

    expect(leaks(email)).toEqual([]);

    // The template rendered its own email from the payload, with the link.
    expect(email.subject.trim()).not.toBe("");
    for (const mention of caller.mentions) expect(email.text, `${template} text mentions ${mention}`).toContain(mention);
    expect(email.text).toContain(`${APP_ORIGIN}${caller.link}`);
    expect(email.html).toContain(`href="${APP_ORIGIN}${caller.link}"`);
  });

  it.each(TEMPLATES)("%s renders nothing it was not written to use, even under other keys", (template) => {
    const caller = callers()[template];
    const s = privateKeys();
    // These keys survive the SQL filter, and the in-app title and body sit in
    // every outbox payload; a template that echoed any of them would leak.
    const payload: TemplateData = {
      ...caller.payload,
      link: caller.link,
      title: `Request: ${s.why}`,
      body: `${s.goals} ${s.scheduling_note}`,
      message: s.why,
      detail: s.goals,
      note: s.scheduling_note,
      contactEmail: s.email,
      menteeEmail: s.email,
      mentorPhone: s.phone,
      contact: { email: s.email, phone: s.phone },
    };
    const email = renderTemplate(template, payload, { appOrigin: APP_ORIGIN });
    expect(leaks(email)).toEqual([]);
  });

  it("escapes payload text in html and keeps links on the app", () => {
    const email = renderTemplate(
      "request-received",
      { ...request.payload, menteeFirstName: "<b>Amina</b>", link: "https://attacker.example/phish" },
      { appOrigin: APP_ORIGIN },
    );
    expect(email.html).not.toContain("<b>Amina</b>");
    expect(email.html).toContain("&lt;b&gt;Amina&lt;/b&gt;");
    expect(email.text).not.toContain("attacker.example");
    expect(email.html).not.toContain("attacker.example");
  });
});
