/**
 * Settings, Privacy and contact (03 section 2.1 visibility and contact,
 * ported from the prototype's privacy screen). Directory visibility and the
 * hybrid contact rule (A1): a profile can be public, but contact details are
 * never public; signed-in members see only the methods ticked under "Show to
 * signed-in members", and phone stays off unless turned on.
 *
 * Students are never listed and have no contact preferences, so they get the
 * explanation only. One `PATCH /api/me/settings` saves the screen; a refusal
 * leaves everything as it was.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { settingsPatchSchema, type SettingsPatchInput } from "@shared/schemas/settings";
import { contactMethods, type ContactMethodId } from "@shared/taxonomy";
import type { Visibility } from "@shared/types/common";
import type { OwnProfile, OwnSettings } from "@shared/types/me";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { ErrorSummary, SaveRow, SettingsField, fieldId, issuesToErrors, useFieldErrors } from "../../ui/settings-controls";
import { Card, Input, Notice, Option, PageHead, Toast, UiLink } from "../../ui/ui";
import { settingsErrorText, useOwnProfile, useOwnSettings, useSaveSettings } from "./api";

const FORM = "privacy";

type Sharable = Exclude<ContactMethodId, "mest">;

interface Draft {
  visibility: Visibility;
  methods: ContactMethodId[];
  share: Sharable[];
  contactEmail: string;
  phone: string;
  bookingUrl: string;
}

const ORDER = contactMethods.map((m) => m.id);
const inOrder = <T extends ContactMethodId>(list: T[]) => ORDER.filter((id) => list.includes(id as T)) as T[];

function toDraft(settings: OwnSettings): Draft {
  const c = settings.contact;
  return {
    visibility: settings.visibility,
    methods: inOrder(c?.methods ?? ["mest"]),
    share: inOrder(c?.shareWithMembers ?? []),
    contactEmail: c?.contactEmail ?? "",
    phone: c?.phone ?? "",
    bookingUrl: c?.bookingUrl ?? "",
  };
}

const LABELS: Record<string, string> = {
  visibility: "Directory visibility",
  "contact.methods": "Methods I use",
  "contact.shareWithMembers": "Show to signed-in members",
  "contact.contactEmail": "Email to share",
  "contact.phone": "Phone number",
  "contact.bookingUrl": "Scheduling link",
};
const KNOWN = Object.keys(LABELS);

const VISIBILITY: { id: Visibility; title: string; note: string }[] = [
  {
    id: "public",
    title: "Public",
    note: "Anyone can read your profile, including visitors who are not signed in, and search engines may list it. Your contact details are still never public.",
  },
  {
    id: "members",
    title: "Members only",
    note: "Only signed-in MEST members can find and read your profile. Visitors see that a members-only profile exists.",
  },
  {
    id: "hidden",
    title: "Hidden",
    note: "Your profile is not listed and others cannot open it. Use this instead of deleting your account when you need a break.",
  },
];

export function PrivacySettings() {
  useMeta({ title: "Privacy and contact" });
  const profile = useOwnProfile();
  const settings = useOwnSettings();
  const error = profile.error ?? settings.error;

  return (
    <>
      <PageHead
        kicker="Privacy and contact"
        title="Who sees you and how they reach you."
        lead="Being listed, being contactable and mentoring are separate choices. Changing one never changes the others."
      />
      {error ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{settingsErrorText(error)}</Notice>
        </div>
      ) : !profile.data || !settings.data ? (
        <p className="mt-8 t-small text-fg-2">Loading your settings</p>
      ) : profile.data.kind === "professional" && settings.data.contact ? (
        <PrivacyForm profile={profile.data} settings={settings.data} />
      ) : (
        <StudentPrivacy />
      )}
    </>
  );
}

function StudentPrivacy() {
  return (
    <div className="pn-split mt-8">
      <Card title="Your privacy as a student" lift>
        <ul className="grid gap-3 t-small text-fg-2">
          <li className="flex gap-3">
            <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
            Students are never listed in the directory.
          </li>
          <li className="flex gap-3">
            <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
            A mentor sees your profile only when you send them a request.
          </li>
          <li className="flex gap-3">
            <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
            Your sign-in email is never shown to mentors, and nobody sees which other mentors you asked.
          </li>
        </ul>
      </Card>
      <Card title="Changing what mentors see">
        <p className="t-small text-fg-2">
          Your program, goals and topics are under{" "}
          <UiLink to="/settings/profile" className="link">
            Profile
          </UiLink>
          . If you now work in the field, you can switch to a professional profile there.
        </p>
      </Card>
    </div>
  );
}

function PrivacyForm({ profile, settings }: { profile: OwnProfile; settings: OwnSettings }) {
  const stored = JSON.stringify(toDraft(settings));
  const [saved, setSaved] = useState(() => toDraft(settings));
  const [draft, setDraft] = useState(saved);
  const { errors, setErrors, clear } = useFieldErrors();
  const [general, setGeneral] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const save = useSaveSettings();
  const hasLinkedin = Boolean(profile.linkedinUrl);

  // Start again from what the server answers after a save.
  useEffect(() => {
    const next = JSON.parse(stored) as Draft;
    setSaved(next);
    setDraft(next);
  }, [stored]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const touch = (keys: string[]) => {
    keys.forEach(clear);
    setFlash(null);
    setGeneral(null);
  };

  const toggleUse = (id: ContactMethodId) => {
    if (id === "mest") return;
    setDraft((d) => {
      const using = d.methods.includes(id);
      return {
        ...d,
        methods: inOrder(using ? d.methods.filter((m) => m !== id) : [...d.methods, id]),
        // A method that is turned off is no longer shown to anyone.
        share: using ? d.share.filter((m) => m !== id) : d.share,
      };
    });
    touch(["contact.methods", "contact.shareWithMembers", "contact.phone", "contact.bookingUrl"]);
  };
  const toggleShare = (id: Sharable) => {
    setDraft((d) => ({ ...d, share: inOrder(d.share.includes(id) ? d.share.filter((m) => m !== id) : [...d.share, id]) }));
    touch(["contact.shareWithMembers"]);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFlash(null);
    setGeneral(null);
    const patch: SettingsPatchInput = {};
    if (draft.visibility !== saved.visibility) patch.visibility = draft.visibility;
    const contactChanged =
      JSON.stringify([saved.methods, saved.share, saved.contactEmail.trim(), saved.phone.trim(), saved.bookingUrl.trim()]) !==
      JSON.stringify([draft.methods, draft.share, draft.contactEmail.trim(), draft.phone.trim(), draft.bookingUrl.trim()]);
    if (contactChanged) {
      // The whole section, so the schema checks every chosen method has its value.
      patch.contact = {
        methods: draft.methods,
        shareWithMembers: draft.share,
        contactEmail: draft.contactEmail,
        phone: draft.phone,
        bookingUrl: draft.bookingUrl,
      };
    }
    if (Object.keys(patch).length === 0) {
      setErrors({});
      setGeneral("Nothing has changed.");
      return;
    }
    const parsed = settingsPatchSchema.safeParse(patch);
    const next = parsed.success ? {} : issuesToErrors(parsed.error.issues, KNOWN);
    if (draft.methods.includes("linkedin") && !hasLinkedin && !next["contact.methods"]) {
      next["contact.methods"] = "Add your LinkedIn link under Profile before turning LinkedIn on";
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(patch, {
      onSuccess: () => setFlash("Privacy and contact saved."),
      onError: (error) => {
        if (isApiError(error, "validation") && error.issues.length > 0) setErrors(issuesToErrors(error.issues, KNOWN));
        else setGeneral(settingsErrorText(error));
      },
    });
  };

  const undo = () => {
    setDraft(saved);
    setErrors({});
    setGeneral(null);
  };

  const methodsError = errors["contact.methods"];
  const shareError = errors["contact.shareWithMembers"];

  return (
    <>
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      <form className="pn-split mt-8" noValidate onSubmit={submit}>
        <div className="grid grid-cols-1 gap-6 min-w-0">
          <ErrorSummary form={FORM} errors={errors} labels={LABELS} general={general} />

          <Card title="Directory visibility">
            <div className="pn-options" role="radiogroup" aria-label="Directory visibility" id={fieldId(FORM, "visibility")}>
              {VISIBILITY.map((v) => (
                <Option
                  key={v.id}
                  name="visibility"
                  checked={draft.visibility === v.id}
                  title={v.title}
                  note={v.note}
                  onClick={() => {
                    setDraft((d) => ({ ...d, visibility: v.id }));
                    touch(["visibility"]);
                  }}
                />
              ))}
            </div>
            {profile.approvalState !== "approved" ? (
              <p className="pn-field-hint">This applies once an administrator approves your profile.</p>
            ) : null}
          </Card>

          <Card title="How people reach you">
            <p className="t-small text-fg-2">
              Turn on the ways you are happy to be reached, then choose which of them signed-in members may see. Mentees you
              accept can be given more when you accept them.
            </p>
            <table className="pn-settings-matrix mt-6" aria-describedby={methodsError || shareError ? fieldId(FORM, "contact.methods") + "-error" : undefined}>
              <caption className="sr-only">Contact methods: which you use, and which signed-in members see</caption>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col" id={fieldId(FORM, "contact.methods")} tabIndex={-1}>
                    I use it
                  </th>
                  <th scope="col" id={fieldId(FORM, "contact.shareWithMembers")} tabIndex={-1}>
                    Members see it
                  </th>
                </tr>
              </thead>
              <tbody>
                {contactMethods.map((m) => {
                  const lockedOn = m.id === "mest";
                  const noLink = m.id === "linkedin" && !hasLinkedin && !draft.methods.includes("linkedin");
                  const used = draft.methods.includes(m.id);
                  return (
                    <tr key={m.id}>
                      <th scope="row">
                        <span className="pn-settings-method">
                          <span className="pn-settings-check-label">{m.label}</span>
                          <span className="pn-settings-check-note">
                            {lockedOn ? "Always on. " : ""}
                            {m.note}
                            {noLink ? " Add your LinkedIn link under Profile to turn this on." : ""}
                          </span>
                        </span>
                      </th>
                      <td>
                        <label className="pn-settings-cell">
                          <input
                            type="checkbox"
                            aria-label={`Use ${m.label}`}
                            checked={used}
                            disabled={lockedOn || noLink}
                            onChange={() => toggleUse(m.id)}
                          />
                        </label>
                      </td>
                      <td>
                        {m.id === "mest" ? (
                          <span className="text-fg-2" aria-label="Not a contact detail">
                            &ndash;
                          </span>
                        ) : (
                          <label className="pn-settings-cell">
                            <input
                              type="checkbox"
                              aria-label={`Show ${m.label} to signed-in members`}
                              checked={draft.share.includes(m.id as Sharable)}
                              disabled={!used}
                              title={used ? undefined : "Turn it on first"}
                              onChange={() => toggleShare(m.id as Sharable)}
                            />
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {methodsError || shareError ? (
              <p id={`${fieldId(FORM, "contact.methods")}-error`} className="field-error t-small">
                {methodsError ?? shareError}
              </p>
            ) : null}
            <p className="pn-field-hint">
              Members can see a method only once you use it. Visitors who are not signed in never see any of them.
            </p>

            {draft.methods.some((m) => m === "email" || m === "phone" || m === "booking") ? (
              <div className="pn-form pn-form-2 mt-8">
                {draft.methods.includes("email") ? (
                  <SettingsField
                    form={FORM}
                    name="contact.contactEmail"
                    label="Email to share"
                    optional
                    privacy="private"
                    hint="Leave empty to use the address you sign in with."
                    error={errors["contact.contactEmail"]}
                  >
                    {(c) => (
                      <Input
                        {...c}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={draft.contactEmail}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, contactEmail: e.target.value }));
                          touch(["contact.contactEmail"]);
                        }}
                      />
                    )}
                  </SettingsField>
                ) : null}
                {draft.methods.includes("phone") ? (
                  <SettingsField
                    form={FORM}
                    name="contact.phone"
                    label="Phone number"
                    privacy="private"
                    hint="For example +1 504 555 0100. Never shown publicly."
                    error={errors["contact.phone"]}
                  >
                    {(c) => (
                      <Input
                        {...c}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={draft.phone}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, phone: e.target.value }));
                          touch(["contact.phone"]);
                        }}
                      />
                    )}
                  </SettingsField>
                ) : null}
                {draft.methods.includes("booking") ? (
                  <SettingsField
                    form={FORM}
                    name="contact.bookingUrl"
                    label="Scheduling link"
                    privacy="private"
                    hint="Calendly, Cal.com or similar, starting with https://"
                    error={errors["contact.bookingUrl"]}
                    className={draft.methods.includes("email") !== draft.methods.includes("phone") ? undefined : "pn-form-span"}
                  >
                    {(c) => (
                      <Input
                        {...c}
                        type="url"
                        inputMode="url"
                        placeholder="https://"
                        value={draft.bookingUrl}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, bookingUrl: e.target.value }));
                          touch(["contact.bookingUrl"]);
                        }}
                      />
                    )}
                  </SettingsField>
                ) : null}
              </div>
            ) : null}
          </Card>

          <SaveRow label="Save privacy and contact" pending={save.isPending} dirty={dirty} onUndo={undo} />
        </div>

        <aside className="grid grid-cols-1 gap-6 min-w-0" aria-label="What others see">
          <Card title="What is never shown" lift>
            <ul className="grid gap-3 t-small text-fg-2">
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Any contact detail, to visitors who are not signed in.
              </li>
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Your sign-in email, unless you turn on Email, show it to members and leave the email field empty.
              </li>
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Your phone number, unless you turn it on here.
              </li>
              <li className="flex gap-3">
                <Lock size={15} aria-hidden="true" className="shrink-0 mt-0.5 text-accent" />
                Who has sent you a request, and whom you declined.
              </li>
            </ul>
          </Card>
          <Card title="Check it">
            <p className="t-small text-fg-2">See exactly what a visitor and a signed-in member get once you save.</p>
            <UiLink to="/settings/preview" className="btn btn-outline btn-sm mt-4">
              Preview your profile
            </UiLink>
          </Card>
        </aside>
      </form>
    </>
  );
}
