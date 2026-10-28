import { useEffect, useState } from 'react';

import { subscribeNetworkStatus } from './api';
import type { Language } from './i18n';

export type OfflineBannerCopy = {
  readonly body: string;
};

/**
 * The offline sentence, both languages. It must stay honest: nothing in the
 * product queues offline work, so the copy never promises "we'll send it
 * later". A scan that already started runs server-side; typed input is client
 * state and survives — the copy says exactly that.
 */
export const offlineBannerCopy: Record<Language, OfflineBannerCopy> = {
  en: {
    body: "You're offline. FluxRadar can't show results while the connection is down. A running scan keeps going — reconnect to see it.",
  },
  uk: {
    body: "Ви офлайн. FluxRadar не може показати результати, поки з'єднання перервано. Запущений скан триває далі — під'єднайтеся знову, щоб його побачити.",
  },
};

/**
 * The one offline state for the whole app: a fixed banner beside the global
 * notice. It is driven by the browser's online/offline events for fast
 * feedback and by the fetch layer's real observations (`subscribeNetworkStatus`)
 * for the truth — `navigator.onLine` is only a hint, a failed fetch with
 * status 0 is what actually happened, and a completed round-trip is what
 * actually recovered. It only reports; it never queues or retries anything.
 */
export function OfflineBanner({ language }: { readonly language: Language }) {
  const [offline, setOffline] = useState<boolean>(() => navigator.onLine === false);
  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    const unsubscribe = subscribeNetworkStatus(setOffline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      unsubscribe();
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      <p>{offlineBannerCopy[language].body}</p>
    </div>
  );
}
