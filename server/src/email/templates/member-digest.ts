import { PREFERENCE_FOOTER, compose, count, firstName, text, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/** One listed person as `member_digest()` stores them: a name and a title. */
function people(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const entry = item as Record<string, unknown>;
      const name = text(entry.name).trim();
      const title = text(entry.title).trim();
      if (!name) return "";
      return title ? `${name}, ${title}` : name;
    })
    .filter(Boolean);
}

/** "And 3 more.", for the people a list did not name. */
function more(value: unknown): string {
  const n = count(value);
  return n ? `And ${n} more.` : "";
}

/**
 * The opt-in weekly digest to a member (`member_digest()`, Task 35).
 * Payload contract: `firstName` (the recipient's), `professionals` (people
 * newly listed in the recipient's discipline) with `disciplineLabel` and
 * `professionalsMore`, `mentors` (people who started taking requests for
 * the recipient's topics) with `mentorsMore`, and `link`. Each person is
 * `{ id, name, title }`; the email uses the name and title only. A section
 * with nobody in it is left out of the payload and of the email.
 */
export function renderMemberDigest(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "");
  const pros = people(data.professionals);
  const mentors = people(data.mentors);
  const discipline = text(data.disciplineLabel).trim();

  const paragraphs: string[] = [name ? `Hello ${name}, here is what is new in MEST Network since your last digest.` : "Here is what is new in MEST Network since your last digest."];
  if (pros.length > 0) {
    paragraphs.push(discipline ? `New in ${discipline}:` : "New in your discipline:", ...pros, more(data.professionalsMore));
  }
  if (mentors.length > 0) {
    paragraphs.push("Now taking requests for topics you chose:", ...mentors, more(data.mentorsMore));
  }
  paragraphs.push("Open the directory to read their profiles or send a request. You get this digest at most once a week, and only when something is new.");

  return compose({
    subject: "Your weekly MEST Network digest",
    heading: "New in MEST Network this week",
    paragraphs,
    button: "Open the directory",
    link: data.link,
    fallbackPath: "/network/directory",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
