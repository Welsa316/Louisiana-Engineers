/**
 * Shared building blocks for the MEST Network, lifted from the design
 * prototype. Each one is small, self-contained and router-agnostic: links go
 * through `UiLink`, which the app binds to React Router and the prototype to
 * its own hash router.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ComponentType,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, CheckCircle2, ChevronDown, Eye, Lock, Users, X } from "lucide-react";
import type { RequestStatus } from "@shared/types/common";

/* ---------- Links ---------- */

export interface UiLinkProps {
  to: string;
  className?: string;
  children: ReactNode;
}

export type UiLinkComponent = ComponentType<UiLinkProps>;

function PlainLink({ to, className, children }: UiLinkProps) {
  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}

const UiLinkContext = createContext<UiLinkComponent>(PlainLink);

/** Supplies the router's link component to every `UiLink` below it. */
export const UiLinkProvider = UiLinkContext.Provider;

/** An in-app link rendered with whatever router the host provides. */
export function UiLink(props: UiLinkProps) {
  const Component = useContext(UiLinkContext);
  return <Component {...props} />;
}

/* ---------- Eight-pointed star, the network's one ornament ---------- */

export function Star({ className }: { className?: string }) {
  // 16 points of an eight-pointed star in a 100×100 box.
  const pts: string[] = [];
  const outer = 50;
  const inner = outer * (Math.SQRT1_2 / Math.cos(Math.PI / 8));
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8 - Math.PI / 2;
    const r = k % 2 === 0 ? outer : inner;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <polygon points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="0.8" />
      <polygon
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
        transform="translate(50 50) scale(0.62) translate(-50 -50)"
      />
    </svg>
  );
}

/* ---------- Monogram ---------- */

export function Monogram({
  initials,
  size = "md",
  student = false,
  className,
}: {
  initials: string;
  size?: "sm" | "md" | "lg" | "xl";
  student?: boolean;
  className?: string;
}) {
  const classes = ["pn-mono", size !== "md" && `pn-mono-${size}`, student && "pn-mono-student", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} aria-hidden="true">
      <Star />
      <span>{initials}</span>
    </span>
  );
}

/* ---------- Status ---------- */

export const statusLabel: Record<RequestStatus | "active" | "paused" | "off" | "approved" | "verified" | "open" | "resolved" | "dismissed" | "upcoming", string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
  canceled: "Withdrawn",
  expired: "Expired",
  active: "Mentoring",
  paused: "Paused",
  off: "Not mentoring",
  approved: "Listed",
  verified: "Verified",
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
  upcoming: "Upcoming",
};

export function Status({
  tone,
  label,
  pill = false,
  className,
}: {
  tone: keyof typeof statusLabel;
  label?: string;
  pill?: boolean;
  className?: string;
}) {
  return (
    <span className={["pn-status", pill && "pn-status-pill", className].filter(Boolean).join(" ")} data-tone={tone}>
      {label ?? statusLabel[tone]}
    </span>
  );
}

/* ---------- Kicker / page head ---------- */

export function Kicker({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  return <span className={plain ? "pn-kicker pn-kicker-plain" : "pn-kicker"}>{children}</span>;
}

export function PageHead({
  kicker,
  title,
  lead,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="pn-page-head">
      <div>
        {kicker && (
          <div>
            <Kicker>{kicker}</Kicker>
          </div>
        )}
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="pn-page-actions">{actions}</div>}
    </header>
  );
}

/* ---------- Card ---------- */

