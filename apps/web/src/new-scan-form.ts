import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  apiRequest,
  type CheckoutConfig,
  type EgressLocation,
  type Scan,
  type SiteProfile,
} from './api';
import { AI_PROCESSING_OPT_IN_PROVIDERS } from './ai-processing-notice';
import type { AiProcessingOptInProvider } from './ai-processing-notice';
import { parseApiCheckLines, type ApiCheckLineProblem } from './api-check-lines';
import { useCheckoutConfig, type PendingCheckout } from './Checkout';
import {
  effectiveEgressLocation,
  freeEgressLocation,
  useLaunchConfig,
  type LaunchConfigState,
} from './egress-location';
import { copy, type Language } from './i18n';
import { launchErrorMessage } from './launch-errors';
import {
  configurationStateOf,
  configurationStatusLabel,
  scopeFromLastScan,
  type ConfigurationState,
} from './new-scan-configuration';
import { requestScan } from './new-scan-request';
import { PLAN_MODULES, type Plan } from './plan-modules';
import { normalizeSiteAddress } from './site-address-input';
import {
  DEFAULT_SCOPE_FORM,
  clampScopeToPlan,
  invalidScopeFields,
  profileScanConfigFingerprint,
  profileScanConfigFromForm,
  scanScopeFrom,
  scopeFormFromProfileConfig,
  type ScanScopeForm,
  type ScopeNumberField,
} from './scan-scope';

/**
 * Everything the new-scan screen knows and can do, minus how it looks.
 *
 * The screen owns a configuration saved per profile, a plan that clamps the
 * limits under it, a robots.txt override, a validation pass that has to run
 * before a checkout opens, and a purchase only the provider's webhook can
 * complete. That is one subject, and it sat 400 lines deep inside a component
 * whose other half is the form's markup, so the file holding it changed for
 * both reasons at once. It lives here; the screen destructures it and renders.
 *
 * Two neighbours carry what is not about holding form state: where the starting
 * settings come from (`new-scan-configuration.ts`) and which request actually
 * creates a scan (`new-scan-request.ts`).
 */

/**
 * The select value that means "a site this account has not saved yet".
 *
 * It is a sentinel rather than an empty string because an empty select value is
 * also what "nothing chosen" looks like, and the two have to be told apart: one
 * of them is a valid way to start a scan.
 */
export const NEW_ADDRESS_TARGET = 'new-address';

/** The form control each number field the scope validator can reject lives in. */
const SCOPE_FIELD_NAMES: Readonly<Record<ScopeNumberField, string>> = {
  maxPages: 'scan-max-pages',
  maxDepth: 'scan-max-depth',
};

/**
 * The seed lines that are not a site address.
 *
 * The server refuses these too — and refuses one pointed at another site,
 * which only it can judge — but a seed rejected after a checkout has opened is
 * a page the owner paid to have checked and did not get.
 */
function invalidSeedLines(value: string): readonly string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => {
      try {
        const url = new URL(line);
        return url.protocol !== 'http:' && url.protocol !== 'https:';
      } catch {
        return true;
      }
    });
}

export interface NewScanFormProps {
  accountId: string;
  onCheckoutStarted: (pending: PendingCheckout) => void;
  profiles: readonly SiteProfile[];
  selectedProfile: SiteProfile | null;
  internalFreeAccess: boolean;
  language: Language;
  onCreated: (scan: Scan) => void;
  /** Called after an address became a profile, so the workspace lists it. */
  onProfilesChanged: () => Promise<void>;
  onClose: () => void;
  onError: (value: string) => void;
  /**
   * The plan the owner already chose — on the pricing cards before signing up,
   * or with "Run Complete for this site" on a Free report. Applied once, and
   * only when that plan can actually be bought here.
   */
  initialPlan?: Plan | null;
}

interface PlanOption {
  readonly value: Plan;
  readonly label: string;
}

/**
 * What the screen renders from and acts through.
 *
 * The actions are named after the decision they carry out rather than the state
 * they happen to set: choosing a plan also moves the limits under it, and a
 * screen handed a bare `setPlan` would have to know that.
 */
