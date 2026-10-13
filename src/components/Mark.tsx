import { octagonPoints, starPoints } from "../lib/geometry";

/** Brand mark: an eight-pointed star with an inscribed octagon. */
export function Mark({
  className = "",
  draw = false,
}: {
  className?: string;
  draw?: boolean;
}) {
  return (
    <svg
      className={`${className} ${draw ? "mark-draw" : ""}`.trim()}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points={starPoints(50, 50, 46)} pathLength={1} />
      <polygon points={octagonPoints(50, 50, 23)} pathLength={1} />
      <circle cx="50" cy="50" r="5" pathLength={1} />
    </svg>
  );
}

/**
 * Star-and-cross tiling. Stars sit at tile centres with tips touching the
 * tile edges, so the gaps between four stars form crosses automatically.
 */
export function StarPattern({ id = "star-tile" }: { id?: string }) {
  const size = 132;
  const half = size / 2;
  return (
    <svg aria-hidden="true" focusable="false">
      <defs>
        <pattern
          id={id}
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <polygon
            points={starPoints(half, half, half)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <polygon
            points={octagonPoints(half, half, half * 0.36)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function Wordmark({
  describe = true,
  className = "",
}: {
  describe?: boolean;
  className?: string;
}) {
  return (
    <a
      className={`wordmark ${className}`.trim()}
      href="#top"
      aria-label="MEST, Muslim Engineers in Science and Tech. Back to top"
    >
      <Mark className="wordmark-mark" />
      <span className="wordmark-text" aria-hidden="true">
        MEST
      </span>
      {describe && (
        <span className="wordmark-desc" aria-hidden="true">
          Muslim Engineers in
          <br />
          Science &amp; Tech
        </span>
      )}
    </a>
  );
}
