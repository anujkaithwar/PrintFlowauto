import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { Language } from '../types';
import { copy } from '../i18n';

interface PWAInstallButtonProps {
  lang: Language;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ lang }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const t = copy[lang];

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{t.installApp}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>{t.installIos}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">
                  {lang === 'hi' ? 'iPhone / iPad पर इंस्टॉल करें' : 'Install on iPhone / iPad'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600 list-decimal list-inside">
                <li>{lang === 'hi' ? 'Safari में नीचे Share बटन दबाएं।' : 'Tap the Share button in Safari.'}</li>
                <li>{lang === 'hi' ? '"Add to Home Screen" चुनें।' : 'Scroll down and tap "Add to Home Screen".'}</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {lang === 'hi' ? 'समझ गया' : 'Got it'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