export interface NewScanForm {
  readonly address: string;
  readonly addressError: string | null;
  readonly advancedOpen: boolean;
  readonly busy: boolean;
  /** False while a submission would be refused, for whatever reason. */
  readonly canLaunch: boolean;
  /** False while the settings cannot be stored on the profile. */
  readonly canSave: boolean;
  readonly carriedOver: boolean;
  readonly checkoutConfig: CheckoutConfig | null;
  readonly checkoutPending: boolean;
  readonly configurationState: ConfigurationState;
  readonly configurationStatusLabel: string;
  /** True while the deployment offers locations but none of them can be used. */
  readonly egressBlocked: boolean;
  /** Where this launch will leave from, or null while nothing is on offer. */
  readonly egressLocation: EgressLocation | null;
  /** What the deployment offers; the picker and the summary read the same answer. */
  readonly launchConfig: LaunchConfigState;
  /** Whether the reachability probe says a paid scan of this site may be sold. */
  readonly siteReachable: boolean;
  readonly setSiteReachable: (reachable: boolean) => void;
  /**
   * Resolves the profile this launch is for, creating it from a typed address
   * when there is none yet. The reachability panel probes the same profile the
   * submit will buy a scan of.
   */
  readonly resolveTargetProfileId: () => Promise<string | null>;
  readonly invalidScope: readonly ScopeNumberField[];
  /**
   * The same contract as `invalidScope`, for the two settings that are lists of
   * addresses rather than numbers.
   */
  readonly invalidSeedUrls: readonly string[];
  readonly apiCheckProblems: readonly ApiCheckLineProblem[];
  /**
   * The optional AI recipients this deployment can actually send to, and the
   * ones the owner turned on. Empty offer means no optional block is shown.
   */
  readonly offeredOptInAiProviders: readonly AiProcessingOptInProvider[];
  readonly optInAiProviders: readonly AiProcessingOptInProvider[];
  /** What the submit button says right now, including while it is working. */
  readonly launchLabel: string;
  readonly launchSite: string;
  readonly paidAvailable: boolean;
  /** True on the plans whose crawl the form may actually shape. */
  readonly paidScopeControls: boolean;
  readonly plan: Plan;
  readonly planLabel: string;
  readonly planOptions: readonly PlanOption[];
  readonly robotsUnconfirmed: boolean;
  readonly savingConfiguration: boolean;
  readonly scope: ScanScopeForm;
  /** True when this submission is a purchase, and says so beside the button. */
  readonly showsPurchaseTerms: boolean;
  readonly target: string;
  readonly targetLabel: string;
  readonly usingSavedProfile: boolean;
  readonly chooseTarget: (target: string) => void;
  readonly choosePlan: (plan: Plan) => void;
  readonly editAddress: (value: string) => void;
  readonly toggleAdvanced: (open: boolean) => void;
  readonly updateScope: (change: Partial<ScanScopeForm>) => void;
  readonly toggleOptInAiProvider: (provider: AiProcessingOptInProvider, selected: boolean) => void;
  readonly saveConfiguration: () => Promise<void>;
  readonly submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function useNewScanForm(props: NewScanFormProps): NewScanForm {
  const t = copy[props.language];
  // Whether a real checkout exists is a server fact, not a build-time flag: an
  // unreachable or unconfigured provider must never look like a working one.
  const checkout = useCheckoutConfig(!props.internalFreeAccess);
  const checkoutConfig = checkout.status === 'ready' ? checkout.config : null;
  const paidAvailable = props.internalFreeAccess || checkoutConfig?.available === true;
  // Where a launch may leave from (D-228). The same server answer decides what
  // the country picker offers and what the summary names, so the two cannot
  // disagree about the scan that is about to be bought.
  const launchConfig = useLaunchConfig();
  const egressConfig = launchConfig.status === 'ready' ? launchConfig.egress : null;
  /**
   * Whether the API says this site can be audited right now.
   *
   * Only the paid path reads it — a Free check is not a purchase, and gating it
   * would turn the one thing a stranger can try into a two-step form. The
   * server refuses the sale regardless (`createCheckoutSession`); this is what
   * keeps a buyer from meeting that refusal at the pay button.
   */
  const [siteReachable, setSiteReachable] = useState(false);
  // Until the server has answered, the screen says it is still asking rather
  // than announcing an absence it cannot yet know about.
  const checkoutPending = checkout.status === 'loading';
  // An account with nothing saved starts on the address field: a scan no longer
  // needs a profile to exist first, so this screen no longer refuses to open.
  const [target, setTarget] = useState(
    props.selectedProfile?.id ?? props.profiles[0]?.id ?? NEW_ADDRESS_TARGET,
  );
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  // A saved profile owns its preferred plan. New addresses keep the existing
  // free-first flow; internal accounts start on Complete so they can exercise
  // the full report without a payment.
  const [plan, setPlan] = useState<Plan>(
    props.selectedProfile?.scanConfig?.plan ?? (props.internalFreeAccess ? 'Complete' : 'Free'),
  );
  // Legacy profile fixtures and profiles created before the migration still
  // fall back to the last scan while their saved config is absent. Keep the
  // plan the owner chose while that compatibility read is in flight.
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [scope, setScope] = useState<ScanScopeForm>(() =>
    props.selectedProfile?.scanConfig == null
      ? DEFAULT_SCOPE_FORM
      : scopeFormFromProfileConfig(props.selectedProfile.scanConfig),
  );
  // The number fields the owner has been told to fix, empty until a submission
  // finds one: a form that reddens while someone is still typing into it is
  // telling them they are wrong before they have finished being right.
  const [invalidScope, setInvalidScope] = useState<readonly ScopeNumberField[]>([]);
  // The same contract as `invalidScope`, for the two settings that are lists of
  // addresses rather than numbers.
  const [invalidSeedUrls, setInvalidSeedUrls] = useState<readonly string[]>([]);
  const [apiCheckProblems, setApiCheckProblems] = useState<readonly ApiCheckLineProblem[]>([]);
  // The optional recipients this deployment can actually send to. Offering one
  // it cannot serve would sell a Partial scan: the worker builds that
  // provider's requests, every one of them meets an unconfigured provider, and
  // a Partial paid scan carries no automatic refund. The server refuses such a
  // checkout as well — this is the form not asking for the refusal.
  //
  // An internal free-access account never asks for the checkout configuration
  // (it never checks out), so it is offered both and told by the server if one
  // is not configured. That path takes no payment, so there is nothing to
  // protect it from beyond an honest refusal.
  const offeredOptInAiProviders: readonly AiProcessingOptInProvider[] = props.internalFreeAccess
    ? AI_PROCESSING_OPT_IN_PROVIDERS
    : AI_PROCESSING_OPT_IN_PROVIDERS.filter((provider) =>
        (checkoutConfig?.optInAiProviders ?? []).includes(provider),
      );
  // Extra AI recipients, off until the owner turns one on. An unselected
  // provider is not sent — it is not in the list the scan stores, so the worker
  // never builds a request for it.
  const [optInAiProviders, setOptInAiProviders] = useState<readonly AiProcessingOptInProvider[]>(
    [],
  );
  const toggleOptInAiProvider = (provider: AiProcessingOptInProvider, selected: boolean): void => {
    setOptInAiProviders((current) =>
      selected
        ? current.includes(provider)
          ? current
          : [...current, provider]
        : current.filter((entry) => entry !== provider),
    );
  };
  // The opt-ins this scan will actually be asked to honour: only recipients the
  // deployment still offers, and only on a plan that runs the module they serve.
  // Both filters answer the same question — a tick the screen stopped showing is
  // not consent — so the request reads this rather than the raw selection.
  const selectedOptInAiProviders: readonly AiProcessingOptInProvider[] = PLAN_MODULES[
    plan
  ].includes('AI SEO / GEO')
    ? optInAiProviders.filter((provider) => offeredOptInAiProviders.includes(provider))
    : [];
  // True once the settings below came from the reusable profile configuration.
  const [carriedOver, setCarriedOver] = useState(false);
  // The crawl rules most scans never touch. Whatever a saved configuration sets
  // beyond the defaults has to be on screen before the owner pays for that
  // crawl, so the settings decide whether the group starts open — and they go
  // on deciding, since the settings arrive after the first render.
  const advancedConfigured =
    scope.includePatterns.trim() !== '' ||
    scope.excludePatterns.trim() !== '' ||
    scope.queryPolicy !== 'ignore';
  // Null until the owner opens or closes the group themselves, and null again
  // whenever the target changes: their choice belongs to the profile they made
  // it on. An effect that only ever opened the group left a second configured
  // profile closed over its own patterns, because the flag above never moved.
  const [advancedChoice, setAdvancedChoice] = useState<boolean | null>(null);
  useEffect(() => {
    setAdvancedChoice(null);
  }, [target]);
  const advancedOpen = advancedChoice ?? advancedConfigured;
  const [busy, setBusy] = useState(false);
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const [savedConfigFingerprint, setSavedConfigFingerprint] = useState<string | null>(() =>
    props.selectedProfile?.scanConfig == null
      ? null
      : profileScanConfigFingerprint(props.selectedProfile.scanConfig),
  );
  const [savedConfigVersion, setSavedConfigVersion] = useState<number | null>(
    props.selectedProfile?.scanConfigVersion ?? null,
  );
  // Whether the compatibility read below is still in flight. "Loading" used to
  // be inferred from the absence of a saved fingerprint, which every profile
  // that never stored a configuration has for good — so a brand-new profile
  // said "Configuration is loading…" forever.
  const [configLoading, setConfigLoading] = useState(false);
  const usingSavedProfile = target !== NEW_ADDRESS_TARGET;
  const resolvedProfileVersion = useRef<number | undefined>(undefined);
  const selected = props.profiles.find((profile) => profile.id === target);
  const currentProfileConfig = profileScanConfigFromForm(scope, plan);
  const unavailablePlanFallback =
    usingSavedProfile &&
    !paidAvailable &&
    plan === 'Free' &&
    selected?.scanConfig != null &&
    selected.scanConfig.plan !== 'Free';
  const configurationDirty =
    usingSavedProfile &&
    !unavailablePlanFallback &&
    savedConfigFingerprint !== null &&
    profileScanConfigFingerprint(currentProfileConfig) !== savedConfigFingerprint;
  const updateScope = (change: Partial<ScanScopeForm>): void => {
    setScope((current) => ({ ...current, ...change }));
    // Editing a field withdraws the complaint about it, as the address field
    // does: the message described the value that has just been replaced.
    const edited = Object.keys(change);
    setInvalidScope((current) => current.filter((field) => !edited.includes(field)));
    if (edited.includes('seedUrls')) setInvalidSeedUrls([]);
    if (edited.includes('apiChecks')) setApiCheckProblems([]);
  };

  /**
   * Choosing a plan moves the limits with it.
   *
   * A site last checked on Complete opens on Complete-sized limits; carrying
   * those into Basic asks for more pages than Basic sells, which the API
   * refuses. The numbers move to the chosen plan here, where the owner can see
   * what they are about to buy — not in the screen, which would have to know
   * that choosing a plan is three state changes.
   */
  const choosePlan = (chosen: Plan): void => {
    setPlan(chosen);
    setScope((current) => clampScopeToPlan(current, chosen));
    setInvalidScope([]);
  };

  const editAddress = (value: string): void => {
    setAddress(value);
    if (addressError !== null) setAddressError(null);
  };

  /**
   * The workspace lists the account's sites, and a submission may have just
   * added one. Refreshing that list is a convenience and deliberately cannot
   * fail the submission: the profile exists either way, and a list that could
   * not be re-read must not cancel the check it was created for. It is logged
   * rather than swallowed — a refresh that always fails is otherwise invisible.
   */
  const refreshProfiles = async (): Promise<void> => {
    try {
      await props.onProfilesChanged();
    } catch (caught) {
      console.error('FluxRadar site list could not be refreshed', caught);
    }
  };

  /** Opens the form on the reusable settings stored with the selected profile. */
  useEffect(() => {
    if (!usingSavedProfile) {
      setPlan(props.internalFreeAccess ? 'Complete' : 'Free');
      setScope(DEFAULT_SCOPE_FORM);
      setCarriedOver(false);
      setSavedConfigFingerprint(null);
      setSavedConfigVersion(null);
      setConfigLoading(false);
      return;
    }
    if (selected?.scanConfig != null) {
      setConfigLoading(false);
      const restoredPlan = paidAvailable ? selected.scanConfig.plan : 'Free';
      setPlan(restoredPlan);
      setScope(
        clampScopeToPlan(scopeFormFromProfileConfig(selected.scanConfig), selected.scanConfig.plan),
      );
      setCarriedOver(true);
      setSavedConfigFingerprint(profileScanConfigFingerprint(selected.scanConfig));
      setSavedConfigVersion(selected.scanConfigVersion ?? 1);
      return;
    }
    let cancelled = false;
    setConfigLoading(true);
    void (async () => {
      const carried = await scopeFromLastScan(target, planRef.current);
      if (cancelled) return;
      setScope(carried ?? DEFAULT_SCOPE_FORM);
      setCarriedOver(carried !== null);
      setSavedConfigFingerprint(null);
      setSavedConfigVersion(null);
      setConfigLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [paidAvailable, props.internalFreeAccess, selected, target, usingSavedProfile]);

  // After the profile's own settings above, so the owner's explicit choice wins.
  const initialPlanApplied = useRef(false);
  const { initialPlan } = props;
  useEffect(() => {
    if (initialPlanApplied.current || initialPlan == null) return;
    if (initialPlan !== 'Free' && !paidAvailable) return;
    initialPlanApplied.current = true;
    setPlan(initialPlan);
    setScope((current) => clampScopeToPlan(current, initialPlan));
  }, [initialPlan, paidAvailable, target]);

  /**
   * The profile this scan runs against, creating one from a typed address.
   *
   * Returns null when the address is not a site address — the field says so and
   * the submission stops there, without a request. The server normalizes and
   * re-checks the origin as well; this step exists so the owner never meets
   * backend validation prose.
   */
  const resolveTargetProfileId = async (): Promise<string | null> => {
    if (usingSavedProfile) return target;
    const normalized = normalizeSiteAddress(address);
    if (!normalized.ok) {
      setAddressError(t.workspace.siteAddressError);
      return null;
    }
    setAddressError(null);
    const resolved = await apiRequest<{ profile: SiteProfile; created: boolean }>(
      '/profiles/resolve',
      { method: 'POST', body: JSON.stringify({ domain: normalized.origin }) },
    );
    void refreshProfiles();
    resolvedProfileVersion.current = resolved.profile.scanConfigVersion;
    return resolved.profile.id;
  };

  const persistProfileConfiguration = async (profileId: string): Promise<SiteProfile | null> => {
    return apiRequest<SiteProfile | null>(`/profiles/${encodeURIComponent(profileId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        scanConfig: currentProfileConfig,
        expectedProfileConfigVersion: usingSavedProfile
          ? (savedConfigVersion ?? selected?.scanConfigVersion)
          : resolvedProfileVersion.current,
      }),
    });
  };

  /** Stores what the form holds, and answers with the version it now sits on. */
  const rememberSavedConfiguration = (updated: SiteProfile | null): number | undefined => {
    setSavedConfigFingerprint(
      profileScanConfigFingerprint(updated?.scanConfig ?? currentProfileConfig),
    );
    setSavedConfigVersion(updated?.scanConfigVersion ?? (savedConfigVersion ?? 0) + 1);
    return updated?.scanConfigVersion ?? savedConfigVersion ?? undefined;
  };

  const saveConfiguration = async (): Promise<void> => {
    setSavingConfiguration(true);
    try {
      const profileId = await resolveTargetProfileId();
      if (profileId === null) return;
      const updated = unavailablePlanFallback
        ? selected
        : await persistProfileConfiguration(profileId);
      rememberSavedConfiguration(updated ?? null);
      setCarriedOver(true);
      await refreshProfiles();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Configuration could not be saved');
    } finally {
      setSavingConfiguration(false);
    }
  };

  // The location this launch will actually ask for: Free always leaves from the
  // default one; a paid plan from the owner's choice while it is on offer.
  const egressLocation =
    plan === 'Free'
      ? freeEgressLocation(egressConfig)
      : effectiveEgressLocation(scope.egressLocation, egressConfig);
  // The server refuses such a launch anyway; this keeps the owner from meeting
  // that refusal at the button.
  const egressBlocked =
    egressConfig !== null && egressConfig.mode === 'proxy' && egressLocation === null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    // A page count of 0 or 2.5 is a typo, and the request it would become asks
    // for a scan nobody chose. It is said here, on the field, rather than left
    // to the API — by then a paid checkout has already opened.
    const invalid = invalidScopeFields(scope, plan);
    setInvalidScope(invalid);
    const [firstInvalid] = invalid;
    if (firstInvalid !== undefined) {
      // The fields are in the settings column and the button that was just
      // pressed is in the launch column beside it, so the complaint can render
      // off the screen the owner is looking at. Move them to it.
      const field = event.currentTarget.elements.namedItem(SCOPE_FIELD_NAMES[firstInvalid]);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    // The two lists of addresses, for the same reason: a line that is not a URL
    // would simply be dropped, and the owner would find the page they typed
    // missing from a report they had already bought.
    const badSeeds = paidScopeControls ? invalidSeedLines(scope.seedUrls) : [];
    const badApiChecks = paidScopeControls ? parseApiCheckLines(scope.apiChecks).problems : [];
    setInvalidSeedUrls(badSeeds);
    setApiCheckProblems(badApiChecks);
    if (badSeeds.length > 0 || badApiChecks.length > 0) {
      const badListField = badSeeds.length > 0 ? 'scan-seed-urls' : 'scan-api-checks';
      const field = event.currentTarget.elements.namedItem(badListField);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setBusy(true);
    try {
      const profileId = await resolveTargetProfileId();
      if (profileId === null) return;
      const updated = unavailablePlanFallback
        ? selected
        : await persistProfileConfiguration(profileId);
      const expectedProfileConfigVersion = rememberSavedConfiguration(updated ?? null);
      await refreshProfiles();
      const scan = await requestScan({
        accountId: props.accountId,
        profileId,
        plan,
        // Free sends the settings it will actually run with, not the ones the
        // form happens to hold; the server stores its own answer either way. A
        // paid plan names the location on screen, not a saved one that is down.
        scope: scanScopeFrom(scope, plan, egressLocation?.id ?? null),
        expectedProfileConfigVersion,
        // The default recipients plus whatever extra ones the owner turned on.
        // A provider absent from this list receives nothing, and one the
        // deployment stopped offering while the form was open is dropped rather
        // than sent to a checkout that refuses it.
        //
        // A plan without AI SEO / GEO drops them all: the selection is only ever
        // offered beside that module, so on Website Audit it can only be a
        // leftover from a plan the owner switched away from. Sending it would
        // record consent to a recipient this scan never asks — the same
        // inaccuracy as the notice promising a transfer that does not happen.
        optInAiProviders: selectedOptInAiProviders,
        internalFreeAccess: props.internalFreeAccess,
        storefront: checkoutConfig?.popup?.storefront ?? null,
        onCheckoutStarted: props.onCheckoutStarted,
      });
      // Null means a paid checkout took over and no scan exists yet.
      if (scan !== null) props.onCreated(scan);
    } catch (caught) {
      props.onError(launchErrorMessage(caught, props.language, 'Scan could not be created'));
    } finally {
      setBusy(false);
    }
  };

  // Which paid plans this deployment can actually open a checkout for.
  //
  // The server answers per plan, because a product can exist at the provider for
  // one plan and not another; a plan it cannot sell is left off the picker
  // rather than offered and refused at the pay button. Two deliberate
  // fallbacks to what the answer used to mean: a server that lists no plans at
  // all, and a listed plan with no `available` field, are both read as "sellable
  // if the checkout is", which is the only thing the older answer could say.
  const listedPlans = checkoutConfig?.plans ?? [];
  const sellablePlans = new Set(
    listedPlans.filter((entry) => entry.available !== false).map((entry) => entry.plan),
  );
  const offersPlan = (value: string): boolean =>
    props.internalFreeAccess || listedPlans.length === 0 || sellablePlans.has(value);
  const everyPaidPlanOption: readonly PlanOption[] = [
    {
      value: 'Basic',
      label: props.internalFreeAccess ? t.newScan.planBasicInternal : t.newScan.planBasicPaid,
    },
    {
      value: 'WebsiteAudit',
      label: props.internalFreeAccess
        ? t.newScan.planWebsiteAuditInternal
        : t.newScan.planWebsiteAuditPaid,
    },
    {
      value: 'Complete',
      label: props.internalFreeAccess ? t.newScan.planCompleteInternal : t.newScan.planCompletePaid,
    },
  ];
  const paidPlanOptions = everyPaidPlanOption.filter((option) => offersPlan(option.value));
  const planOptions: readonly PlanOption[] = [
    { value: 'Free', label: t.newScan.planFree },
    ...(paidAvailable ? paidPlanOptions : []),
  ];
  // Free is the fixed homepage check: the crawl controls below do not reach it,
  // so they are not offered on it. The server enforces the same thing whatever
  // is sent (orchestrator/run-attempt.ts); this is the form telling the truth
  // about it instead of collecting settings that would be discarded.
  const paidScopeControls = plan !== 'Free';
  // The status line names what is about to be checked. Asking for a profile
  // when there is no profile picker on screen is the one thing it may not say.
  const targetLabel = usingSavedProfile
    ? (selected?.domain ?? t.newScan.noProfile)
    : normalizeSiteAddress(address).ok
      ? address.trim()
      : t.newScan.noAddress;
  const configurationState = configurationStateOf({
    usingSavedProfile,
    loading: configLoading,
    savedFingerprint: savedConfigFingerprint,
    dirty: configurationDirty,
  });
  const planLabel = planOptions.find((option) => option.value === plan)?.label ?? plan;
  const launchSite = usingSavedProfile ? targetLabel : address.trim() || '—';
  // The one thing standing between a filled-in form and the checkout, said
  // beside the button rather than only at the checkbox two columns away.
  const robotsUnconfirmed =
    paidScopeControls && !scope.respectRobots && !scope.robotsOverrideConfirmed;
  // Both buttons refuse for the same reasons; saving refuses for two more,
  // because settings nobody can store are worse than a scan nobody can start.
  const targetChosen = usingSavedProfile ? target !== '' : address.trim() !== '';
  const idle = !busy && !savingConfiguration;
  const formReady = idle && targetChosen && !robotsUnconfirmed;
  // A paid scan of a site the crawler cannot read is a refund waiting to
  // happen, and the server refuses to sell it (FASTSPRING-009). Saving the
  // settings is not a purchase, so it is not gated on either of these.
  const reachabilityChecked = plan === 'Free' || props.internalFreeAccess || siteReachable;
  const canLaunch = formReady && !egressBlocked && reachabilityChecked;
  const canSave =
    formReady && !unavailablePlanFallback && invalidScopeFields(scope, plan).length === 0;
  // Who is about to be charged decides both the button and the terms line, so
  // the two cannot disagree about whether this submission is a purchase.
  const purchasing = paidScopeControls && !props.internalFreeAccess;
  const launchLabel = busy
    ? purchasing
      ? t.newScan.openingCheckout
      : t.newScan.creating
    : paidScopeControls
      ? props.internalFreeAccess
        ? t.newScan.runInternal
        : t.newScan.runPaid
      : t.newScan.runFree;

  return {
    address,
    addressError,
    advancedOpen,
    busy,
    canLaunch,
    canSave,
    carriedOver,
    checkoutConfig,
    checkoutPending,
    configurationState,
    configurationStatusLabel: configurationStatusLabel(
      configurationState,
      props.language,
      savedConfigVersion,
    ),
    egressBlocked,
    egressLocation,
    launchConfig,
    siteReachable,
    setSiteReachable,
    resolveTargetProfileId,
    invalidScope,
    invalidSeedUrls,
    apiCheckProblems,
    offeredOptInAiProviders,
    optInAiProviders,
    launchLabel,
    launchSite,
    paidAvailable,
    paidScopeControls,
    plan,
    planLabel,
    planOptions,
    robotsUnconfirmed,
    savingConfiguration,
    scope,
    showsPurchaseTerms: purchasing,
    target,
    targetLabel,
    usingSavedProfile,
    chooseTarget: setTarget,
    choosePlan,
    editAddress,
    toggleAdvanced: setAdvancedChoice,
    updateScope,
    toggleOptInAiProvider,
    saveConfiguration,
    submit,
  };
}
