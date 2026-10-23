import { ArrowUpRight } from "lucide-react";
import { board, boardPlaceholderCount, type BoardMember } from "../content/site";

/**
 * One row of the board directory: number, role and name, then a short
 * introduction. Board members are not photographed; the directory is set
 * in type, with the same numeral-and-rule device as the section headers.
 */
function Profile({ member, index }: { member: BoardMember | null; index: number }) {
  const name = member?.name || "Board member";
  return (
    <li className="member" data-reveal>
      <span className="member-index" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="member-id">
        <p className="t-label text-accent">{member?.role || "Role to be confirmed"}</p>
        <h3 className="t-display-sm member-name">{name}</h3>
      </div>
      <div className="member-about">
        {member?.expertise && <p className="t-small">{member.expertise}</p>}
        <p className="t-body text-fg-2">{member?.bio || "Profile coming soon."}</p>
        {member?.linkedin && (
          <a
            className="link"
            href={member.linkedin}
            target="_blank"
            rel="noreferrer"
            aria-label={`${member.name} on LinkedIn`}
          >
            LinkedIn
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        )}
      </div>
    </li>
  );
}

/** 03 Meet the Board: names, roles and short introductions. */
export function Board() {
  const placeholders = board.length === 0;
  const people: (BoardMember | null)[] = placeholders
    ? Array.from({ length: boardPlaceholderCount }, () => null)
    : board;

  return (
    <section className="section" id="board" aria-labelledby="board-title">
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">03</span>
          <h2 className="t-label" id="board-title">
            Meet the board
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-20 gap-y-8">
          <p className="t-display-md col-span-12 md:col-span-9" data-split>
            Meet the people helping guide MEST, organize opportunities, and
            strengthen the community.
          </p>
          {placeholders && (
            <p className="t-small text-fg-2 col-span-12 md:col-span-6" data-reveal>
              Profiles appear here once each board member confirms their
              details.
            </p>
          )}
        </div>

        <ul className="board-list mt-14 md:mt-20" data-stagger>
          {people.map((m, i) => (
            <Profile key={m?.name ? m.name : `placeholder-${i}`} member={m} index={i} />
          ))}
        </ul>
      </div>
    </section>
  );
}
