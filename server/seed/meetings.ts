import { louisianaDateAfter, louisianaToIso } from "../../shared/meeting-time";
import type { Db } from "../src/db/tx";
import { seedRequestId } from "./requests";
import { seedUserId } from "./users";

/**
 * The seeded schedule (Task 31), written after `seedRequests`, which clears
 * every meeting and proposed time between seeded people first. Times are
 * relative to the run, at fixed Louisiana hours, so the screens always show
 * the same mix:
 *
 *   req-1001  Amina and Zainab: a meeting three days ago that nobody has
 *             answered "Did you meet?" for, and one in five days (Zainab
 *             proposed two times; Amina chose the first)
 *   req-1005  Sumaya and Layla: Layla proposed three times for Sumaya to
 *             choose from
 *   req-1006  Idris and Layla (completed): the meeting they held
 *
 * Rows go in directly as the owner, so nobody is notified or emailed. The
 * three relationships' meetings and times are cleared first as well, so
 * running it on its own (as e2e/meetings.spec.ts does) also puts the
 * schedule back.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant of `HH:MM` in Louisiana, `days` from today there. */
function louisianaAt(base: Date, days: number, time: string): Date {
  const iso = louisianaToIso(louisianaDateAfter(base, days), time);
  if (!iso) throw new Error(`seed: ${time} does not exist ${days} days from now in Louisiana`);
  return new Date(iso);
}

const plus = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

const slotId = (key: string) => seedRequestId(`slot:${key}`);
const batchId = (key: string) => seedRequestId(`batch:${key}`);
const meetingId = (key: string) => seedRequestId(`meeting:${key}`);
const relationshipId = (requestKey: string) => seedRequestId(`${requestKey}:relationship`);

interface SeedSlot {
  key: string;
  batch: string;
  request: string;
  by: string;
  startsAt: Date;
  minutes: number;
  status: "proposed" | "chosen" | "declined" | "withdrawn";
  createdAt: Date;
}

interface SeedMeeting {
  key: string;
  request: string;
  slot: string | null;
  startsAt: Date;
  minutes: number;
  mode: "online" | "in-person";
  place: string;
  agenda: string;
  status: "upcoming" | "completed";
  createdBy: string;
  createdAt: Date;
  /** "Did you meet?": who answered yes, if anyone. */
  metBy?: string;
}

export async function seedMeetings(db: Db): Promise<void> {
  const now = new Date();
  const amina = seedUserId("amina-rahman");
  const zainab = seedUserId("zainab-qureshi");
  const layla = seedUserId("layla-haddad");
  const idris = seedUserId("idris-fofana");

  const pastWithZainab = louisianaAt(now, -3, "16:00");
  const nextWithZainab = louisianaAt(now, 5, "17:30");
  const heldWithIdris = louisianaAt(now, -24, "10:00");

  const slots: SeedSlot[] = [
    {
      key: "zainab-past",
      batch: "zainab-past",
      request: "req-1001",
      by: zainab,
      startsAt: pastWithZainab,
      minutes: 45,
      status: "chosen",
      createdAt: new Date(pastWithZainab.getTime() - 6 * DAY_MS),
    },
    {
      key: "zainab-next-1",
      batch: "zainab-next",
      request: "req-1001",
      by: zainab,
      startsAt: nextWithZainab,
      minutes: 30,
      status: "chosen",
      createdAt: new Date(now.getTime() - DAY_MS),
    },
    {
      key: "zainab-next-2",
      batch: "zainab-next",
      request: "req-1001",
      by: zainab,
      startsAt: louisianaAt(now, 6, "12:00"),
      minutes: 30,
      status: "declined",
      createdAt: new Date(now.getTime() - DAY_MS),
    },
    ...[
      { days: 3, time: "10:00", minutes: 45 },
      { days: 4, time: "15:30", minutes: 45 },
      { days: 7, time: "12:00", minutes: 60 },
    ].map(
      (t, i): SeedSlot => ({
        key: `layla-sumaya-${i + 1}`,
        batch: "layla-sumaya",
        request: "req-1005",
        by: layla,
        startsAt: louisianaAt(now, t.days, t.time),
        minutes: t.minutes,
        status: "proposed",
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      }),
    ),
  ];

  const meetings: SeedMeeting[] = [
    {
      key: "zainab-past",
      request: "req-1001",
      slot: "zainab-past",
      startsAt: pastWithZainab,
      minutes: 45,
      mode: "in-person",
      place: "Main library, second floor study room",
      agenda: "Go through my resume line by line before the career fair.",
      status: "completed",
      createdBy: amina,
      createdAt: new Date(pastWithZainab.getTime() - 5 * DAY_MS),
    },
    {
      key: "zainab-next",
      request: "req-1001",
      slot: "zainab-next-1",
      startsAt: nextWithZainab,
      minutes: 30,
      mode: "online",
      place: "Video call; Zainab sends the link",
      agenda: "Practice answers for structural internship interviews.",
      status: "upcoming",
      createdBy: amina,
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    },
    {
      key: "idris-held",
      request: "req-1006",
      slot: null,
      startsAt: heldWithIdris,
      minutes: 60,
      mode: "in-person",
      place: "Layla's office",
      agenda: "",
      status: "completed",
      createdBy: layla,
      createdAt: new Date(heldWithIdris.getTime() - 4 * DAY_MS),
      metBy: idris,
    },
  ];

  const relationships = ["req-1001", "req-1005", "req-1006"].map(relationshipId);
  await db.query("DELETE FROM meetings WHERE relationship_id = ANY ($1::uuid[])", [relationships]);
  await db.query("DELETE FROM availability_slots WHERE relationship_id = ANY ($1::uuid[])", [relationships]);

  for (const s of slots) {
    await db.query(
      `INSERT INTO availability_slots (id, relationship_id, proposed_by, batch_id, starts_at, ends_at, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        slotId(s.key),
        relationshipId(s.request),
        s.by,
        batchId(s.batch),
        s.startsAt,
        plus(s.startsAt, s.minutes),
        s.status,
        s.createdAt,
      ],
    );
  }

  for (const m of meetings) {
    const answered = m.metBy ? plus(m.startsAt, 24 * 60) : null;
    await db.query(
      `INSERT INTO meetings
         (id, relationship_id, slot_id, starts_at, duration_min, mode, place, agenda, status, created_by,
          met, outcome_by, outcome_at, check_in_sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
      [
        meetingId(m.key),
        relationshipId(m.request),
        m.slot ? slotId(m.slot) : null,
        m.startsAt,
        m.minutes,
        m.mode,
        m.place,
        m.agenda,
        m.status,
        m.createdBy,
        m.metBy ? true : null,
        m.metBy ?? null,
        answered,
        // A past meeting's check-in has gone out, so a running job does not send it again.
        m.startsAt < now ? plus(m.startsAt, 24 * 60) : null,
        m.createdAt,
      ],
    );
  }
}
