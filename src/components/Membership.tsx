import { useId, useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { contact, features, membershipEndpoint, membershipRoles } from "../content/site";

type Status =
  | { tone: "idle" }
  | { tone: "busy" }
  | { tone: "ok"; message: string }
  | { tone: "info"; message: string }
  | { tone: "error"; message: string };

type Errors = Partial<Record<"name" | "email" | "role", string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Membership() {
  const id = useId();
  const [status, setStatus] = useState<Status>({ tone: "idle" });
  const [errors, setErrors] = useState<Errors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const role = String(data.get("role") ?? "");

    const next: Errors = {};
    if (!name) next.name = "Please enter your name.";
    if (!emailPattern.test(email)) next.email = "Please enter a valid email address.";
    if (!role) next.role = "Please choose the option that fits you best.";
    setErrors(next);
    if (Object.keys(next).length) {
      const first = Object.keys(next)[0] as keyof Errors;
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    if (!membershipEndpoint) {
      setStatus({
        tone: "info",
        message:
          "Enrollment opens soon. This form is not yet connected to a membership service, so nothing was sent.",
      });
      return;
    }

    setStatus({ tone: "busy" });
    try {
      const response = await fetch(membershipEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      form.reset();
      setStatus({
        tone: "ok",
        message: `Thank you, ${name.split(" ")[0]}. We will be in touch at ${email}.`,
      });
    } catch {
      setStatus({
        tone: "error",
        message: "Something went wrong sending your details. Please try again in a moment.",
      });
    }
  }

  const describe = (field: keyof Errors) =>
    errors[field] ? `${id}-${field}-error` : undefined;

  return (
    <section
      className="membership section"
      id="get-involved"
      aria-labelledby="get-involved-title"
    >
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">03</span>
          <h2 className="t-label" id="get-involved-title">
            Get involved
          </h2>
        </div>

        <div className="mt-14 md:mt-24">
          <p className="t-display-lg" data-split style={{ maxWidth: "12.6em" }}>
            Your next connection could shape what comes next.
          </p>
        </div>

        <div className="grid-12 mt-12 md:mt-20 gap-y-12">
          <div className="col-span-12 lg:col-span-5">
            <p className="t-lead measure" data-reveal>
              Whether you are studying, entering the profession, or established
              in your field, there is a place for you in MEST.
            </p>
            <p className="t-small measure mt-6 text-fg-2" data-reveal>
              Connect with the community and stay informed about future events
              and opportunities. MEST is based in New Orleans, and students and
              professionals from elsewhere in Louisiana and beyond are welcome.
            </p>
          </div>

          {features.membershipForm ? (
          <form
            className="col-span-12 lg:col-start-7 lg:col-span-6"
            onSubmit={submit}
            noValidate
            data-reveal
          >
            <label className="field" htmlFor={`${id}-name`}>
              <span className="t-label field-label">Full name</span>
              <input
                id={`${id}-name`}
                className="field-input"
                name="name"
                autoComplete="name"
                required
                aria-required="true"
                aria-invalid={errors.name ? "true" : undefined}
                aria-describedby={describe("name")}
                placeholder="Your name"
              />
              {errors.name && (
                <span id={`${id}-name-error`} className="t-small field-error block">
                  {errors.name}
                </span>
              )}
            </label>

            <label className="field" htmlFor={`${id}-email`}>
              <span className="t-label field-label">Email</span>
              <input
                id={`${id}-email`}
                className="field-input"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                aria-required="true"
                aria-invalid={errors.email ? "true" : undefined}
                aria-describedby={describe("email")}
                placeholder="you@example.com"
              />
              {errors.email && (
                <span id={`${id}-email-error`} className="t-small field-error block">
                  {errors.email}
                </span>
              )}
            </label>

            <label className="field" htmlFor={`${id}-role`}>
              <span className="t-label field-label">I am a</span>
              <span className="select-wrap block">
                <select
                  id={`${id}-role`}
                  className="field-input"
                  name="role"
                  defaultValue=""
                  required
                  aria-required="true"
                  aria-invalid={errors.role ? "true" : undefined}
                  aria-describedby={describe("role")}
                >
                  <option value="" disabled>
                    Choose one
                  </option>
                  {membershipRoles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} aria-hidden="true" />
              </span>
              {errors.role && (
                <span id={`${id}-role-error`} className="t-small field-error block">
                  {errors.role}
                </span>
              )}
            </label>

            <div className="mt-10 flex flex-wrap items-center gap-6">
              <button
                className="btn btn-light"
                type="submit"
                disabled={status.tone === "busy"}
                aria-busy={status.tone === "busy"}
              >
                {status.tone === "busy" ? "Sending" : "Join MEST"}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
              <p className="t-small text-fg-2">
                We only use your email to talk to you about membership.
              </p>
            </div>

            <p
              className="t-small form-status"
              role="status"
              aria-live="polite"
              data-tone={status.tone === "ok" ? "ok" : undefined}
            >
              {"message" in status ? status.message : ""}
            </p>
          </form>
          ) : (
            <div className="col-span-12 lg:col-start-7 lg:col-span-6 lg:self-end contact-block" data-reveal>
              <h3 className="t-label text-accent">Contact us</h3>
              {contact.email ? (
                <a className="t-heading link mt-4" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              ) : (
                <p className="t-heading mt-4 text-fg-2">Email to be announced</p>
              )}
              <p className="t-small membership-status mt-8">
                Membership enrollment opens soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
