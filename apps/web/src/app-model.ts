// The app shell's model: its state, the hooks that keep that state in step with
// the session and the address bar, and the actions its screens call.
//
// The hooks are called in the order their effects have to run. React runs a
// component's effects in the order they were declared, and the requests a page
// makes on mount follow from that order: the language ref is current before the
// boot reads it, the page view follows the metadata it reports, the session is
// read before a pending checkout is restored, and Back and Forward come last.

import { useEffect } from 'react';

import type { Account } from './api';
import { appActions, type ActionContext, type AppActions } from './app-actions';
import { useBackAndForward, useNavigate, useOpenScanById } from './app-navigation';
import { useConfirmEmailSignedIn, useSessionBoot } from './app-session';
import { useAppState } from './app-state';
import type { Language } from './i18n';
import { usePageMetadata } from './page-metadata';
import { usePendingCheckout, type PendingCheckoutState } from './pending-checkout';

export interface AppModelProps {
  readonly language: Language;
  readonly changeLanguage: (language: Language) => void;
  readonly onAccountChange: (account: Account | null) => void;
}

/** Everything the shell's screens read and call. */
export type AppModel = ActionContext &
  PendingCheckoutState &
  AppActions & { readonly changeLanguage: (language: Language) => void };

export function useAppModel({
  language,
  changeLanguage,
  onAccountChange,
}: AppModelProps): AppModel {
  const state = useAppState();
  const { account, screen, selectedScan } = state;
  const confirmEmailSignedIn = useConfirmEmailSignedIn(language, state);

  useEffect(() => {
    onAccountChange(account);
  }, [account, onAccountChange]);

  usePageMetadata(screen, language, selectedScan?.id ?? null);
  const openScanById = useOpenScanById(state);
  useSessionBoot({ ...state, openScanById, confirmEmailSignedIn });
  const checkout = usePendingCheckout(state);
  const navigate = useNavigate(state);
  useBackAndForward(state, openScanById);

  const context: ActionContext = { ...state, language, navigate, openScanById };
  return { ...context, ...checkout, changeLanguage, ...appActions(context) };
}
