import type { Db } from "../src/db/tx";
import { SEED_ADMINS, SEED_PEOPLE, joinedAt, type SeedPerson } from "./profiles";
import { seedUserId } from "./users";

/**
 * The detail layers of the prototype's people, written after `seedProfiles`
 * (which this module needs: the core rows carry kind, approval and bio).
 * Fills professional details, education, expertise tags, mentorship
 * settings and topics, contact preferences, student details, notification
 * preferences, the saved profiles of the prototype's signed-in student, and
 * the review queue for the three pending professionals.
 *
 * Every professional lists `directory` in their participation, so with this
 * module the directory shows the prototype's 14 public professionals to a
 * visitor and 15 to a member. Copied from the prototype's mock data; every
 * person, organization and contact value is invented. Contact values use
 * reserved names and numbers: links under `example-` and `example.test`,
 * phones in the fictional 555-0100 to 555-0199 block.
 *
 * Runs as the table owner inside the seed's `withSystem` transaction; safe
 * to run again (every write upserts on stable keys).
 */

export interface SeedEducation {
  degree: string;
  field: string;
  school: string;
  year: number;
}

export interface SeedMentorship {
  status: "active" | "paused";
  /** ISO date; only with `paused`. */
  pausedUntil?: string;
  topics: string[];
  audience: string[];
  format: "one-time" | "recurring" | "either";
  mode: "online" | "in-person" | "either";
  availability: string;
  durationMin: 30 | 45 | 60;
  maxActive: number;
}

export interface SeedProfessionalDetails {
  /** The prototype id (a key of SEED_PEOPLE). */
  key: string;
  title: string;
  organization: string;
  disciplineId: string;
  yearsExperience: number;
  /** Labels; an approved professional's become approved tags, a pending one's proposed. */
  expertise: string[];
  interests: string[];
  education: SeedEducation[];
  participation: string[];
  contactMethods: string[];
  hasLinkedIn: boolean;
  hasBookingLink: boolean;
  verified: boolean;
  mentorship?: SeedMentorship;
}

export interface SeedStudentDetails {
  key: string;
  program: string;
  level: string;
  institution: string;
  goals: string;
  interests: string[];
  topicsNeeded: string[];
}

const ed = (degree: string, field: string, school: string, year: number): SeedEducation => ({ degree, field, school, year });

