import { ArrowUpRight } from "lucide-react";
import { LogoMark } from "./Logo";
import { board, boardPlaceholderCount, type BoardMember } from "../content/site";

function Profile({ member }: { member: BoardMember | null }) {
  const name = member?.name || "Board member";
  return (
    <li className="member" data-reveal>
      <figure className="portrait">
        {member?.photo ? (
          <img
            src={member.photo}
            alt={`Portrait of ${member.name}`}
            loading="lazy"
            decoding="async"
            width={800}
            height={1000}
          />
        ) : (
          <div className="portrait-empty" aria-hidden="true">
            <LogoMark />
          </div>
        )}
      </figure>
      <div className="member-text">
        <p className="t-label text-accent">{member?.role || "Role to be confirmed"}</p>
        <h3 className="t-heading mt-2">{name}</h3>
        {member?.expertise && <p className="t-small text-fg-2 mt-1">{member.expertise}</p>}
        <p className="t-small text-fg-2 mt-3">{member?.bio || "Profile coming soon."}</p>
        {member?.linkedin && (
          <a
            className="link mt-4"
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

/** 03 Meet the Board: names, roles, portraits and short introductions. */
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

        <ul className="board-grid mt-14 md:mt-20" data-stagger>
          {people.map((m, i) => (
            <Profile key={m?.name ? m.name : `placeholder-${i}`} member={m} />
          ))}
        </ul>
      </div>
    </section>
  );
}
