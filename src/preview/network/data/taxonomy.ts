/**
 * Controlled vocabularies for the professional network. These lists are the
 * prototype's stand-in for the `disciplines`, `expertise_tags` and
 * `mentorship_topics` tables described in docs/professional-network.
 */

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

/** Mentorship topics a mentor can offer and a mentee can ask for. */
export const mentorshipTopics = [
  "Internships and first jobs",
  "Graduate school applications",
  "Professional licensure (PE, FE)",
  "Technical interviews",
  "Resume and portfolio review",
  "Research and publishing",
  "Career change into tech",
  "Leadership and management",
  "Starting a company",
  "Negotiating offers",
  "Choosing a major or specialization",
  "Faith and professional life",
] as const;

export type MentorshipTopic = (typeof mentorshipTopics)[number];

export const audiences = [
  { id: "high-school", label: "High school students" },
  { id: "undergrad", label: "Undergraduates" },
  { id: "grad", label: "Graduate students" },
  { id: "early-career", label: "Early career (0–5 yrs)" },
  { id: "mid-career", label: "Mid-career" },
] as const;

export type AudienceId = (typeof audiences)[number]["id"];

export const experienceBands = [
  { id: "student", label: "Student", min: 0, max: 0 },
  { id: "early", label: "0–5 years", min: 0, max: 5 },
  { id: "mid", label: "6–12 years", min: 6, max: 12 },
  { id: "senior", label: "13–20 years", min: 13, max: 20 },
  { id: "veteran", label: "20+ years", min: 21, max: 99 },
] as const;

export type ExperienceBandId = (typeof experienceBands)[number]["id"];

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
