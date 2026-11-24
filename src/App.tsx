import { useCallback, useEffect, useState } from 'react';
import {
  Languages,
  Loader2,
  MessageSquare,
  Printer,
  QrCode,
  Settings,
  Store,
} from 'lucide-react';
import { AdminPanel } from './components/AdminPanel';
import { KioskDisplay } from './components/KioskDisplay';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PrintStudio } from './components/PrintStudio';
import { PWAInstallButton } from './components/PWAInstallButton';
import { WhatsAppStation } from './components/WhatsAppStation';
import { copy } from './i18n';
import type {
  AppTab,
  Language,
  PrintJob,
  PublicConfig,
  WhatsAppMessageLog,
} from './types';

export default function App() {
  const [lang, setLang] = useState<Language>('hi');
  const [activeTab, setActiveTab] = useState<AppTab>('print');
  const [selectedShop, setSelectedShop] = useState<string>('');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [queue, setQueue] = useState<PrintJob[]>([]);
  const [liveJobUpdate, setLiveJobUpdate] = useState<PrintJob | null>(null);
  const [liveLog, setLiveLog] = useState<WhatsAppMessageLog | null>(null);
  const [autoDispatchJobId, setAutoDispatchJobId] = useState<string | null>(null);
  const [liveEventCounter, setLiveEventCounter] = useState(0);

  const [initialJobCode, setInitialJobCode] = useState<string | undefined>(undefined);
  const [sourceMode, setSourceMode] = useState<'web_upload' | 'kiosk_qr'>('web_upload');

  const t = copy[lang];

  const loadConfigAndQueue = useCallback(async (shopSlugOrId?: string) => {
    try {
      const qParam = shopSlugOrId ? `?shop=${encodeURIComponent(shopSlugOrId)}` : '';
      const [cfgRes, qRes] = await Promise.all([
        fetch(`/api/public/config${qParam}`),
        fetch(`/api/public/queue${qParam}`),
      ]);
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as PublicConfig;
        setConfig(cfg);
      }
      if (qRes.ok) {
        const qData = await qRes.json();
        setQueue(qData.jobs || []);
      }
    } catch {
      // Offline fallback handled by PWA cache / indicator
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get('shop') || '';
    const jobParam = params.get('job');
    const kioskParam = params.get('kiosk');
    const tabParam = params.get('tab');

    if (shopParam) {
      setSelectedShop(shopParam);
    }
    if (jobParam) {
      setInitialJobCode(jobParam);
      setActiveTab('print');
    }
    if (kioskParam) {
      setSourceMode('kiosk_qr');
      setActiveTab('print');
    }
    if (tabParam === 'whatsapp' || tabParam === 'kiosk' || tabParam === 'admin') {
      setActiveTab(tabParam);
    }

    void loadConfigAndQueue(shopParam);
  }, [loadConfigAndQueue]);

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('job_created', (evt) => {
      const job = JSON.parse((evt as MessageEvent).data) as PrintJob;
      setQueue((prev) => [job, ...prev.filter((j) => j.id !== job.id)].slice(0, 12));
      setLiveJobUpdate(job);
      setLiveEventCounter((c) => c + 1);
    });

    es.addEventListener('job_updated', (evt) => {
      const job = JSON.parse((evt as MessageEvent).data) as PrintJob;
      setQueue((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      setLiveJobUpdate(job);
      setLiveEventCounter((c) => c + 1);
    });

    es.addEventListener('job_deleted', (evt) => {
      const { id } = JSON.parse((evt as MessageEvent).data) as { id: string };
      setQueue((prev) => prev.filter((j) => j.id !== id));
      setLiveEventCounter((c) => c + 1);
    });

    es.addEventListener('auto_print_dispatch', (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as { jobId: string };
      setAutoDispatchJobId(payload.jobId);
    });

    es.addEventListener('whatsapp_log', (evt) => {
      const log = JSON.parse((evt as MessageEvent).data) as WhatsAppMessageLog;
      setLiveLog(log);
    });

    es.addEventListener('settings_updated', () => {
      void loadConfigAndQueue(selectedShop);
    });

    return () => {
      es.close();
    };
  }, [loadConfigAndQueue, selectedShop]);

  function handleShopSwitch(slug: string) {
    setSelectedShop(slug);
    void loadConfigAndQueue(slug);
  }

  function openJobInStudio(code: string) {
    setInitialJobCode(code);
    setActiveTab('print');
  }

  const scopedQueue = config ? queue.filter((j) => j.shopId === config.shopId) : queue;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 md:pb-10">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md no-print">
        <div className="mx-auto flex h-[52px] md:h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('print')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t.brand}
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {(
              [
                { id: 'print', label: t.nav.print },
                { id: 'whatsapp', label: t.nav.whatsapp },
                { id: 'kiosk', label: t.nav.kiosk },
                { id: 'admin', label: t.nav.admin },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer border-b-2 ${
                  activeTab === item.id
                    ? 'border-blue-600 text-slate-900 font-semibold'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setLang((prev) => (prev === 'hi' ? 'en' : 'hi'))}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Languages className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>{lang === 'hi' ? 'English' : 'हिन्दी'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-5 sm:pt-7">
        {/* Workspace Bar: Shop Selector + PWA Install */}
        {config && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 empty:hidden no-print">
            {config.shops.length > 1 && activeTab !== 'admin' ? (
              <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                <Store className="w-4 h-4 text-blue-600 shrink-0" />
                <label htmlFor="active-shop-select" className="text-xs font-medium text-slate-600 whitespace-nowrap">
                  {t.selectShopLabel}:
                </label>
                <select
                  id="active-shop-select"
                  value={config.shopSlug}
                  onChange={(e) => handleShopSwitch(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-900 focus:outline-none cursor-pointer"
                >
                  {config.shops.map((s) => (
                    <option key={s.id} value={s.slug}>
                      {s.shopName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div />
            )}
            <PWAInstallButton lang={lang} />
          </div>
        )}

        {!config ? (
          <div className="py-24 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            {activeTab === 'print' && (
              <PrintStudio
                lang={lang}
                config={config}
                initialJobCode={initialJobCode}
                sourceMode={sourceMode}
                liveJobUpdate={liveJobUpdate}
              />
            )}
            {activeTab === 'whatsapp' && (
              <WhatsAppStation
                lang={lang}
                config={config}
                onOpenJobPayment={openJobInStudio}
                liveLog={liveLog}
              />
            )}
            {activeTab === 'kiosk' && (
              <KioskDisplay
                lang={lang}
                config={config}
                queue={scopedQueue}
                autoDispatchJobId={autoDispatchJobId}
                onOpenJob={openJobInStudio}
              />
            )}
            {activeTab === 'admin' && (
              <AdminPanel
                lang={lang}
                onSettingsUpdated={() => void loadConfigAndQueue(selectedShop)}
                liveEventCounter={liveEventCounter}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 h-16 border-t border-slate-200 bg-white/95 backdrop-blur-md no-print"
      >
        {(
          [
            { id: 'print', label: t.mobileNav.print, Icon: Printer },
            { id: 'whatsapp', label: t.mobileNav.whatsapp, Icon: MessageSquare },
            { id: 'kiosk', label: t.mobileNav.kiosk, Icon: QrCode },
            { id: 'admin', label: t.mobileNav.admin, Icon: Settings },
          ] as const
        ).map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center min-h-[44px] transition-colors cursor-pointer ${
                isActive ? 'text-blue-600' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="mt-1 text-[10px] font-semibold tracking-tight">{label}</span>
            </button>
          );
        })}
      </nav>

      <OfflineIndicator lang={lang} />
    </div>
  );
}
