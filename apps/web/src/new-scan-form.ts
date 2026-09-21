import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  ApiRequestError,
  apiRequest,
  type CheckoutSession,
  type Scan,
  type SiteProfile,
} from './api';
import { openCheckoutWindow, useCheckoutConfig, type PendingCheckout } from './Checkout';
import { AI_PROCESSING_NOTICE_VERSION } from './ai-processing-notice';
import { trackEvent } from './analytics';
import { trackBeginCheckout } from './checkout-analytics';
import { effectiveEgressLocation, freeEgressLocation, useLaunchConfig } from './egress-location';
import { copy, fillCopy, type Language } from './i18n';
import { normalizeSiteAddress } from './site-address-input';
import {
  DEFAULT_SCOPE_FORM,
  clampScopeToPlan,
  invalidScopeFields,
  profileScanConfigFingerprint,
  profileScanConfigFromForm,
  scanScopeFrom,
  scopeFormFromProfileConfig,
  scopeFormFromScan,
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
  initialPlan?: 'Free' | 'Basic' | 'Complete' | null;
}

export function useNewScanForm(props: NewScanFormProps) {
  const t = copy[props.language];
  // Whether a real checkout exists is a server fact, not a build-time flag: an
  // unreachable or unconfigured provider must never look like a working one.
  const checkout = useCheckoutConfig(!props.internalFreeAccess);
  const checkoutConfig = checkout.status === 'ready' ? checkout.config : null;
  const paidAvailable = props.internalFreeAccess || checkoutConfig?.available === true;
  // Until the server has answered, the screen says it is still asking rather
  // than announcing an absence it cannot yet know about.
  const checkoutPending = checkout.status === 'loading';
  // Which countries a check can leave from right now (D-228) — the server's
  // answer, like the checkout's, never a list built into the bundle.
  const launchConfig = useLaunchConfig();
  const egressConfig = launchConfig.status === 'ready' ? launchConfig.egress : null;
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
  const [plan, setPlan] = useState<'Free' | 'Basic' | 'Complete'>(
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
  /**
   * Whether the API says this site can be audited right now.
   *
   * Only the paid path reads it — a Free check is not a purchase, and gating it
   * would turn the one thing a stranger can try into a two-step form. The
   * server refuses the sale regardless (`createCheckoutSession`); this is what
   * keeps a buyer from meeting that refusal at the pay button.
   */
  const [siteReachable, setSiteReachable] = useState(false);
  /**
   * What this site sells, and the industry it sells it in.
   *
   * Asked on the paid form, not only in the profile editor: without either of
   * them the AI visibility section has no neutral topic to build discovery
   * questions from (`neutralContext`), so it falls back to the two questions
   * that name the brand — and those measure nothing (D-227). A buyer paying for
   * AI visibility should be told that before paying, not read it as a status
   * reason afterwards.
   */
  const [aiIndustry, setAiIndustry] = useState('');
  const [aiOfferings, setAiOfferings] = useState('');
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
      let latest: Scan | undefined;
      try {
        const scans = await apiRequest<readonly Scan[] | null>(
          `/profiles/${encodeURIComponent(target)}/scans?limit=1&offset=0`,
        );
        latest = Array.isArray(scans) ? scans[0] : undefined;
      } catch {
        latest = undefined;
      }
      if (cancelled) return;
      // Brought inside the chosen plan on the way in, not only on the way out:
      // the payload is clamped as well (`scanScopeFrom`), but a form that shows
      // a Complete-sized page count while Basic is selected is offering a scan
      // that is not the one the checkout would open on.
      const legacyPlan = planRef.current;
      setScope(
        latest === undefined
          ? DEFAULT_SCOPE_FORM
          : clampScopeToPlan(scopeFormFromScan(latest), legacyPlan),
      );
      setCarriedOver(latest !== undefined);
      setSavedConfigFingerprint(null);
      setSavedConfigVersion(null);
      setConfigLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [paidAvailable, props.internalFreeAccess, selected, target, usingSavedProfile]);

  // The selected profile's saved context, so the form asks only for what is
  // missing and never silently overwrites what an owner already wrote.
  useEffect(() => {
    setAiIndustry(selected?.industry ?? '');
    setAiOfferings(selected?.offerings ?? '');
  }, [selected?.id, selected?.industry, selected?.offerings]);

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
    // The workspace has one more site now, and the panels that list them are
    // rendered from the app's copy of that list. Refreshing it is a convenience
    // and is deliberately not awaited or allowed to fail the submission: the
    // profile exists either way, and a list that could not be re-read must not
    // cancel the check it was created for.
    void props.onProfilesChanged().catch(() => undefined);
    resolvedProfileVersion.current = resolved.profile.scanConfigVersion;
    return resolved.profile.id;
  };

  const persistProfileConfiguration = async (profileId: string): Promise<SiteProfile | null> => {
    const industry = aiIndustry.trim();
    const offerings = aiOfferings.trim();
    return apiRequest<SiteProfile | null>(`/profiles/${encodeURIComponent(profileId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        scanConfig: currentProfileConfig,
        // Saved on the profile, not on the scan: the next check of this site
        // starts from what its owner already told us.
        ...(industry === '' ? {} : { industry }),
        ...(offerings === '' ? {} : { offerings }),
        expectedProfileConfigVersion: usingSavedProfile
          ? (savedConfigVersion ?? selected?.scanConfigVersion)
          : resolvedProfileVersion.current,
      }),
    });
  };

  const saveConfiguration = async (): Promise<void> => {
    setSavingConfiguration(true);
    try {
      const profileId = await resolveTargetProfileId();
      if (profileId === null) return;
      const updated = unavailablePlanFallback
        ? selected
        : await persistProfileConfiguration(profileId);
      setSavedConfigFingerprint(
        profileScanConfigFingerprint(updated?.scanConfig ?? currentProfileConfig),
      );
      setSavedConfigVersion(updated?.scanConfigVersion ?? (savedConfigVersion ?? 0) + 1);
      setCarriedOver(true);
      await props.onProfilesChanged().catch(() => undefined);
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

  /** What went wrong, in the reader's language where the API gave a reason code. */
  const launchErrorMessage = (caught: unknown): string => {
    if (caught instanceof ApiRequestError && caught.code === 'EGRESS_LOCATION_UNAVAILABLE') {
      return t.newScan.egressUnavailableError;
    }
    if (caught instanceof ApiRequestError && caught.code === 'EGRESS_LOCATION_UNKNOWN') {
      return t.newScan.egressUnknownError;
    }
    return caught instanceof Error ? caught.message : 'Scan could not be created';
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
    setBusy(true);
    try {
      const profileId = await resolveTargetProfileId();
      if (profileId === null) return;
      let scan: Scan;
      const updated = unavailablePlanFallback
        ? selected
        : await persistProfileConfiguration(profileId);
      const expectedProfileConfigVersion =
        updated?.scanConfigVersion ?? savedConfigVersion ?? undefined;
      setSavedConfigFingerprint(
        profileScanConfigFingerprint(updated?.scanConfig ?? currentProfileConfig),
      );
      setSavedConfigVersion(updated?.scanConfigVersion ?? (savedConfigVersion ?? 0) + 1);
      await props.onProfilesChanged().catch(() => undefined);
      // Free sends the settings it will actually run with, not the ones the
      // form happens to hold; the server stores its own answer either way. A
      // paid plan names the location on screen, not a saved one that is down.
      const scopePayload = scanScopeFrom(scope, plan, egressLocation?.id ?? null);
      // Basic and Complete include provider-backed AI checks as part of the
      // purchased audit. The UI presents the data-transfer notice before
      // checkout; this compatibility field records which notice applied to the
      // scan so the orchestrator can enforce that contract boundary.
      const aiConsent =
        plan === 'Free'
          ? {}
          : {
              aiConsent: {
                providers: ['anthropic'],
                noticeVersion: AI_PROCESSING_NOTICE_VERSION,
              },
            };
      if (plan === 'Free') {
        scan = await apiRequest<Scan>(`/profiles/${profileId}/free-check`, {
          method: 'POST',
          body: JSON.stringify({ scope: scopePayload, expectedProfileConfigVersion }),
        });
        trackEvent('free_scan_started');
      } else if (props.internalFreeAccess) {
        // Internal allowlist only: creates a scan without a purchase, and is
        // refused for everyone else (and in production).
        scan = await apiRequest<{ scanId: string } & Record<string, unknown>>(
          '/billing/dev-checkout',
          {
            method: 'POST',
            body: JSON.stringify({
              siteProfileId: profileId,
              plan,
              scope: scopePayload,
              expectedProfileConfigVersion,
              ...aiConsent,
            }),
          },
        ).then((value) => apiRequest<Scan>(`/scans/${value.scanId}`));
      } else {
        // Paid plans hand off to the provider. No scan exists until the signed
        // provider webhook creates one, so nothing is created here.
        const session = await apiRequest<CheckoutSession>('/billing/checkout-session', {
          method: 'POST',
          body: JSON.stringify({
            siteProfileId: profileId,
            plan,
            scope: scopePayload,
            expectedProfileConfigVersion,
            ...aiConsent,
          }),
        });
        // With a popup checkout configured, the FastSpring iframe opens over this
        // page from `CheckoutPending` and the hosted URL is never opened by us —
        // it stays only as the link the buyer clicks if the popup could not load.
        // Without one (the older hosted storefront), the provider page opens in a
        // tab as before.
        const storefront = checkoutConfig?.popup?.storefront ?? null;
        trackBeginCheckout(session);
        props.onCheckoutStarted({
          accountId: props.accountId,
          reference: session.reference,
          sessionId: session.sessionId,
          checkoutUrl: session.checkoutUrl,
          storefront,
          restored: false,
          popupBlocked: storefront === null && !openCheckoutWindow(session.checkoutUrl),
        });
        return;
      }
      props.onCreated(scan);
    } catch (caught) {
      props.onError(launchErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const planOptions = [
    { value: 'Free', label: t.newScan.planFree },
    ...(paidAvailable
      ? [
          {
            value: 'Basic',
            label: props.internalFreeAccess ? t.newScan.planBasicInternal : t.newScan.planBasicPaid,
          },
          {
            value: 'Complete',
            label: props.internalFreeAccess
              ? t.newScan.planCompleteInternal
              : t.newScan.planCompletePaid,
          },
        ]
      : []),
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
  const configurationState = !usingSavedProfile
    ? 'new'
    : configLoading
      ? 'loading'
      : savedConfigFingerprint === null
        ? 'new'
        : configurationDirty
          ? 'dirty'
          : 'saved';
  const configurationStatusLabel =
    configurationState === 'dirty'
      ? t.newScan.configurationUnsaved
      : configurationState === 'new'
        ? t.newScan.configurationNew
        : configurationState === 'loading'
          ? t.newScan.configurationLoading
          : fillCopy(t.newScan.configurationSaved, {
              version: savedConfigVersion ?? 1,
            });
  const planLabel = planOptions.find((option) => option.value === plan)?.label ?? plan;
  const launchSite = usingSavedProfile ? targetLabel : address.trim() || '—';
  // The one thing standing between a filled-in form and the checkout, said
  // beside the button rather than only at the checkbox two columns away.
  const robotsUnconfirmed =
    paidScopeControls && !scope.respectRobots && !scope.robotsOverrideConfirmed;
  return {
    address,
    addressError,
    advancedOpen,
    aiIndustry,
    aiOfferings,
    busy,
    carriedOver,
    checkoutConfig,
    checkoutPending,
    configurationState,
    configurationStatusLabel,
    egressBlocked,
    egressLocation,
    invalidScope,
    launchConfig,
    launchSite,
    paidAvailable,
    paidScopeControls,
    plan,
    planLabel,
    planOptions,
    robotsUnconfirmed,
    // Exposed for the reachability panel, which needs the same profile the
    // submission will use — and must not create one just by being rendered.
    resolveTargetProfileId,
    saveConfiguration,
    savingConfiguration,
    scope,
    setAddress,
    setAddressError,
    setAdvancedChoice,
    setAiIndustry,
    setAiOfferings,
    setInvalidScope,
    setSiteReachable,
    setPlan,
    setScope,
    setTarget,
    siteReachable,
    submit,
    target,
    targetLabel,
    unavailablePlanFallback,
    updateScope,
    usingSavedProfile,
  };
}
