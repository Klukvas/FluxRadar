import type { CSSProperties } from 'react';

/**
 * The home page title, typed in the way the station it belongs to would type it.
 *
 * The reveal is pure CSS. Every character of the title is in the DOM on the
 * first paint and keeps the space it occupies; only the moment it is *painted*
 * is delayed, one step per character, so the heading never reflows, never wraps
 * differently mid-animation and never leaves the message hidden. The cursor is
 * a pseudo-element drawn at the trailing edge of the character being typed,
 * with no width in the flow, so it rides the text without moving it.
 *
 * A title split into characters cannot be read: every accessible-name
 * implementation joins element children with a space, so a screen reader would
 * announce "O n e U R L ." and a Braille display would show it. The heading
 * therefore carries the whole title as its accessible name — the same two lines
 * the page paints, in the same order — and the split copy underneath is scenery
 * that assistive technology never reaches.
 *
 * With `prefers-reduced-motion: reduce` the stylesheet drops both animations and
 * the cursor, and the title is simply there — see `base.css`.
 */

/** The beat the reveal holds at the line break, counted in character steps. */
const LINE_BREAK_STEPS = 4;

/**
 * One line of the title, as characters that each carry their own step index.
 *
 * Spaces stay plain text: they have nothing to paint, and an element wrapped
 * around one would only risk the line breaking where the browser would not have
 * broken it on its own.
 */
function TypedLine(props: { text: string; from: number; endsTitle: boolean }) {
  const characters = Array.from(props.text);
  const last = characters.length - 1;
  return (
    <>
      {characters.map((character, position) =>
        character === ' ' ? (
          ' '
        ) : (
          <span
            key={position}
            className={
              props.endsTitle && position === last
                ? 'home__type-char home__type-char--last'
                : 'home__type-char'
            }
            style={{ '--type-step': props.from + position } as CSSProperties}
          >
            {character}
          </span>
        ),
      )}
    </>
  );
}

export function HeroTitle(props: { id: string; line: string; emphasis: string }) {
  return (
    <h1 id={props.id} aria-label={`${props.line} ${props.emphasis}`}>
      <span aria-hidden="true">
        <TypedLine text={props.line} from={0} endsTitle={false} />
        <br />
        <em>
          <TypedLine
            text={props.emphasis}
            from={Array.from(props.line).length + LINE_BREAK_STEPS}
            endsTitle
          />
        </em>
      </span>
    </h1>
  );
}
