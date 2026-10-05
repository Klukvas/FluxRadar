import { Button, Checkbox } from './components';
import { newScanCopy } from './new-scan-copy';
import type { Language } from './i18n';
import type { ScanScopeForm } from './scan-scope';

/**
 * The one decision that can stop a launch, said and taken in the same place.
 *
 * The warning used to sit in the launch summary while the tick that answers it
 * lived inside "For experienced users" — on a phone, screens above the button
 * it was blocking. An owner met a red box, a disabled button and no control
 * within reach. Warning, both ways out, the reason the button is held and the
 * button itself are now one stack, in that order.
 *
 * "Switch robots.txt back on" is here for the same reason the tick is: the
 * owner who did not mean to ignore robots.txt at all should not have to find
 * the checkbox that set it to get out of this.
 */

/** The warning the confirmation describes itself with. */
export const ROBOTS_OVERRIDE_WARNING_ID = 'robots-override-warning';

export function RobotsConfirmation(props: {
  language: Language;
  /** True while this scan is set to ignore robots.txt. */
  ignoresRobots: boolean;
  /** True while that setting was restored from the profile and not re-confirmed. */
  stale: boolean;
  confirmed: boolean;
  onChange: (scope: Partial<ScanScopeForm>) => void;
}) {
  const c = newScanCopy[props.language];
  if (!props.ignoresRobots) return null;
  return (
    <div className="robots-gate">
      <p className="launch-warning" id={ROBOTS_OVERRIDE_WARNING_ID} role="note">
        {c.robotsWarning}
        {props.stale ? ` ${c.robotsWarningStale}` : null}
      </p>
      <Checkbox
        label={c.robotsConfirmLabel}
        name="scan-robots-override"
        checked={props.confirmed}
        // Read with the warning above it, and — while the tick is what holds
        // the button — with the reason the button is held.
        describedBy={
          props.confirmed
            ? ROBOTS_OVERRIDE_WARNING_ID
            : `${ROBOTS_OVERRIDE_WARNING_ID} launch-blocked`
        }
        onChange={(checked) => props.onChange({ robotsOverrideConfirmed: checked })}
      />
      <Button
        type="button"
        onClick={() => props.onChange({ respectRobots: true, robotsOverrideConfirmed: false })}
      >
        {c.robotsBackOn}
      </Button>
    </div>
  );
}
