/**
 * The contact choices as two columns: "Methods I use" (what accepted mentees
 * can be handed) and "Show to signed-in members" (what any verified member
 * sees on the profile). Requests through MEST is always on and is not a
 * contact detail. A method can be shown to members only once it is in use.
 * On phones the table becomes one card per method with the column names
 * beside each checkbox.
 */

import { contactMethods, type ContactMethodId } from "@shared/taxonomy";
import "./onboarding.css";

export function ContactMatrix({
  id,
  methods,
  shared,
  onChange,
  describedBy,
}: {
  id: string;
  methods: ContactMethodId[];
  shared: ContactMethodId[];
  onChange: (next: { methods: ContactMethodId[]; shared: ContactMethodId[] }) => void;
  describedBy?: string;
}) {
  function toggleUse(method: ContactMethodId): void {
    if (methods.includes(method)) {
      onChange({ methods: methods.filter((m) => m !== method), shared: shared.filter((m) => m !== method) });
    } else {
      onChange({ methods: [...methods, method], shared });
    }
  }
  function toggleShare(method: ContactMethodId): void {
    onChange({
      methods,
      shared: shared.includes(method) ? shared.filter((m) => m !== method) : [...shared, method],
    });
  }

  return (
    <table id={id} className="onb-contact" aria-describedby={describedBy}>
      <caption className="sr-only">How people can reach you</caption>
      <thead>
        <tr>
          <th scope="col">Method</th>
          <th scope="col">Methods I use</th>
          <th scope="col">Show to signed-in members</th>
        </tr>
      </thead>
      <tbody>
        {contactMethods.map((method) => {
          const fixed = method.id === "mest";
          const used = fixed || methods.includes(method.id);
          const sharedHere = !fixed && shared.includes(method.id);
          return (
            <tr key={method.id} data-used={used || undefined}>
              <th scope="row">
                <span className="onb-contact-name">{method.label}</span>
                <span className="onb-contact-note">{method.note}</span>
              </th>
              <td>
                {fixed ? (
                  <span className="onb-contact-fixed">Always on</span>
                ) : (
                  <label className="onb-check">
                    <input
                      type="checkbox"
                      aria-label={`${method.label}: I use this`}
                      checked={used}
                      onChange={() => toggleUse(method.id)}
                    />
                    <span className="onb-check-text">
                      I use this
                    </span>
                  </label>
                )}
              </td>
              <td>
                {fixed ? (
                  <span className="onb-contact-fixed">Not a contact detail</span>
                ) : (
                  <label className="onb-check" data-disabled={!used || undefined}>
                    <input
                      type="checkbox"
                      aria-label={`${method.label}: show to signed-in members`}
                      checked={sharedHere}
                      disabled={!used}
                      onChange={() => toggleShare(method.id)}
                    />
                    <span className="onb-check-text">
                      Show to signed-in members
                    </span>
                  </label>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
