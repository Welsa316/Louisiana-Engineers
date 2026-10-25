import { useState } from "react";
import { ArrowUpRight, GraduationCap, Briefcase, Mail, ShieldCheck } from "lucide-react";
import { Link, useRouter } from "../../router";
import { useStore } from "../../state/store";
import { Field, Input, Notice, Star } from "../../components/ui";

/** 4. Login / signup. Passwordless by design: magic link, or Google. */
export function SignIn() {
  const { dispatch } = useStore();
  const { navigate } = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="pn-auth">
      <aside className="pn-auth-side">
        <Star className="pn-hero-star" />
        <span className="pn-kicker">MEST network</span>
        <h2 className="mt-6">No passwords to remember.</h2>
        <p className="t-lead text-fg-2 mt-6 max-w-[40ch]">
          Enter your email and we send you a link that signs you in. Or use a Google account. Either way, MEST never
          stores a password for you.
        </p>
        <ul className="mt-10 grid gap-4 t-small text-fg-2 max-w-[40ch]">
          <li className="flex gap-3">
            <ShieldCheck size={16} aria-hidden="true" className="text-accent mt-0.5 shrink-0" />
            Your email address is never shown on your profile.
          </li>
          <li className="flex gap-3">
            <ShieldCheck size={16} aria-hidden="true" className="text-accent mt-0.5 shrink-0" />
            You can delete your account yourself, at any time.
          </li>
        </ul>
      </aside>
      <div className="pn-auth-form">
        <h1>Sign in</h1>
        <p className="t-small text-fg-2 mt-2">
          New here?{" "}
          <Link to="/join" className="link link-quiet">
            Join the network
          </Link>
        </p>
        <div className="pn-oauth">
          <button type="button" className="btn btn-outline btn-block" onClick={() => { dispatch({ type: "setRole", role: "mentee" }); navigate("/me"); }}>
            Continue with Google
          </button>
        </div>
        <div className="pn-or">or</div>
        {sent ? (
          <Notice tone="ok" icon={<Mail size={18} aria-hidden="true" />}>
            <strong>Check your inbox.</strong> We sent a sign-in link to {email}. It works once and expires in 15 minutes.
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" className="btn btn-solid btn-sm" onClick={() => { dispatch({ type: "setRole", role: "mentee" }); navigate("/me"); }}>
                Pretend to click the link (student)
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { dispatch({ type: "setRole", role: "mentor" }); navigate("/mentor"); }}>
                (mentor)
              </button>
            </div>
          </Notice>
        ) : (
          <form
            className="pn-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.includes("@")) setSent(true);
            }}
          >
            <Field label="Email">
              {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}
            </Field>
            <button type="submit" className="btn btn-solid">
              Email me a sign-in link
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Choosing a path before onboarding. */
export function Join() {
  return (
    <div className="shell section">
      <div className="max-w-2xl">
        <span className="pn-kicker">Join the network</span>
        <h1 className="t-display-md mt-4">Which describes you today?</h1>
        <p className="t-lead text-fg-2 mt-6">You can change this later. Professionals can also ask for guidance, and students become professionals.</p>
      </div>
      <div className="pn-grid pn-grid-2 mt-12 max-w-4xl">
        <Link to="/join/student" className="pn-card pn-card-lift grid gap-4 hover:border-[var(--color-accent)] transition-colors">
          <GraduationCap size={28} aria-hidden="true" className="text-accent" />
          <h2 className="t-heading">I am a student or early in my career</h2>
          <p className="t-small text-fg-2">Create a short profile, tell us what you are working toward, and start finding mentors. About three minutes.</p>
          <span className="link mt-2">
            Student account
            <ArrowUpRight size={15} aria-hidden="true" />
          </span>
        </Link>
        <Link to="/join/professional" className="pn-card pn-card-lift grid gap-4 hover:border-[var(--color-accent)] transition-colors">
          <Briefcase size={28} aria-hidden="true" className="text-accent" />
          <h2 className="t-heading">I am a working professional</h2>
          <p className="t-small text-fg-2">List your discipline and expertise, choose how visible and reachable you want to be, and optionally offer mentorship. About eight minutes; reviewed before listing.</p>
          <span className="link mt-2">
            Professional profile
            <ArrowUpRight size={15} aria-hidden="true" />
          </span>
        </Link>
      </div>
    </div>
  );
}
