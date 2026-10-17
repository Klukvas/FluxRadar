import type { ReactNode } from 'react';

import type { SiteProfile } from './api';
import { Button, SelectField } from './components';
import type { Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import type { NewScanForm } from './new-scan-form';
import { siteAddress } from './site-address';
import { SiteReachabilityPanel } from './SiteReachability';

/**
 * The numbered steps the new-scan screen is read as: which site, what to
 * check, and whether we can read it. Step 2 lives in `NewScanPlanStep.tsx`,
 * because it carries the pre-purchase disclosures and would crowd this file.
 */

/** One numbered step: a heading the reader can scan for, then its content. */
export function NewScanStep(props: {
  number: number;
  title: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="scan-step" aria-labelledby={props.id}>
      <h2 className="scan-step__title" id={props.id}>
        <span className="scan-step__number" aria-hidden="true">
          {props.number}
        </span>
        {props.title}
      </h2>
      {props.children}
      {props.hint === undefined ? null : <p className="muted scan-step__hint">{props.hint}</p>}
    </section>
  );
}

/**
 * Step 1: the saved site the scan runs against.
 *
 * Still a list of saved profiles underneath — the scan is always attached to
 * one — but named after what the buyer is choosing, and shown as
 * "Name · domain" without the scheme nobody reads.
 */
export function SiteStep(props: {
  form: NewScanForm;
  language: Language;
  profiles: readonly SiteProfile[];
  onCreateProfile: () => void;
}) {
  const c = newScanCopy[props.language];
  const { chooseTarget, target } = props.form;
  return (
    <NewScanStep number={1} title={c.steps.site} id="scan-step-site" hint={c.site.hint}>
      {props.profiles.length === 0 ? (
        <>
          <p className="muted panel-help">{c.site.noneLead}</p>
          {/* A button, not an `<a href="/profiles">`: the link reloaded the whole
              app, and the plan picked on a pricing card lives in memory, so
              somebody who chose Basic, made their first site and came back
              found the form on Free with nothing saying their choice had been
              dropped. */}
          <Button onClick={props.onCreateProfile}>{c.createProfile}</Button>
        </>
      ) : (
        <SelectField
          label={c.site.label}
          name="scan-profile"
          autoComplete="off"
          value={target}
          onChange={chooseTarget}
          options={props.profiles.map((profile) => ({
            value: profile.id,
            label: `${profile.name} · ${siteAddress(profile.domain)}`,
          }))}
        />
      )}
    </NewScanStep>
  );
}

/**
 * Step 3: can our crawler read the site — asked before the pay button, and
 * asked by itself the first time a never-checked site is chosen on a paid plan.
 *
 * Free is not a purchase and an internal scan takes no payment, so neither is
 * gated; the step says so instead of disappearing, so the numbering holds.
 */
export function ReachStep(props: {
  form: NewScanForm;
  language: Language;
  internalFreeAccess: boolean;
  claimAutoCheck: (profileId: string) => boolean;
}) {
  const c = newScanCopy[props.language];
  const { configLoading, egressLocation, launchConfig, plan } = props.form;
  const { resolveTargetProfileId, setSiteReachable } = props.form;
  const { target, usingSavedProfile } = props.form;
  const gated = plan !== 'Free' && !props.internalFreeAccess;
  return (
    <NewScanStep
      number={3}
      title={c.steps.reach}
      id="scan-step-reach"
      {...(gated ? { hint: c.reach.hint } : {})}
    >
      {gated ? (
        <SiteReachabilityPanel
          language={props.language}
          profileId={usingSavedProfile ? target : null}
          egressLocationId={egressLocation?.id ?? null}
          resolveProfileId={resolveTargetProfileId}
          onResult={setSiteReachable}
          // Ready once both sources of the egress country have answered: the
          // deployment's locations and, for a site with no saved settings,
          // the carried-over scope of its last scan.
          autoCheck={{
            ready: launchConfig.status !== 'loading' && !configLoading,
            claim: props.claimAutoCheck,
          }}
        />
      ) : (
        <p className="muted panel-help">
          {props.internalFreeAccess ? c.reach.internalNote : c.reach.freeNote}
        </p>
      )}
    </NewScanStep>
  );
}
