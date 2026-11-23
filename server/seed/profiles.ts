import type { Db } from "../src/db/tx";
import { seedUserId } from "./users";

/**
 * The prototype's 23 fictional people (18 professionals, 5 students) as core
 * `profiles` rows, plus two administrators. Every person and organization is
 * invented. Detail tables (title, organization, expertise, mentorship
 * settings, contact preferences) are filled by `profiles-details.ts` once
 * their schema exists.
 *
 * Approved professionals: 15, of whom Tariq Mansour is members-only, so a
 * visitor's directory lists 14 and a member's 15. Dawud Jenkins, Samira
 * Benali and Musa Grant wait in the review queue.
 */

export interface SeedPerson {
  /** The prototype id; also the email local part (`<key>@example.test`). */
  key: string;
  firstName: string;
  lastName: string;
  credentials?: string;
  kind: "professional" | "student";
  approval: "approved" | "pending" | "declined";
  visibility: "public" | "members" | "hidden";
  location: string;
  /** Professionals only (120 to 1200 characters). */
  bio?: string;
  /** Sign-up date (ISO date), or a Date relative to when the seed runs. */
  joined: string | Date;
  /** Days since last activity, relative to when the seed runs. */
  activeDaysAgo?: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function joinedAt(person: Pick<SeedPerson, "joined">): Date {
  return typeof person.joined === "string" ? new Date(`${person.joined}T15:00:00Z`) : person.joined;
}

export function lastActiveAt(person: Pick<SeedPerson, "joined" | "activeDaysAgo">): Date {
  return person.activeDaysAgo === undefined ? joinedAt(person) : daysAgo(person.activeDaysAgo);
}

export const SEED_PEOPLE: SeedPerson[] = [
  {
    key: "layla-haddad",
    firstName: "Layla",
    lastName: "Haddad",
    credentials: "PE",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I design levee and marsh restoration projects along the Louisiana coast and lead a team of six engineers. Before consulting I spent five years with a state coastal agency. I enjoy helping students see how a civil degree becomes a coastal career, and talking honestly about licensure, consulting hours, and leading a team for the first time.",
    joined: "2026-06-02",
    activeDaysAgo: 1,
  },
  {
    key: "yusuf-hassan",
    firstName: "Yusuf",
    lastName: "Hassan",
    credentials: "PhD",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "Metairie, LA",
    bio: "I build forecasting and risk models for logistics companies on the Gulf Coast, after a PhD in applied statistics and a few years in academia. I mentor people moving from research into industry and students deciding between a master's and going straight to work.",
    joined: "2026-06-10",
    activeDaysAgo: 3,
  },
  {
    key: "omar-siddiqui",
    firstName: "Omar",
    lastName: "Siddiqui",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I work on patient-facing systems for a regional health technology company: scheduling, records access, and the integrations behind them. I came to software through a bootcamp after an accounting degree, so I have a soft spot for career changers and self-taught engineers.",
    joined: "2026-06-14",
    activeDaysAgo: 0,
  },
  {
    key: "fatima-noor",
    firstName: "Fatima",
    lastName: "Noor",
    credentials: "MD, MPH",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I study respiratory illness surveillance for parish health departments and teach a biostatistics seminar each spring. I am glad to talk with students weighing medicine against public health, or who want to understand what research careers outside a lab actually look like.",
    joined: "2026-06-20",
    activeDaysAgo: 12,
  },
  {
    key: "khalid-boudreaux",
    firstName: "Khalid",
    lastName: "Boudreaux",
    credentials: "PE",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "Mandeville, LA",
    bio: "I run a small structural practice that does hurricane retrofits, historic building assessments and new residential work across the North Shore and the city. I have hired a lot of young engineers and have strong opinions about what makes an internship useful.",
    joined: "2026-07-01",
    activeDaysAgo: 6,
  },
  {
    key: "mariam-toure",
    firstName: "Mariam",
    lastName: "Touré",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "Norco, LA",
    bio: "I work in a river-parish chemical plant on process safety and unit optimization. I am early enough in my career to remember what the first year felt like, and I am happy to talk about plant life, shift work, and being one of few women on site.",
    joined: "2026-07-05",
    activeDaysAgo: 2,
  },
  {
    key: "ibrahim-okafor",
    firstName: "Ibrahim",
    lastName: "Okafor",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "Houma, LA",
    bio: "I keep offshore and onshore production equipment running for an independent operator. I am in the directory for networking and to speak at events; I am not taking mentees at the moment but am glad to be contacted about industry questions.",
    joined: "2026-07-09",
    activeDaysAgo: 20,
  },
  {
    key: "zainab-qureshi",
    firstName: "Zainab",
    lastName: "Qureshi",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I design and test implantable sensors and manage our FDA submissions. I like talking about the gap between a biomedical degree and a device job, and how to get into regulatory work if the lab is not for you.",
    joined: "2026-07-15",
    activeDaysAgo: 4,
  },
  {
    key: "tariq-mansour",
    firstName: "Tariq",
    lastName: "Mansour",
    kind: "professional",
    approval: "approved",
    visibility: "members",
    location: "New Orleans, LA",
    bio: "I lead security operations for a port authority: network defense, incident response, and compliance for industrial control systems. Happy to talk to anyone curious about security careers, certifications that are worth it, and the ones that are not.",
    joined: "2026-07-22",
    activeDaysAgo: 8,
  },
  {
    key: "hana-yilmaz",
    firstName: "Hana",
    lastName: "Yılmaz",
    credentials: "PhD",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I run a polymer chemistry lab working on biodegradable coatings. I advise graduate students daily and am glad to help undergraduates understand what a PhD actually involves, how funding works, and whether it is the right path.",
    joined: "2026-08-01",
    activeDaysAgo: 1,
  },
  {
    key: "bilal-chowdhury",
    firstName: "Bilal",
    lastName: "Chowdhury",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "Kenner, LA",
    bio: "I work on distribution planning and storm hardening for a utility cooperative. I joined the directory to meet other engineers in the area and compare notes; I am not mentoring yet but may be in a year or two.",
    joined: "2026-08-12",
    activeDaysAgo: 5,
  },
  {
    key: "nadia-el-amin",
    firstName: "Nadia",
    lastName: "El-Amin",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I lead design for a small logistics software company and previously worked at two startups that did not make it, which taught me more than the one that did. I mentor designers and engineers who want to work closer to the product.",
    joined: "2026-08-18",
    activeDaysAgo: 2,
  },
  {
    key: "aisha-diallo",
    firstName: "Aisha",
    lastName: "Diallo",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I design actuators and enclosures for inspection robots used in refineries and water systems. Recent enough graduate to remember the job search clearly; I especially like helping students build a portfolio that actually gets read.",
    joined: "2026-09-02",
    activeDaysAgo: 1,
  },
  {
    key: "yahya-abdullah",
    firstName: "Yahya",
    lastName: "Abdullah",
    credentials: "PhD",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I teach and research computational physics. My students go on to graduate programs, national labs, and increasingly to data and quantitative finance roles, so I have seen most of the paths a physics degree opens. I prefer in-person conversations on campus.",
    joined: "2026-09-10",
    activeDaysAgo: 7,
  },
  {
    key: "rania-khalil",
    firstName: "Rania",
    lastName: "Khalil",
    kind: "professional",
    approval: "approved",
    visibility: "public",
    location: "Belle Chasse, LA",
    bio: "I monitor wetland health and manage field programs for a conservation nonprofit. Good person to talk to about science careers outside academia, nonprofit work, and field research in Louisiana.",
    joined: "2026-09-14",
    activeDaysAgo: 9,
  },
  {
    key: "dawud-jenkins",
    firstName: "Dawud",
    lastName: "Jenkins",
    kind: "professional",
    approval: "pending",
    visibility: "public",
    location: "Baton Rouge, LA",
    bio: "Independent backend developer working mostly with Louisiana small businesses and nonprofits. I help people figure out whether freelancing is for them and how to price their first contracts.",
    joined: daysAgo(2),
    activeDaysAgo: 2,
  },
  {
    key: "samira-benali",
    firstName: "Samira",
    lastName: "Benali",
    credentials: "PE",
    kind: "professional",
    approval: "pending",
    visibility: "public",
    location: "New Orleans, LA",
    bio: "I plan and review roadway, transit and bicycle projects for the metro region. I am interested in networking with other public-sector engineers and in mentoring students curious about planning careers.",
    joined: daysAgo(1),
    activeDaysAgo: 1,
  },
  {
    key: "musa-grant",
    firstName: "Musa",
    lastName: "Grant",
    kind: "professional",
    approval: "pending",
    visibility: "public",
    location: "Slidell, LA",
    // Lengthened from the prototype to meet the 120-character minimum; still
    // the promotional profile the seeded report is about.
    bio: "Helping businesses grow with technology. Websites, marketing and IT support for any budget. Reach out today for a free consultation and a custom quote.",
    joined: daysAgo(3),
    activeDaysAgo: 3,
  },
  {
    key: "amina-rahman",
    firstName: "Amina",
    lastName: "Rahman",
    kind: "student",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    joined: "2026-09-20",
  },
  {
    key: "hamza-ali",
    firstName: "Hamza",
    lastName: "Ali",
    kind: "student",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    joined: "2026-09-28",
  },
  {
    key: "sumaya-osman",
    firstName: "Sumaya",
    lastName: "Osman",
    kind: "student",
    approval: "approved",
    visibility: "public",
    location: "Kenner, LA",
    joined: "2026-10-03",
  },
  {
    key: "idris-fofana",
    firstName: "Idris",
    lastName: "Fofana",
    kind: "student",
    approval: "approved",
    visibility: "public",
    location: "New Orleans, LA",
    joined: "2026-10-10",
  },
  {
    key: "leen-saleh",
    firstName: "Leen",
    lastName: "Saleh",
    kind: "student",
    approval: "approved",
    visibility: "public",
    location: "Metairie, LA",
    joined: "2026-10-14",
  },
];

/**
 * Two administrators, the minimum the platform keeps (A7). Approved
 * professionals so sign-in lands on the member home, and hidden so they
 * never appear in the directory.
 */
export const SEED_ADMINS: SeedPerson[] = [
  {
    key: "admin",
    firstName: "Admin",
    lastName: "One",
    kind: "professional",
    approval: "approved",
    visibility: "hidden",
    location: "New Orleans, LA",
    joined: "2026-06-01",
    activeDaysAgo: 0,
  },
  {
    key: "admin2",
    firstName: "Admin",
    lastName: "Two",
    kind: "professional",
    approval: "approved",
    visibility: "hidden",
    location: "New Orleans, LA",
    joined: "2026-06-01",
    activeDaysAgo: 3,
  },
];

/**
 * Inserts or refreshes the profiles for every seed person and administrator
 * (whose `users` rows `seedUsers` wrote first), and the two administrator
 * roles. Runs as the table owner, so the owner-guard trigger lets the
 * protected columns (`kind`, `approval_state`, `mission_accepted_at`,
 * `last_active_at`) through.
 */
export async function seedProfiles(db: Db): Promise<void> {
  for (const person of [...SEED_PEOPLE, ...SEED_ADMINS]) {
    await db.query(
      `INSERT INTO profiles (id, first_name, last_name, credentials, kind, approval_state, visibility,
                             location, bio, mission_accepted_at, last_active_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10)
       ON CONFLICT (id) DO UPDATE
         SET first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             credentials = EXCLUDED.credentials,
             kind = EXCLUDED.kind,
             approval_state = EXCLUDED.approval_state,
             visibility = EXCLUDED.visibility,
             location = EXCLUDED.location,
             bio = EXCLUDED.bio,
             mission_accepted_at = EXCLUDED.mission_accepted_at,
             last_active_at = EXCLUDED.last_active_at,
             admin_hidden_at = NULL,
             anonymized_at = NULL`,
      [
        seedUserId(person.key),
        person.firstName,
        person.lastName,
        person.credentials ?? null,
        person.kind,
        person.approval,
        person.visibility,
        person.location,
        person.bio ?? null,
        joinedAt(person),
        lastActiveAt(person),
      ],
    );
  }

  for (const admin of SEED_ADMINS) {
    await db.query(
      `INSERT INTO admin_roles (profile_id, granted_at) VALUES ($1, $2)
       ON CONFLICT (profile_id) DO UPDATE SET revoked_at = NULL`,
      [seedUserId(admin.key), joinedAt(admin)],
    );
  }
}
