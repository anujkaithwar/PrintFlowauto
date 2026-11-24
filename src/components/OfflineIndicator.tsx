import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import type { Language } from '../types';
import { copy } from '../i18n';

export const OfflineIndicator: React.FC<{ lang: Language }> = ({ lang }) => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-sm">
      <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
      <span>{copy[lang].offlineBanner}</span>
    </div>
  );
};
