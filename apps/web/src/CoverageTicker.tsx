/**
 * The strip of audit-coverage labels under the hero, running as a marquee.
 *
 * The loop is pure CSS: one track holds the labels twice, and the track slides
 * exactly half its own width before restarting, so the copy that arrives is
 * pixel-identical to the copy that left and the seam never shows. Nothing here
 * measures the DOM or runs a timer — the duplicate is what makes the loop
 * seamless at any width, in any language.
 *
 * Only the first pass is real content. The second is scenery: it carries the
 * same words a screen reader has already read, so it is hidden from assistive
 * technology and the strip announces its labels exactly once.
 */
export function CoverageTicker(props: { label: string; items: readonly string[] }) {
  return (
    <div className="home__ticker">
      <div className="home__ticker-track">
        <ul className="home__ticker-group" role="list" aria-label={props.label}>
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <ul className="home__ticker-group" aria-hidden="true">
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