export const SEED_PROFESSIONAL_DETAILS: SeedProfessionalDetails[] = [
  {
    key: "layla-haddad",
    title: "Senior Coastal Engineer",
    organization: "Crescent Coastal Engineering",
    disciplineId: "coastal",
    yearsExperience: 14,
    expertise: ["Coastal restoration", "Hydraulic modeling", "Levee design", "Permitting", "Team leadership"],
    interests: ["Sediment diversion", "Living shorelines", "Mentoring women in engineering"],
    education: [
      ed("MS", "Coastal Engineering", "A Louisiana research university", 2013),
      ed("BS", "Civil Engineering", "A Louisiana research university", 2011),
    ],
    participation: ["directory", "networking", "mentoring", "speaking"],
    contactMethods: ["mest", "booking", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: true,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["professional-licensure", "internships-and-first-jobs", "leadership-and-management", "negotiating-offers"],
      audience: ["undergrad", "grad", "early-career"],
      format: "either",
      mode: "either",
      availability: "Weekday evenings after 6 PM, some Saturday mornings",
      durationMin: 45,
      maxActive: 3,
    },
  },
  {
    key: "yusuf-hassan",
    title: "Principal Data Scientist",
    organization: "Riverbend Analytics",
    disciplineId: "data",
    yearsExperience: 11,
    expertise: ["Machine learning", "Forecasting", "Applied statistics", "Python", "MLOps"],
    interests: ["Teaching", "Open data", "Arabic calligraphy"],
    education: [
      ed("PhD", "Statistics", "A Texas research university", 2015),
      ed("BS", "Mathematics", "A Louisiana university", 2010),
    ],
    participation: ["directory", "networking", "mentoring", "collaborating"],
    contactMethods: ["mest", "email"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["graduate-school", "research-and-publishing", "technical-interviews", "career-change-into-tech"],
      audience: ["grad", "early-career", "mid-career"],
      format: "recurring",
      mode: "online",
      availability: "Sunday afternoons",
      durationMin: 60,
      maxActive: 2,
    },
  },
  {
    key: "omar-siddiqui",
    title: "Staff Software Engineer",
    organization: "Pelican Health Technologies",
    disciplineId: "software",
    yearsExperience: 9,
    expertise: ["TypeScript", "Distributed systems", "Healthcare interoperability", "System design", "Hiring"],
    interests: ["Career changers", "Developer tooling", "Cycling"],
    education: [
      ed("BS", "Accounting", "A Louisiana university", 2014),
    ],
    participation: ["directory", "networking", "mentoring", "speaking", "volunteering"],
    contactMethods: ["mest", "linkedin", "booking"],
    hasLinkedIn: true,
    hasBookingLink: true,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["career-change-into-tech", "technical-interviews", "resume-and-portfolio", "internships-and-first-jobs"],
      audience: ["undergrad", "early-career", "mid-career"],
      format: "one-time",
      mode: "online",
      availability: "Weekday lunch hours",
      durationMin: 30,
      maxActive: 4,
    },
  },
  {
    key: "fatima-noor",
    title: "Epidemiologist",
    organization: "Gulf South Public Health Institute",
    disciplineId: "public-health",
    yearsExperience: 8,
    // The prototype said "R"; tags are 2 to 40 characters.
    expertise: ["Epidemiology", "Biostatistics", "R programming", "Survey design", "Grant writing"],
    interests: ["Health equity", "Science communication"],
    education: [
      ed("MPH", "Epidemiology", "A New Orleans university", 2019),
      ed("MD", "Medicine", "A Louisiana medical school", 2017),
    ],
    participation: ["directory", "mentoring", "speaking"],
    contactMethods: ["mest"],
    hasLinkedIn: false,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "paused",
      pausedUntil: "2027-01-15",
      topics: ["graduate-school", "research-and-publishing", "choosing-a-major"],
      audience: ["undergrad", "grad"],
      format: "either",
      mode: "either",
      availability: "Paused during the fall surveillance season",
      durationMin: 45,
      maxActive: 2,
    },
  },
  {
    key: "khalid-boudreaux",
    title: "Structural Engineer",
    organization: "Boudreaux & Associates",
    disciplineId: "civil",
    yearsExperience: 22,
    expertise: ["Structural analysis", "Wind and flood loads", "Historic structures", "Small business", "Forensic engineering"],
    interests: ["Historic preservation", "Small firm ownership"],
    education: [
      ed("BS", "Civil Engineering", "A Louisiana university", 2004),
    ],
    participation: ["directory", "networking", "mentoring"],
    contactMethods: ["mest", "email", "phone"],
    hasLinkedIn: false,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["starting-a-company", "professional-licensure", "internships-and-first-jobs"],
      audience: ["undergrad", "early-career"],
      format: "one-time",
      mode: "in-person",
      availability: "Friday afternoons, North Shore or downtown",
      durationMin: 60,
      maxActive: 2,
    },
  },
  {
    key: "mariam-toure",
    title: "Process Engineer",
    organization: "Bayou Chemical Partners",
    disciplineId: "chemical",
    yearsExperience: 5,
    expertise: ["Process safety", "Distillation", "Six Sigma", "Aspen HYSYS"],
    interests: ["Process safety culture", "Women in manufacturing"],
    education: [
      ed("BS", "Chemical Engineering", "A Louisiana research university", 2021),
    ],
    participation: ["directory", "networking", "mentoring", "volunteering"],
    contactMethods: ["mest", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["internships-and-first-jobs", "choosing-a-major", "faith-and-professional-life"],
      audience: ["high-school", "undergrad"],
      format: "either",
      mode: "either",
      availability: "Weekends",
      durationMin: 30,
      maxActive: 3,
    },
  },
  {
    key: "ibrahim-okafor",
    title: "Reliability Engineer",
    organization: "Pontchartrain Energy",
    disciplineId: "petroleum",
    yearsExperience: 16,
    expertise: ["Rotating equipment", "Root cause analysis", "Asset integrity", "Offshore operations"],
    interests: ["Energy transition", "Fishing"],
    education: [
      ed("BS", "Mechanical Engineering", "A Texas university", 2010),
    ],
    participation: ["directory", "networking", "speaking"],
    contactMethods: ["mest", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: true,
  },
  {
    key: "zainab-qureshi",
    title: "Biomedical Engineer",
    organization: "Delta Medical Devices",
    disciplineId: "biomedical",
    yearsExperience: 6,
    expertise: ["Medical device design", "FDA 510(k)", "Biocompatibility testing", "SolidWorks"],
    interests: ["Regulatory affairs", "Accessibility in devices"],
    education: [
      ed("MS", "Biomedical Engineering", "A New Orleans university", 2020),
      ed("BS", "Biomedical Engineering", "A New Orleans university", 2018),
    ],
    participation: ["directory", "mentoring", "collaborating"],
    contactMethods: ["mest", "email"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["internships-and-first-jobs", "graduate-school", "resume-and-portfolio"],
      audience: ["undergrad", "grad"],
      format: "one-time",
      mode: "online",
      availability: "Tuesday and Thursday evenings",
      durationMin: 30,
      maxActive: 3,
    },
  },
  {
    key: "tariq-mansour",
    title: "Security Engineer",
    organization: "Port of the River Authority",
    disciplineId: "security",
    yearsExperience: 12,
    expertise: ["Incident response", "ICS/OT security", "NIST frameworks", "Threat modeling"],
    interests: ["Critical infrastructure", "Capture-the-flag competitions"],
    education: [
      ed("BS", "Computer Science", "A Louisiana university", 2014),
    ],
    participation: ["directory", "networking", "mentoring"],
    contactMethods: ["mest"],
    hasLinkedIn: false,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["career-change-into-tech", "technical-interviews", "internships-and-first-jobs"],
      audience: ["undergrad", "early-career"],
      format: "either",
      mode: "online",
      availability: "Weekday evenings",
      durationMin: 45,
      maxActive: 2,
    },
  },
  {
    key: "hana-yilmaz",
    title: "Research Chemist",
    organization: "A New Orleans research university",
    disciplineId: "chemistry",
    yearsExperience: 7,
    expertise: ["Polymer chemistry", "Materials characterization", "Grant writing", "Lab management"],
    interests: ["Sustainable materials", "Science outreach"],
    education: [
      ed("PhD", "Chemistry", "A northeastern research university", 2019),
      ed("BS", "Chemistry", "A Turkish university", 2013),
    ],
    participation: ["directory", "mentoring", "collaborating", "speaking"],
    contactMethods: ["mest", "email"],
    hasLinkedIn: true,
    hasBookingLink: true,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["graduate-school", "research-and-publishing", "choosing-a-major"],
      audience: ["undergrad", "grad"],
      format: "recurring",
      mode: "either",
      availability: "Wednesday afternoons",
      durationMin: 45,
      maxActive: 2,
    },
  },
  {
    key: "bilal-chowdhury",
    title: "Electrical Engineer II",
    organization: "Gulf States Utility Cooperative",
    disciplineId: "electrical",
    yearsExperience: 4,
    expertise: ["Power distribution", "Protection coordination", "Storm hardening", "ETAP"],
    interests: ["Grid resilience", "Soccer"],
    education: [
      ed("BS", "Electrical Engineering", "A Louisiana university", 2022),
    ],
    participation: ["directory", "networking", "volunteering"],
    contactMethods: ["mest", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: false,
  },
  {
    key: "nadia-el-amin",
    title: "Senior Product Designer",
    organization: "Magnolia Software",
    disciplineId: "product",
    yearsExperience: 10,
    expertise: ["Product design", "Design systems", "User research", "Prototyping", "Startups"],
    interests: ["Design education", "Typography"],
    education: [
      ed("BFA", "Graphic Design", "A southern art school", 2016),
    ],
    participation: ["directory", "networking", "mentoring", "speaking"],
    contactMethods: ["mest", "booking", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: true,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["resume-and-portfolio", "starting-a-company", "career-change-into-tech", "negotiating-offers"],
      audience: ["undergrad", "early-career", "mid-career"],
      format: "one-time",
      mode: "online",
      availability: "Thursday mornings",
      durationMin: 30,
      maxActive: 3,
    },
  },
  {
    key: "aisha-diallo",
    title: "Mechanical Design Engineer",
    organization: "Bayou Robotics",
    disciplineId: "mechanical",
    yearsExperience: 3,
    expertise: ["CAD", "Mechanism design", "Rapid prototyping", "GD&T"],
    interests: ["Robotics", "3D printing"],
    education: [
      ed("BS", "Mechanical Engineering", "A Louisiana research university", 2023),
    ],
    participation: ["directory", "networking", "mentoring"],
    contactMethods: ["mest", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["internships-and-first-jobs", "resume-and-portfolio", "technical-interviews"],
      audience: ["high-school", "undergrad"],
      format: "one-time",
      mode: "either",
      availability: "Weekends",
      durationMin: 30,
      maxActive: 3,
    },
  },
  {
    key: "yahya-abdullah",
    title: "Associate Professor of Physics",
    organization: "A New Orleans university",
    disciplineId: "physics",
    yearsExperience: 18,
    expertise: ["Computational physics", "Numerical methods", "Academic careers", "Scientific computing"],
    interests: ["Quantum simulation", "Astronomy outreach"],
    education: [
      ed("PhD", "Physics", "A midwestern research university", 2008),
      ed("BS", "Physics", "A Jordanian university", 2002),
    ],
    participation: ["directory", "mentoring", "speaking"],
    contactMethods: ["mest", "email"],
    hasLinkedIn: false,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["graduate-school", "research-and-publishing", "choosing-a-major"],
      audience: ["high-school", "undergrad", "grad"],
      format: "either",
      mode: "in-person",
      availability: "Office hours, Monday and Wednesday afternoons",
      durationMin: 45,
      maxActive: 4,
    },
  },
  {
    key: "rania-khalil",
    title: "Environmental Scientist",
    organization: "Lower Delta Conservancy",
    disciplineId: "biology",
    yearsExperience: 9,
    expertise: ["Wetland ecology", "Field research", "GIS", "Nonprofit program management"],
    interests: ["Coastal birds", "Citizen science"],
    education: [
      ed("MS", "Ecology", "A Louisiana research university", 2017),
      ed("BS", "Biology", "A Louisiana university", 2015),
    ],
    participation: ["directory", "networking", "mentoring", "volunteering"],
    contactMethods: ["mest", "email"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: true,
    mentorship: {
      status: "active",
      topics: ["internships-and-first-jobs", "graduate-school", "choosing-a-major"],
      audience: ["undergrad", "grad", "early-career"],
      format: "either",
      mode: "either",
      availability: "Flexible, by arrangement",
      durationMin: 45,
      maxActive: 2,
    },
  },
  {
    key: "dawud-jenkins",
    title: "Backend Engineer",
    organization: "Freelance",
    disciplineId: "software",
    yearsExperience: 7,
    expertise: ["Go", "PostgreSQL", "APIs", "Freelancing"],
    interests: ["Open source", "Small business tech"],
    education: [
      ed("BS", "Computer Science", "A Louisiana university", 2019),
    ],
    participation: ["directory", "networking", "mentoring"],
    contactMethods: ["mest", "booking"],
    hasLinkedIn: true,
    hasBookingLink: true,
    verified: false,
    mentorship: {
      status: "active",
      topics: ["starting-a-company", "career-change-into-tech", "technical-interviews"],
      audience: ["early-career", "mid-career"],
      format: "one-time",
      mode: "online",
      availability: "Weekday mornings",
      durationMin: 30,
      maxActive: 3,
    },
  },
  {
    key: "samira-benali",
    title: "Transportation Engineer",
    organization: "Regional Planning Commission (fictional)",
    disciplineId: "civil",
    yearsExperience: 13,
    expertise: ["Transportation planning", "Traffic engineering", "Public sector", "Complete streets"],
    interests: ["Transit", "Urbanism"],
    education: [
      ed("MS", "Civil Engineering", "A Louisiana research university", 2014),
      ed("BS", "Civil Engineering", "A Moroccan university", 2012),
    ],
    participation: ["directory", "networking", "mentoring", "speaking"],
    contactMethods: ["mest", "linkedin"],
    hasLinkedIn: true,
    hasBookingLink: false,
    verified: false,
    mentorship: {
      status: "active",
      topics: ["professional-licensure", "internships-and-first-jobs", "leadership-and-management"],
      audience: ["undergrad", "early-career"],
      format: "either",
      mode: "either",
      availability: "Weekday evenings",
      durationMin: 45,
      maxActive: 2,
    },
  },
  {
    key: "musa-grant",
    title: "IT Consultant",
    organization: "Self-employed",
    disciplineId: "software",
    yearsExperience: 2,
    expertise: ["Consulting", "Websites", "Marketing"],
    interests: [],
    education: [],
    participation: ["directory", "networking", "mentoring"],
    contactMethods: ["mest", "phone"],
    hasLinkedIn: false,
    hasBookingLink: true,
    verified: false,
    mentorship: {
      status: "active",
      topics: ["starting-a-company"],
      audience: ["undergrad", "early-career", "mid-career"],
      format: "recurring",
      mode: "online",
      availability: "Anytime",
      durationMin: 60,
      maxActive: 10,
    },
  },
];

