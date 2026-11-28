import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../src/email/templates/all";
import { hasTemplate, renderTemplate, type RenderedEmail, type TemplateData } from "../../src/email/templates/registry";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";
import { chooseAs, makePair, proposeAs, slotAt, slotsOf, type Pair } from "../policies/meeting-fixtures";
import { MENTOR_PHONE, WHY, resetRequestConfig } from "../policies/request-fixtures";

/**
 * The meeting emails (Task 30) under the email privacy rule (NOT-4): each is
 * rendered from the outbox payload the SQL functions really stored, and
 * neither the meeting's place or agenda, the request's text, an email
 * address nor a phone number may appear in the subject, text or html.
 */

const APP_ORIGIN = "https://network.example.test";
const PLACE = "Room 214, Engineering Library, call 504-555-0142";
const AGENDA = "Walk through the FE exam plan and my internship shortlist.";

let db: TestDb;
let pair: Pair;
let meetingId: string;
let secrets: { label: string; value: string }[];

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db.pool);
  await resetRequestConfig(db.pool);
  pair = await makePair(db.pool);
  const batch = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(48)]);
  const [slot] = await slotsOf(db.pool, batch);
  meetingId = await chooseAs(db.pool, pair.mentor, slot.id, { mode: "in-person", place: PLACE, agenda: AGENDA });
  await asSystem(db.pool, (client) => client.query("SELECT meeting_prompt(now() + interval '4 days')"));

  const emails = await db.pool.query<{ email: string }>("SELECT email::text AS email FROM users WHERE id IN ($1, $2)", [
    pair.mentee,
    pair.mentor,
  ]);
  secrets = [
    { label: "place", value: PLACE },
    { label: "agenda", value: AGENDA },
    { label: "request why", value: WHY },
    { label: "mentor phone", value: MENTOR_PHONE },
    ...emails.rows.map((r) => ({ label: "an account email", value: r.email })),
  ];
});

afterAll(async () => {
  await db.close();
});

async function outboxPayload(template: string, recipient: string): Promise<TemplateData> {
  const result = await db.pool.query<{ payload: TemplateData }>(
    `SELECT o.payload FROM email_outbox o JOIN notifications n ON n.id = o.notification_id
      WHERE n.template = $1 AND n.recipient_id = $2`,
    [template, recipient],
  );
  expect(result.rows, `${template} queued one email`).toHaveLength(1);
  return result.rows[0].payload;
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

const cases = [
  { template: "meeting-scheduled", recipient: () => pair.mentee, other: "Layla", side: "me" },
  { template: "meeting-check-in", recipient: () => pair.mentee, other: "Layla", side: "me" },
  { template: "meeting-check-in", recipient: () => pair.mentor, other: "Amina", side: "mentor" },
] as const;

describe("meeting email templates", () => {
  it("registers both templates", () => {
    expect(hasTemplate("meeting-scheduled")).toBe(true);
    expect(hasTemplate("meeting-check-in")).toBe(true);
  });

  it.each(cases)("$template to the $side side renders the stored payload privately", async ({ template, recipient, other, side }) => {
    const payload = await outboxPayload(template, recipient());
    const email = renderTemplate(template, payload, { appOrigin: APP_ORIGIN });
    expect(leaks(email)).toEqual([]);
    expect(email.text).toContain(other);
    // The date is written out ("March 4, 2026"), from the stored Louisiana date.
    expect(email.text).toMatch(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/);
    const link = `${APP_ORIGIN}/network/${side}/requests/${pair.requestId}`;
    expect(email.text).toContain(link);
    expect(email.html).toContain(`href="${link}"`);
  });

  it("meeting-scheduled states the time, length and mode", async () => {
    const payload = await outboxPayload("meeting-scheduled", pair.mentee);
    const email = renderTemplate("meeting-scheduled", payload, { appOrigin: APP_ORIGIN });
    expect(email.text).toContain(String(payload.startsAtTime));
    expect(email.text).toContain("45 minutes");
    expect(email.text).toContain("in person");
  });

  it.each(["meeting-scheduled", "meeting-check-in"])("%s renders nothing it was not written to use", async (template) => {
    const payload = await outboxPayload(template, pair.mentee);
    const hostile: TemplateData = {
      ...payload,
      title: `Meeting at ${PLACE}`,
      body: AGENDA,
      place: PLACE,
      agenda: AGENDA,
      message: WHY,
      note: PLACE,
      contactEmail: secrets.at(-1)!.value,
      mentorPhone: MENTOR_PHONE,
    };
    const email = renderTemplate(template, hostile, { appOrigin: APP_ORIGIN });
    expect(leaks(email)).toEqual([]);
  });

  it("the stored payloads carry no place or agenda", async () => {
    const rows = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM notifications WHERE subject_id = $1 UNION ALL SELECT payload FROM email_outbox",
      [pair.requestId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows.rows);
    expect(text).not.toContain(PLACE);
    expect(text).not.toContain(AGENDA);
    expect(text).toContain(meetingId);
  });
});
