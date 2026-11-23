/**
 * Controlled vocabularies for the MEST Network, shared by the server (which
 * seeds the `disciplines`, `mentorship_topics` and `expertise_tags` tables from
 * them) and the screens. Copied from the prototype's taxonomy; mentorship
 * topics now carry slug ids so requests and settings store ids, not labels.
 * Administrators may add disciplines and topics later, so code that validates
 * input checks the id format here and leaves membership to the database.
 */

import type {
  DeclineReason,
  ExperienceBandId,
  ReportReason,
  VerifiedMethod,
} from "./types/common";

export type DisciplineGroup = "Engineering" | "Science" | "Technology";

export interface Discipline {
  id: string;
  label: string;
  group: DisciplineGroup;
}

export const disciplines: Discipline[] = [
  { id: "civil", label: "Civil & structural", group: "Engineering" },
  { id: "coastal", label: "Coastal & environmental", group: "Engineering" },
  { id: "chemical", label: "Chemical & process", group: "Engineering" },
  { id: "mechanical", label: "Mechanical", group: "Engineering" },
  { id: "electrical", label: "Electrical & power", group: "Engineering" },
  { id: "biomedical", label: "Biomedical", group: "Engineering" },
  { id: "petroleum", label: "Petroleum & energy", group: "Engineering" },
  { id: "biology", label: "Biology & life sciences", group: "Science" },
  { id: "public-health", label: "Public health & biostatistics", group: "Science" },
  { id: "chemistry", label: "Chemistry & materials", group: "Science" },
  { id: "physics", label: "Physics & mathematics", group: "Science" },
  { id: "software", label: "Software engineering", group: "Technology" },
  { id: "data", label: "Data science & AI", group: "Technology" },
  { id: "security", label: "Cybersecurity", group: "Technology" },
  { id: "product", label: "Product & design", group: "Technology" },
];

export const disciplineById = (id: string) => disciplines.find((d) => d.id === id);

export const disciplineGroups: DisciplineGroup[] = ["Engineering", "Science", "Technology"];

export interface MentorshipTopic {
  id: string;
  label: string;
}

/** Mentorship topics a mentor can offer and a mentee can ask for. */
export const mentorshipTopics: MentorshipTopic[] = [
  { id: "internships-and-first-jobs", label: "Internships and first jobs" },
  { id: "graduate-school", label: "Graduate school applications" },
  { id: "professional-licensure", label: "Professional licensure (PE, FE)" },
  { id: "technical-interviews", label: "Technical interviews" },
  { id: "resume-and-portfolio", label: "Resume and portfolio review" },
  { id: "research-and-publishing", label: "Research and publishing" },
  { id: "career-change-into-tech", label: "Career change into tech" },
  { id: "leadership-and-management", label: "Leadership and management" },
  { id: "starting-a-company", label: "Starting a company" },
  { id: "negotiating-offers", label: "Negotiating offers" },
  { id: "choosing-a-major", label: "Choosing a major or specialization" },
  { id: "faith-and-professional-life", label: "Faith and professional life" },
];

export const topicById = (id: string) => mentorshipTopics.find((t) => t.id === id);

export const audiences = [
  { id: "high-school", label: "High school students" },
  { id: "undergrad", label: "Undergraduates" },
  { id: "grad", label: "Graduate students" },
  { id: "early-career", label: "Early career (0–5 yrs)" },
  { id: "mid-career", label: "Mid-career" },
] as const;

export type AudienceId = (typeof audiences)[number]["id"];

/**
 * Directory experience bands. The directory view derives the band from
 * `years_experience` (02 section 4.2), so the exact number stays private.
 */
export const experienceBands: { id: ExperienceBandId; label: string; min: number; max: number }[] = [
  { id: "0-2", label: "0 to 2 years", min: 0, max: 2 },
  { id: "3-9", label: "3 to 9 years", min: 3, max: 9 },
  { id: "10-19", label: "10 to 19 years", min: 10, max: 19 },
  { id: "20+", label: "20 years or more", min: 20, max: Number.POSITIVE_INFINITY },
];

export function experienceBandFor(years: number): ExperienceBandId {
  const band = experienceBands.find((b) => years >= b.min && years <= b.max);
  return band ? band.id : "0-2";
}

export const contactMethods = [
  { id: "mest", label: "Requests through MEST", note: "Members send a request; you decide whether to reply. Nothing personal is shown." },
  { id: "email", label: "Email", note: "Shown only to members you have accepted." },
  { id: "linkedin", label: "LinkedIn", note: "Your public profile link." },
  { id: "booking", label: "Scheduling link", note: "Calendly, Cal.com or similar. Shown after you accept a request." },
  { id: "phone", label: "Phone or text", note: "Never shown publicly. Shared only with accepted mentees." },
] as const;

export type ContactMethodId = (typeof contactMethods)[number]["id"];

export const participationOptions = [
  { id: "directory", label: "Professional directory", note: "Appear in the public directory." },
  { id: "networking", label: "Open to networking", note: "Other members may send introduction requests." },
  { id: "mentoring", label: "Mentorship", note: "Offer guidance to students and early-career members." },
  { id: "volunteering", label: "Volunteering", note: "Help run MEST events and programs." },
  { id: "speaking", label: "Speaking at events", note: "Give a talk or sit on a panel." },
  { id: "collaborating", label: "Collaborating on projects", note: "Research, open source, community builds." },
] as const;

export type ParticipationId = (typeof participationOptions)[number]["id"];

/** Reasons a mentor can choose when declining (03 section 7.2). */
export const declineReasonOptions: { id: Exclude<DeclineReason, "member_left">; label: string }[] = [
  { id: "outside_experience", label: "Outside my expertise" },
  { id: "no_capacity", label: "No capacity right now" },
  { id: "not_fit", label: "Not a fit" },
  { id: "other", label: "Other" },
];

/** Reasons a member can choose when reporting a profile (requirement ADM-4). */
export const reportReasonOptions: { id: ReportReason; label: string }[] = [
  { id: "promotional", label: "Promotional or off-topic" },
  { id: "misrepresentation", label: "Misrepresentation" },
  { id: "unsafe", label: "Harassment or unsafe" },
  { id: "spam", label: "Spam" },
  { id: "other", label: "Other" },
];

/** How an administrator verified an affiliation (03 section 8.1). */
export const verifiedMethodOptions: { id: VerifiedMethod; label: string }[] = [
  { id: "work_email", label: "Work email domain" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "personal_knowledge", label: "Personal knowledge" },
];

/* Id lists as non-empty tuples, for z.enum. */
type Ids<T extends readonly { id: string }[]> = [T[number]["id"], ...T[number]["id"][]];
const ids = <T extends readonly { id: string }[]>(items: T) => items.map((i) => i.id) as Ids<T>;

export const audienceIds = ids(audiences);
export const contactMethodIds = ids(contactMethods);
export const participationIds = ids(participationOptions);