export function Card({
  title,
  aside,
  children,
  className,
  flush = false,
  lift = false,
  accent = false,
  as: Tag = "section",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  lift?: boolean;
  accent?: boolean;
  as?: "section" | "div" | "article";
}) {
  const classes = ["pn-card", flush && "pn-card-flush", lift && "pn-card-lift", accent && "pn-card-accent", className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes}>
      {(title || aside) && (
        <div className="pn-card-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </Tag>
  );
}

/* ---------- Stat ---------- */

export function Stat({ value, unit, label, note }: { value: ReactNode; unit?: string; label: string; note?: string }) {
  return (
    <div className="pn-stat">
      <span className="pn-stat-label">{label}</span>
      <span className="pn-stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="pn-stat-note">{note}</span>}
    </div>
  );
}

/* ---------- Chips / toggles ---------- */

export function Chip({
  pressed,
  children,
  removable = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean; removable?: boolean }) {
  return (
    <button type="button" className="pn-chip" aria-pressed={pressed} {...rest}>
      {children}
      {removable && (
        <span className="pn-chip-remove" aria-hidden="true">
          <X size={12} />
        </span>
      )}
    </button>
  );
}

export function CheckRow({
  pressed,
  children,
  count,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean; count?: number }) {
  return (
    <button type="button" className="pn-check" aria-pressed={pressed} {...rest}>
      <span className="pn-check-box" aria-hidden="true">
        {pressed && <Check size={11} strokeWidth={3} />}
      </span>
      <span>{children}</span>
      {typeof count === "number" && <span className="pn-check-count">{count}</span>}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="pn-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="pn-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function SwitchRow({
  title,
  note,
  checked,
  onChange,
}: {
  title: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="pn-switch-row">
      <div>
        <div className="pn-switch-row-title" id={id}>
          {title}
        </div>
        {note && <div className="pn-switch-row-note">{note}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="pn-switch"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/**
 * Option card over a native radio or checkbox, so keyboard behaviour and
 * screen-reader semantics come from the browser. Radios in one set share
 * a `name`.
 */
export function Option({
  checked,
  title,
  note,
  multi = false,
  name,
  onClick,
}: {
  checked: boolean;
  title: ReactNode;
  note?: ReactNode;
  multi?: boolean;
  name?: string;
  onClick: () => void;
}) {
  const fallback = useId();
  return (
    <label className="pn-option" data-checked={checked}>
      <input
        type={multi ? "checkbox" : "radio"}
        name={multi ? undefined : name ?? fallback}
        className="sr-only"
        checked={checked}
        onChange={onClick}
      />
      <span className={multi ? "pn-option-mark pn-option-mark-square" : "pn-option-mark"} aria-hidden="true" />
      <span>
        <span className="pn-option-title">{title}</span>
        {note && <span className="pn-option-note block">{note}</span>}
      </span>
    </label>
  );
}

/* ---------- Fields ---------- */

type Privacy = "public" | "members" | "private";

export function PrivacyMark({ level }: { level: Privacy }) {
  const Icon = level === "public" ? Eye : level === "members" ? Users : Lock;
  const text = level === "public" ? "Public" : level === "members" ? "Members only" : "Private";
  return (
    <span className="pn-privacy" data-level={level}>
      <Icon size={12} aria-hidden="true" />
      {text}
    </span>
  );
}

export function Field({
  label,
  hint,
  privacy,
  optional = false,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  privacy?: Privacy;
  optional?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label className="field-label pn-field-label t-small" htmlFor={id}>
        <span>
          {label}
          {optional && <span className="text-fg-2"> (optional)</span>}
        </span>
        {privacy && <PrivacyMark level={privacy} />}
      </label>
      {children(id)}
      {hint && <p className="pn-field-hint">{hint}</p>}
    </div>
  );
}

/** React 19 passes `ref` as a prop, so callers can focus the field. */
export function Input(props: ComponentProps<"input">) {
  return <input className="field-input" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="field-input pn-textarea" {...props} />;
}

export function Select({
  children,
  ...props
}: InputHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className="select-wrap">
      <select {...props}>{children}</select>
      <ChevronDown size={16} aria-hidden="true" />
    </div>
  );
}

/* ---------- Tabs ---------- */

/**
 * Filter tabs: a group of toggle buttons rather than an ARIA tablist, since
 * the content below is one list filtered by the choice, not separate panels.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div className="pn-tabs" role="group" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className="pn-tab"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="pn-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Steps ---------- */

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <>
      <ol className="pn-steps" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className="contents">
            <span className="pn-step" aria-current={i === current ? "step" : undefined} data-done={i < current}>
              <span className="pn-step-num" aria-hidden="true">
                {i < current ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {s}
            </span>
            {i < steps.length - 1 && <span className="pn-step-rule" data-done={i < current} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <div className="pn-steps-compact" aria-hidden="true">
        <div>
          <strong>{steps[current]}</strong>
          <span>
            Step {current + 1} of {steps.length}
          </span>
        </div>
        <div className="pn-progress">
          <span style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
    </>
  );
}

/* ---------- Dialogs ---------- */

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => onClose();
    const handleClick = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener("close", handleClose);
    el.addEventListener("click", handleClick);
    return () => {
      el.removeEventListener("close", handleClose);
      el.removeEventListener("click", handleClick);
    };
  }, [onClose]);
  return ref;
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog ref={ref} className="pn-drawer" aria-labelledby={titleId}>
      <div className="pn-drawer-inner">
        <div className="pn-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="pn-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="pn-drawer-body">{open && children}</div>
        {footer && <div className="pn-drawer-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog ref={ref} className="pn-modal" aria-labelledby={titleId}>
      <div className="pn-modal-inner">
        <h2 id={titleId}>{title}</h2>
        {open && children}
        {footer && <div className="pn-modal-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog ref={ref} className="pn-sheet" aria-labelledby={titleId}>
      <div className="pn-sheet-inner">
        <div className="pn-sheet-handle" aria-hidden="true" />
        <div className="pn-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="pn-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="pn-drawer-body">{open && children}</div>
        {footer && <div className="pn-drawer-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

/* ---------- Empty state, notice, toast ---------- */

export function Empty({
  title,
  children,
  action,
  inline = false,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "pn-empty pn-empty-inline" : "pn-empty"}>
      <Star className="w-10 h-10" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({
  tone,
  icon,
  children,
}: {
  tone?: "warn" | "ok" | "info";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pn-notice" data-tone={tone}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="pn-toast" role="status" aria-live="polite">
      <CheckCircle2 size={18} aria-hidden="true" />
      {text}
    </div>
  );
}

/* ---------- Formatting ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDate(iso: string, withYear = false) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ""}`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${hour}:${m} ${ampm}`;
}

export function fmtDayMonth(iso: string) {
  const d = new Date(iso);
  return { day: String(d.getDate()).padStart(2, "0"), month: MONTHS[d.getMonth()] };
}

/** "today", "yesterday", "3 days ago", or a date. Relative to the prototype's fixed today. */
export function fmtRelative(iso: string, todayIso: string) {
  const a = new Date(iso);
  const b = new Date(todayIso);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 14) return `${diff} days ago`;
  return fmtDate(iso);
}

/** fmtRelative for mid-sentence use: "today", "3 days ago", but "Oct 7" keeps its capital. */
export function fmtRelativeLower(iso: string, todayIso: string) {
  const r = fmtRelative(iso, todayIso);
  return /ago$|^Today$|^Yesterday$/.test(r) ? r.toLowerCase() : r;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
