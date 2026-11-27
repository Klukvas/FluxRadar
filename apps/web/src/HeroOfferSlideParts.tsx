// The two pieces every slide of the home page slider shares: the question it
// answers, and the line at its foot saying what the report includes and which
// plan has it. The foot is pushed to the bottom of the slide (`margin-top:
// auto`), so the caption sits in one place whichever slide is up.

export function SlideHead(props: { title: string; lead: string }) {
  return (
    <div className="home-hero__window-head">
      <h3 className="hero-offer__question">{props.title}</h3>
      <p className="home-hero__window-meta">{props.lead}</p>
    </div>
  );
}

/**
 * What the report includes, in bold, and the plans that have it. The plan is
 * named on every paid slide because the button beside the window starts the
 * Free check, and a slide that named no plan would read as part of Free.
 */
export function SlideIncludes(props: { lead: string; plans?: string }) {
  return (
    <p className="hero-offer__includes">
      <b>{props.lead}</b>
      {props.plans === undefined ? null : ` ${props.plans}`}
    </p>
  );
}
