import { whatsappGroup } from "../content/site";

/**
 * A floating link to the community's WhatsApp group, in the bottom-right
 * corner of the landing page and the public network pages. It is a plain
 * link (opens in a new tab), not a chat widget: nothing loads from WhatsApp
 * until someone follows it. `wideOnly` keeps it off phones, where the
 * network pages' forms and bottom bars fill the corner (the network's menu
 * carries the link there instead).
 */
export function WhatsAppButton({ wideOnly = false }: { wideOnly?: boolean }) {
  if (!whatsappGroup) return null;
  return (
    <a
      className={wideOnly ? "wa-float wa-float-wide" : "wa-float"}
      href={whatsappGroup}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join the MEST WhatsApp group (opens in a new tab)"
      title="Join the MEST WhatsApp group"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.43 9.43 0 0 1-4.8-1.31l-.35-.2-3.57.93.95-3.48-.22-.36A9.4 9.4 0 0 1 2.6 12c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.21-4.24 9.45-9.45 9.45zm8.04-17.49A11.27 11.27 0 0 0 12.04.7C5.78.7.69 5.79.69 12.04c0 2 .52 3.95 1.52 5.67L.6 23.4l5.83-1.53a11.32 11.32 0 0 0 5.6 1.43h.01c6.26 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.31-8.02z"
        />
      </svg>
    </a>
  );
}