export const SEED_STUDENT_DETAILS: SeedStudentDetails[] = [
  {
    key: "amina-rahman",
    program: "BS Civil Engineering, junior",
    level: "undergrad",
    institution: "A Louisiana research university",
    goals: "Land a coastal or water-resources internship for summer 2027 and understand the path to a PE license.",
    interests: ["Coastal engineering", "Water resources", "Hydraulics"],
    topicsNeeded: ["internships-and-first-jobs", "professional-licensure"],
  },
  {
    key: "hamza-ali",
    program: "MS Computer Science, first year",
    level: "grad",
    institution: "A New Orleans university",
    goals: "Decide between a research track and industry, and prepare for software interviews.",
    interests: ["Machine learning", "Backend systems"],
    topicsNeeded: ["technical-interviews", "research-and-publishing"],
  },
  {
    key: "sumaya-osman",
    program: "BS Biology, senior",
    level: "undergrad",
    institution: "A Louisiana university",
    goals: "Choose between an MPH, medical school, and a research position after graduation.",
    interests: ["Public health", "Epidemiology"],
    topicsNeeded: ["graduate-school", "choosing-a-major"],
  },
  {
    key: "idris-fofana",
    program: "High school senior",
    level: "high-school",
    institution: "A New Orleans high school",
    goals: "Pick an engineering major and find out what engineers actually do all day.",
    interests: ["Robotics", "Cars"],
    topicsNeeded: ["choosing-a-major"],
  },
  {
    key: "leen-saleh",
    program: "Early career, 2 years",
    level: "early-career",
    institution: "Software developer at a local agency",
    goals: "Move from agency web work into a product engineering role and negotiate a better offer.",
    interests: ["Product engineering", "Design systems"],
    topicsNeeded: ["negotiating-offers", "technical-interviews"],
  },
];


