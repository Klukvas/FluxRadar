import type { EgressLocation } from './api';
import { SelectField } from './components';
import { egressLocationLabel, type LaunchConfigState } from './egress-location';
import { copy, type Language } from './i18n';

/**
 * The country a paid check leaves from (D-228).
 *
 * Only locations the server says are configured and answering are listed — no
 * placeholder for a country that is not set up, because an option that cannot
 * be bought is a promise the screen cannot keep. The line under it says more
 * are coming instead.
 *
 * The Performance note is not optional. PageSpeed Insights measures from
 * Google's network whatever is chosen here, and without saying so the owner
 * would read the speed numbers as "for a visitor from Kyiv".
 */
export function EgressLocationField(props: {
  language: Language;
  config: LaunchConfigState;
  /** The location the launch will ask for, as `effectiveEgressLocation` resolved it. */
  selected: EgressLocation | null;
  onChange: (locationId: string) => void;
}) {
  const t = copy[props.language].newScan;
  const { config } = props;
  if (config.status === 'loading') return null;
  if (config.status === 'unavailable') {
    return <p className="muted panel-help">{t.egressLoadFailed}</p>;
  }
  // A deployment that crawls directly has nothing to choose, and saying
  // "from the server" to a customer would be a sentence about our hosting.
  if (config.egress.mode === 'direct') return null;
  if (config.egress.locations.length === 0) {
    return (
      <p className="muted panel-help" role="note">
        {t.egressNone}
      </p>
    );
  }
  return (
    <>
      <SelectField
        label={t.labelEgressLocation}
        name="scan-egress-location"
        autoComplete="off"
        hint={t.hintEgressLocation}
        value={props.selected?.id ?? ''}
        onChange={props.onChange}
        options={config.egress.locations.map((location) => ({
          value: location.id,
          label: egressLocationLabel(location, props.language),
        }))}
      />
      <p className="muted panel-help">{t.egressPerformanceNote}</p>
      <p className="muted panel-help">{t.egressMoreCountries}</p>
    </>
  );
}
