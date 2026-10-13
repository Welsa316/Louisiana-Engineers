/**
 * Replaceable site content.
 *
 * Everything an organizer will need to update before launch lives here:
 * events, contact channels, social links, and the membership endpoint.
 * Placeholder entries are flagged with `placeholder: true` and render
 * with a visible "Sample" marker so nothing invented is mistaken for fact.
 */

export const org = {
  name: "Muslim Engineering Society of Louisiana",
  short: "MESL",
  region: "Louisiana, USA",
  tagline: "Engineering progress. Building community.",
  description:
    "Connecting Muslim engineers, students, and innovators across Louisiana through mentorship, collaboration, and shared purpose.",
};

export const navigation = [
  { label: "Purpose", href: "#purpose" },
  { label: "Pillars", href: "#pillars" },
  { label: "Community", href: "#community" },
  { label: "Events", href: "#events" },
] as const;

export const pillars = [
  {
    index: "01",
    title: "Connect",
    summary:
      "Build meaningful relationships with engineers and professionals across disciplines.",
    detail:
      "Civil, mechanical, electrical, chemical, petroleum, software, environmental. The common ground is the work, and the people who do it well.",
  },
  {
    index: "02",
    title: "Mentor",
    summary:
      "Support students and emerging engineers through guidance, knowledge sharing, and opportunity.",
    detail:
      "The first internship, the licensure exam, the first job offer. Every one of these is easier with someone who has already been through it.",
  },
  {
    index: "03",
    title: "Advance",
    summary:
      "Encourage innovation, professional excellence, and contributions to the broader community.",
    detail:
      "Technical rigor as a form of service. Work that holds up, and a community that holds people to it.",
  },
] as const;

export type EventItem = {
  /** ISO date, used for the <time> element. */
  date: string;
  day: string;
  month: string;
  title: string;
  format: string;
  location: string;
  description: string;
  /** Marks illustrative sample content that must be replaced before launch. */
  placeholder: boolean;
};

/**
 * Sample listings. Replace with confirmed events, dates, venues and
 * registration links. Every entry below is illustrative.
 */
export const events: EventItem[] = [
  {
    date: "2027-02-12",
    day: "12",
    month: "Feb",
    title: "Networking evening",
    format: "Professional networking",
    location: "Baton Rouge",
    description:
      "An evening for engineers and technical professionals across the state to meet, trade perspectives, and find collaborators.",
    placeholder: true,
  },
  {
    date: "2027-03-05",
    day: "05",
    month: "Mar",
    title: "Technical talk",
    format: "Lecture and discussion",
    location: "New Orleans",
    description:
      "A practitioner-led session on engineering work shaping Louisiana, followed by open discussion.",
    placeholder: true,
  },
  {
    date: "2027-03-26",
    day: "26",
    month: "Mar",
    title: "Student workshop",
    format: "Workshop",
    location: "Lafayette",
    description:
      "Hands-on career guidance for engineering students: internships, licensure, and the first years of practice.",
    placeholder: true,
  },
  {
    date: "2027-04-17",
    day: "17",
    month: "Apr",
    title: "Community gathering",
    format: "Members and families",
    location: "Statewide",
    description:
      "A gathering for members, students, and families. Less agenda, more conversation.",
    placeholder: true,
  },
];

export const membershipRoles = [
  "Engineering student",
  "Practicing engineer",
  "Educator or researcher",
  "Industry professional",
] as const;

/**
 * POST endpoint for the membership form (for example a form service URL).
 * Leave empty until a destination exists; the form then shows an honest
 * "enrollment opening soon" state instead of pretending to submit.
 */
export const membershipEndpoint: string =
  import.meta.env.VITE_MEMBERSHIP_ENDPOINT ?? "";

/** Contact channels. Empty strings render as "to be announced". */
export const contact = {
  email: "",
  city: "Louisiana, USA",
};

export const socials: { label: string; href: string }[] = [
  { label: "LinkedIn", href: "" },
  { label: "Instagram", href: "" },
];

export const photoCredits = [
  {
    subject: "Bridge over water",
    author: "Viktor Solomonik",
    href: "https://unsplash.com/photos/3sH1ji73YdE",
  },
  {
    subject: "Steel lattice",
    author: "Nick Fewings",
    href: "https://unsplash.com/photos/yIbnj4mTBPE",
  },
  {
    subject: "Conversation outdoors",
    author: "Small Group Network",
    href: "https://unsplash.com/photos/bxiOjnbjRM0",
  },
  {
    subject: "Engineers with drawings",
    author: "Fiqih Alfarish",
    href: "https://unsplash.com/photos/lPUalY6OKDU",
  },
  {
    subject: "Reviewing plans",
    author: "ThisisEngineering",
    href: "https://unsplash.com/photos/Fc9jeKBxlBI",
  },
  {
    subject: "Workshop",
    author: "ThisisEngineering",
    href: "https://unsplash.com/photos/AvGIBmvdcac",
  },
];
