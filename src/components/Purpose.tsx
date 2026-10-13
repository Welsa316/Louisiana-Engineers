import { Mark } from "./Mark";

const disciplines = [
  "Civil",
  "Mechanical",
  "Electrical",
  "Chemical",
  "Petroleum",
  "Environmental",
  "Software",
];

export function Purpose() {
  return (
    <section className="section" id="purpose" aria-labelledby="purpose-title">
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">01</span>
          <h2 className="t-label" id="purpose-title">
            Our purpose
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-24">
          <div className="col-span-12 md:col-span-3">
            <Mark
              className="w-16 h-16 md:w-20 md:h-20 text-bronze"
              draw
            />
          </div>
          <div className="col-span-12 md:col-span-9 mt-10 md:mt-0">
            <p className="t-display-lg purpose-statement" data-split>
              A professional home for Muslim engineers, built to outlast any
              single career.
            </p>
          </div>
        </div>

        <div className="grid-12 mt-14 md:mt-24">
          <div className="col-span-12 md:col-start-4 md:col-span-4" data-reveal>
            <p className="t-body purpose-copy measure-wide">
              MEST exists to build lasting professional relationships among
              Muslim engineers, engineering students, and aspiring technical
              professionals throughout Louisiana.
            </p>
          </div>
          <div
            className="col-span-12 md:col-start-9 md:col-span-4 mt-6 md:mt-0"
            data-reveal
          >
            <p className="t-body purpose-copy measure-wide">
              We mentor the engineers who come next, hold ourselves to a high
              technical standard, and open doors to opportunity across the
              state's industries.
            </p>
          </div>
        </div>

        <div className="mt-16 md:mt-24 pt-6 border-t border-(--line)" data-reveal>
          <div className="grid-12 gap-y-4">
            <p className="t-label col-span-12 md:col-span-3 text-muted">
              Across disciplines
            </p>
            <ul className="disciplines col-span-12 md:col-span-9" aria-label="Engineering disciplines represented">
              {disciplines.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