/** The prototype's signed-in student keeps two saved mentors. */
export const SEED_SAVED: readonly (readonly [saver: string, saved: string])[] = [
  ["amina-rahman", "layla-haddad"],
  ["amina-rahman", "khalid-boudreaux"],
];

/** Invented contact values; nothing here can reach a real person. */
export function seedLinkedinUrl(key: string): string {
  return `https://www.linkedin.com/in/example-${key}`;
}

export function seedBookingUrl(key: string): string {
  return `https://cal.example.test/${key}`;
}

/** +1 504 555 01xx: the fictional block, one number per professional. */
export function seedPhone(index: number): string {
  return `+1504555${String(100 + index).padStart(4, "0")}`;
}

/**
 * What a professional shares with signed-in members: every method they use
 * except requests through MEST and the phone (never shared unless the
 * professional opts in, and none of the seeded people did).
 */
export function seedShareWithMembers(methods: readonly string[]): string[] {
  return methods.filter((method) => method !== "mest" && method !== "phone");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function person(key: string): SeedPerson {
  const found = [...SEED_PEOPLE, ...SEED_ADMINS].find((p) => p.key === key);
  if (!found) throw new Error(`seed: no core profile for ${key}`);
  return found;
}

/** Enum order, as the database stores the arrays. */
function inOrder(values: readonly string[], order: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

const METHOD_ORDER = ["mest", "email", "linkedin", "booking", "phone"];
const PARTICIPATION_ORDER = ["directory", "networking", "mentoring", "volunteering", "speaking", "collaborating"];
const AUDIENCE_ORDER = ["high-school", "undergrad", "grad", "early-career", "mid-career"];

async function seedExpertise(db: Db, profileId: string, labels: string[], approved: boolean): Promise<void> {
  await db.query("DELETE FROM profile_expertise WHERE profile_id = $1", [profileId]);
  for (const label of labels) {
    if (approved) {
      await db.query(
        `INSERT INTO expertise_tags (label, slug, status)
         VALUES ($1, expertise_tag_slug($1), 'approved')
         ON CONFLICT ((lower(label))) DO UPDATE SET status = 'approved'`,
        [label],
      );
    } else {
      await db.query(
        `INSERT INTO expertise_tags (label, slug, status, proposed_by)
         VALUES ($1, expertise_tag_slug($1), 'proposed', $2)
         ON CONFLICT ((lower(label))) DO NOTHING`,
        [label, profileId],
      );
    }
    await db.query(
      `INSERT INTO profile_expertise (profile_id, tag_id)
       SELECT $1, id FROM expertise_tags WHERE lower(label) = lower($2)
       ON CONFLICT DO NOTHING`,
      [profileId, label],
    );
  }
}

async function seedProfessional(db: Db, details: SeedProfessionalDetails, index: number): Promise<void> {
  const core = person(details.key);
  const id = seedUserId(details.key);
  const approved = core.approval === "approved";
  const methods = inOrder(details.contactMethods, METHOD_ORDER);

  await db.query("UPDATE profiles SET linkedin_url = $2 WHERE id = $1", [
    id,
    details.hasLinkedIn ? seedLinkedinUrl(details.key) : null,
  ]);

  // Verified a few days after joining; verified_at is part of the upsert, so
  // a re-run keeps the verification instead of tripping the affiliation rule.
  const verifiedAt = details.verified ? new Date(joinedAt(core).getTime() + 3 * DAY_MS) : null;
  await db.query(
    `INSERT INTO professional_details
       (profile_id, title, organization, discipline_id, years_experience, participation, interests,
        verified, verified_method, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6::participation[], $7, $8, $9, $10)
     ON CONFLICT (profile_id) DO UPDATE
       SET title = EXCLUDED.title,
           organization = EXCLUDED.organization,
           discipline_id = EXCLUDED.discipline_id,
           years_experience = EXCLUDED.years_experience,
           participation = EXCLUDED.participation,
           interests = EXCLUDED.interests,
           verified = EXCLUDED.verified,
           verified_method = EXCLUDED.verified_method,
           verified_at = EXCLUDED.verified_at`,
    [
      id,
      details.title,
      details.organization,
      details.disciplineId,
      details.yearsExperience,
      inOrder(details.participation, PARTICIPATION_ORDER),
      details.interests,
      details.verified,
      details.verified ? "work_email" : null,
      verifiedAt,
    ],
  );

  await db.query("DELETE FROM education WHERE profile_id = $1", [id]);
  for (const entry of details.education) {
    await db.query("INSERT INTO education (profile_id, degree, field, school, year) VALUES ($1, $2, $3, $4, $5)", [
      id,
      entry.degree,
      entry.field,
      entry.school,
      entry.year,
    ]);
  }

  await seedExpertise(db, id, details.expertise, approved);

  const m = details.mentorship;
  await db.query(
    `INSERT INTO mentorship_settings
       (profile_id, status, previous_status, paused_until, audience, format, mode, availability, duration_min, max_active)
     VALUES ($1, $2, NULL, $3, $4::audience[], $5, $6, $7, $8, $9)
     ON CONFLICT (profile_id) DO UPDATE
       SET status = EXCLUDED.status,
           previous_status = NULL,
           paused_until = EXCLUDED.paused_until,
           audience = EXCLUDED.audience,
           format = EXCLUDED.format,
           mode = EXCLUDED.mode,
           availability = EXCLUDED.availability,
           duration_min = EXCLUDED.duration_min,
           max_active = EXCLUDED.max_active`,
    [
      id,
      m ? m.status : "off",
      m?.status === "paused" ? (m.pausedUntil ?? null) : null,
      m ? inOrder(m.audience, AUDIENCE_ORDER) : [],
      m?.format ?? "either",
      m?.mode ?? "either",
      m?.availability ?? null,
      m?.durationMin ?? 45,
      m?.maxActive ?? 3,
    ],
  );
  await db.query("DELETE FROM mentor_topics WHERE profile_id = $1", [id]);
  for (const topic of m?.topics ?? []) {
    await db.query("INSERT INTO mentor_topics (profile_id, topic_id) VALUES ($1, $2)", [id, topic]);
  }

  await db.query(
    `INSERT INTO contact_preferences (profile_id, methods, share_with_members, contact_email, phone, booking_url)
     VALUES ($1, $2::contact_method[], $3::contact_method[], NULL, $4, $5)
     ON CONFLICT (profile_id) DO UPDATE
       SET methods = EXCLUDED.methods,
           share_with_members = EXCLUDED.share_with_members,
           contact_email = NULL,
           phone = EXCLUDED.phone,
           booking_url = EXCLUDED.booking_url`,
    [
      id,
      methods,
      seedShareWithMembers(methods),
      methods.includes("phone") ? seedPhone(index) : null,
      details.hasBookingLink || methods.includes("booking") ? seedBookingUrl(details.key) : null,
    ],
  );

  if (core.approval === "pending") {
    await db.query(
      `INSERT INTO profile_reviews (profile_id, snapshot, submitted_at)
       SELECT $1, profile_snapshot($1), $2
        WHERE NOT EXISTS (SELECT 1 FROM profile_reviews WHERE profile_id = $1 AND decision IS NULL)`,
      [id, joinedAt(core)],
    );
  }
}

async function seedStudent(db: Db, details: SeedStudentDetails): Promise<void> {
  await db.query(
    `INSERT INTO student_details (profile_id, program, level, institution, goals, interests, topics_needed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (profile_id) DO UPDATE
       SET program = EXCLUDED.program,
           level = EXCLUDED.level,
           institution = EXCLUDED.institution,
           goals = EXCLUDED.goals,
           interests = EXCLUDED.interests,
           topics_needed = EXCLUDED.topics_needed`,
    [
      seedUserId(details.key),
      details.program,
      details.level,
      details.institution,
      details.goals,
      details.interests,
      details.topicsNeeded,
    ],
  );
}

/** Writes every detail layer for the seeded people. Call after `seedProfiles`. */
export async function seedProfilesDetails(db: Db): Promise<void> {
  // Approved professionals first, so a label they share with a pending one is an approved tag.
  const ordered = [...SEED_PROFESSIONAL_DETAILS]
    .map((details, index) => ({ details, index }))
    .sort((a, b) => Number(person(a.details.key).approval !== "approved") - Number(person(b.details.key).approval !== "approved"));
  for (const { details, index } of ordered) {
    await seedProfessional(db, details, index);
  }
  for (const details of SEED_STUDENT_DETAILS) {
    await seedStudent(db, details);
  }
  for (const someone of [...SEED_PEOPLE, ...SEED_ADMINS]) {
    await db.query("INSERT INTO notification_preferences (profile_id) VALUES ($1) ON CONFLICT (profile_id) DO NOTHING", [
      seedUserId(someone.key),
    ]);
  }
  for (const [saver, saved] of SEED_SAVED) {
    await db.query("INSERT INTO saved_profiles (saver_id, saved_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      seedUserId(saver),
      seedUserId(saved),
    ]);
  }
}
