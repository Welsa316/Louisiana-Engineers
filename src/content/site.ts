/**
 * Replaceable site content.
 *
 * Copy follows MEST_Website_Sitemap_and_Content_Plan (v1.0), which marks
 * it as a draft for review. The Greater New Orleans descriptions were
 * added in Phase 1 and also need the organizers' approval. Everything an organizer will need to update
 * before launch lives here: mission copy, events, board profiles, contact
 * channels and social links. Empty values render as honest "to be
 * announced" states instead of invented content.
 */

export const org = {
  name: "Muslim Engineers in Science & Tech",
  short: "MEST",
  region: "Greater New Orleans, Louisiana",
  headline: ["Built on knowledge.", "Connected by purpose."],
  intro:
    "A community for Muslim engineers, scientists, technologists, and students to connect, grow, and make an impact.",
};

export const mission = {
  statement:
    "MEST brings together Muslim students and professionals in engineering, science, and technology to foster meaningful connections, mentorship, professional growth, and service. We aim to build a welcoming community where members can share knowledge, support one another, and contribute their skills for the greater good.",
  about: "A network for people at every stage.",
  /** Lead paragraph under the Mission & About headline. */
  overview:
    "MEST is a professional and community organization based in Greater New Orleans, bringing together Muslims who study and work in engineering, science, and technology.",
  /** The regional context, in the site's own voice. */
  region:
    "The region is home to universities and medical centers, a working port and the industries along the river, energy and coastal engineering, and a growing technology sector. MEST gives the people working and studying across these fields a place to meet, learn from one another, and support the next generation, as professionals and as a community.",
  audience: [
    "Aspiring STEM students",
    "Early-career professionals",
    "Experienced engineers",
    "Researchers",
    "Mentors",
  ],
};

/** Suggested navigation from the content plan. */
export const navigation = [
  { label: "Mission", href: "#mission" },
  { label: "Events", href: "#events" },
  { label: "Board", href: "#board" },
  { label: "Get Involved", href: "#get-involved" },
] as const;

export const pillars = [
  {
    index: "01",
    title: "Connect",
    summary:
      "Build meaningful relationships among engineers, scientists, and technologists across disciplines.",
    detail:
      "Civil and chemical engineering, biology and public health, software and data, and everything in between. The common ground is the work, and the people who do it well.",
  },
  {
    index: "02",
    title: "Mentor",
    summary:
      "Support students and early-career professionals through guidance, knowledge sharing, and opportunity.",
    detail:
      "The first internship, the licensure exam or graduate application, the first job offer. Every one of these is easier with someone who has already been through it.",
  },
  {
    index: "03",
    title: "Advance",
    summary:
      "Encourage innovation, professional excellence, and contributions to New Orleans and the wider community.",
    detail:
      "Technical rigor as a form of service. Work that holds up, and a community that holds people to it.",
  },
] as const;

export type EventItem = {
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Display time, for example "6:30 PM". */
  time: string;
  /** Venue and city, or "Online". */
  location: string;
  /** Speaker talk, networking meetup, student career session, workshop. */
  format: string;
  /** One or two sentences. */
  description: string;
  /** Registration page. Leave empty if registration is not open yet. */
  registrationUrl: string;
};

/**
 * Confirmed events only. While this list is empty the section shows the
 * plan's empty state. Example entry:
 *
 *   {
 *     title: "Networking evening",
 *     date: "2027-02-12",
 *     time: "6:30 PM",
 *     location: "Baton Rouge",
 *     format: "Networking meetup",
 *     description: "One or two sentences about the event.",
 *     registrationUrl: "https://...",
 *   },
 */
export const events: EventItem[] = [];

export const eventFormats = [
  "Speaker talks",
  "Networking meetups",
  "Student career sessions",
  "Workshops",
];

export type BoardMember = {
  name: string;
  /** Official board title. */
  role: string;
  /** One or two sentences. */
  bio: string;
  /** Optional profession or area of expertise. */
  expertise?: string;
  /** Optional LinkedIn profile URL. */
  linkedin?: string;
};

/**
 * Board profiles, published once each member confirms their details.
 * While empty, the section shows `boardPlaceholderCount` placeholder
 * profiles so the layout can be reviewed.
 */
export const board: BoardMember[] = [];
export const boardPlaceholderCount = 4;

export const membershipRoles = [
  "Student",
  "Engineer",
  "Scientist or researcher",
  "Technology professional",
  "Educator or mentor",
] as const;

/**
 * Feature switches. The membership form is built and tested but hidden
 * until enrollment opens; set membershipForm to true to show it.
 */
export const features = {
  membershipForm: false,
};

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
  city: "Greater New Orleans, Louisiana",
};

export const socials: { label: string; href: string }[] = [
  { label: "LinkedIn", href: "" },
  { label: "Instagram", href: "" },
];

export const photoCredits = [
  {
    subject: "Cable-stayed bridge at night",
    author: "Koushik Beeram",
    href: "https://unsplash.com/photos/rgj0XAcG0T0",
  },
  {
    subject: "Steel lattice",
    author: "Nick Fewings",
    href: "https://unsplash.com/photos/yIbnj4mTBPE",
  },
];
