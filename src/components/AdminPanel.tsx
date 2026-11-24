import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  Check,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Store,
  Trash2,
  XCircle,
} from 'lucide-react';
import { copy, getStatusLabel } from '../i18n';
import {
  filterAndSortJobs,
  getJobFileCategory,
  type FileTypeFilter,
  type JobSortBy,
  type JobStatusFilter,
} from '../utils/jobFilters';
import { generateQrDataUrl } from '../utils/qrHelper';

const AdminStatsView = lazy(() =>
  import('./AdminStats').then((mod) => ({ default: mod.AdminStats }))
);
import type {
  AuthStatus,
  BusinessSettings,
  IntegrationStatus,
  Language,
  PrintJob,
  ShopConfig,
} from '../types';

interface AdminPanelProps {
  lang: Language;
  onSettingsUpdated: () => void;
  liveEventCounter: number;
}

interface AdminStats {
  totalJobs: number;
  paidJobs: number;
  completedJobs: number;
  pendingJobs: number;
  whatsappJobs: number;
  totalRevenue: number;
  totalPagesPrinted: number;
}

const ALL_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.txt',
  '.csv',
];

export const AdminPanel: React.FC<AdminPanelProps> = ({
  lang,
  onSettingsUpdated,
  liveEventCounter,
}) => {
  const t = copy[lang];
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  const [token, setToken] = useState<string>('');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [newPasscodeInput, setNewPasscodeInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [activeSubTab, setActiveSubTab] = useState<
    'queue' | 'stats' | 'shops' | 'settings' | 'clients' | 'integrations'
  >('queue');

  const [shops, setShops] = useState<ShopConfig[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('all');
  const [editingShopId, setEditingShopId] = useState<string>('');

  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);

  const [filterStatus, setFilterStatus] = useState<JobStatusFilter>('all');
  const [filterFileType, setFilterFileType] = useState<FileTypeFilter>('all');
  const [sortBy, setSortBy] = useState<JobSortBy>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [copiedUrl, setCopiedUrl] = useState('');

  // New Shop Creation State
  const [newShopName, setNewShopName] = useState('');
  const [newShopAddress, setNewShopAddress] = useState('');
  const [newShopUpiId, setNewShopUpiId] = useState('');
  const [newShopPayee, setNewShopPayee] = useState('');
  const [newShopWa, setNewShopWa] = useState('+91');
  const [newShopBwRate, setNewShopBwRate] = useState('2');
  const [newShopColorRate, setNewShopColorRate] = useState('10');
  const [creatingShop, setCreatingShop] = useState(false);
  const [shopError, setShopError] = useState('');

  // QR previews for Multi-Shop & Android Client
  const [shopQrMap, setShopQrMap] = useState<Record<string, { counter: string; wa: string }>>({});

  const fetchAuthStatus = useCallback(async (currentToken: string) => {
    try {
      const res = await fetch('/api/auth/status', {
        headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as AuthStatus;
        setAuthStatus(data);
        if (!data.authenticated && currentToken) {
          setToken('');
        }
      }
    } catch {
      // Ignore transient error
    }
  }, []);

  const fetchAdminData = useCallback(
    async (activeToken: string, queueFilterShopId?: string) => {
      if (!activeToken) return;
      const scope = queueFilterShopId || selectedShopId || 'all';
      try {
        const [jobsRes, intRes] = await Promise.all([
          fetch(`/api/admin/jobs?shopId=${encodeURIComponent(scope)}`, {
            headers: { Authorization: `Bearer ${activeToken}` },
          }),
          fetch('/api/admin/integration-status', {
            headers: { Authorization: `Bearer ${activeToken}` },
          }),
        ]);
        if (jobsRes.status === 401) {
          setToken('');
          setAuthStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
          return;
        }
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          const loadedShops = (data.shops || []) as ShopConfig[];
          setJobs(data.jobs || []);
          setShops(loadedShops);
          setStats(data.stats || null);

          const targetEditId =
            editingShopId && loadedShops.some((s) => s.id === editingShopId)
              ? editingShopId
              : loadedShops[0]?.id || '';
          setEditingShopId(targetEditId);
          const editTarget = loadedShops.find((s) => s.id === targetEditId);
          if (editTarget) {
            setSettings(editTarget.settings);
          }
        }
        if (intRes.ok) {
          const iData = (await intRes.json()) as IntegrationStatus;
          setIntegrations(iData);
        }
      } catch {
        // Ignore transient network error
      }
    },
    [selectedShopId, editingShopId]
  );

  useEffect(() => {
    void fetchAuthStatus(token);
  }, [fetchAuthStatus, token]);

  useEffect(() => {
    if (token && authStatus?.authenticated) {
      void fetchAdminData(token, selectedShopId);
    }
  }, [token, authStatus?.authenticated, liveEventCounter, selectedShopId, fetchAdminData]);

  // Generate QR codes for shops when viewing Multi-Shop or Clients tab
  useEffect(() => {
    if ((activeSubTab !== 'shops' && activeSubTab !== 'clients') || shops.length === 0) return;
    void (async () => {
      const nextMap: Record<string, { counter: string; wa: string }> = {};
      for (const s of shops) {
        const counterUrl = `${window.location.origin}/?shop=${encodeURIComponent(s.slug)}&kiosk=1`;
        const waNum = s.settings.whatsapp.businessNumber.replace(/[^0-9]/g, '');
        const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(
          `Hi, I want to print at ${s.settings.shopName}`
        )}`;
        try {
          const [cUrl, wUrl] = await Promise.all([
            generateQrDataUrl(counterUrl),
            generateQrDataUrl(waUrl),
          ]);
          nextMap[s.id] = { counter: cUrl || '', wa: wUrl || '' };
        } catch {
          nextMap[s.id] = { counter: '', wa: '' };
        }
      }
      setShopQrMap(nextMap);
    })();
  }, [activeSubTab, shops]);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const endpoint = authStatus?.configured ? '/api/auth/login' : '/api/auth/setup';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }
      setToken(data.token);
      setPasscodeInput('');
      setAuthStatus({
        configured: true,
        envControlled: Boolean(authStatus?.envControlled),
        authenticated: true,
      });
      await fetchAdminData(data.token);
    } catch {
      setAuthError('Unable to reach server.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateShop(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setShopError('');
    setCreatingShop(true);
    try {
      const res = await fetch('/api/admin/shops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shopName: newShopName,
          shopAddress: newShopAddress,
          upiId: newShopUpiId,
          upiPayeeName: newShopPayee || newShopName,
          whatsappNumber: newShopWa,
          bwPerPage: Number(newShopBwRate) || 2,
          colorPerPage: Number(newShopColorRate) || 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShopError(data.error || 'Could not create shop');
        return;
      }
      setNewShopName('');
      setNewShopAddress('');
      setNewShopUpiId('');
      setNewShopPayee('');
      setNewShopWa('+91');
      onSettingsUpdated();
      await fetchAdminData(token, selectedShopId);
    } finally {
      setCreatingShop(false);
    }
  }

  async function handleToggleShop(shopId: string) {
    if (!token) return;
    const res = await fetch(`/api/admin/shops/${shopId}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      onSettingsUpdated();
      await fetchAdminData(token, selectedShopId);
    }
  }

  async function handleDeleteShop(shopId: string) {
    if (!token) return;
    const res = await fetch(`/api/admin/shops/${shopId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      if (editingShopId === shopId) setEditingShopId('');
      if (selectedShopId === shopId) setSelectedShopId('all');
      onSettingsUpdated();
      await fetchAdminData(token, 'all');
    }
  }

  async function handleRotateAgentKey(shopId: string) {
    if (!token) return;
    const res = await fetch(`/api/admin/shops/${shopId}/rotate-agent-key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await fetchAdminData(token, selectedShopId);
    }
  }

  async function handleJobAction(
    jobId: string,
    action: 'mark_paid' | 'print_now' | 'mark_completed' | 'cancel' | 'reprint'
  ) {
    if (!token) return;
    await fetch(`/api/admin/jobs/${jobId}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action }),
    });
    await fetchAdminData(token, selectedShopId);
  }

  async function handleDeleteJob(jobId: string) {
    if (!token) return;
    await fetch(`/api/admin/jobs/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchAdminData(token, selectedShopId);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !settings || !editingShopId) return;
    setSavingSettings(true);
    setSaveNotice('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...settings, shopId: editingShopId }),
      });
      if (res.ok) {
        setSaveNotice(t.settingsSaved);
        onSettingsUpdated();
        await fetchAdminData(token, selectedShopId);
      }
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleChangePasscode() {
    if (!token || newPasscodeInput.trim().length < 4) return;
    const res = await fetch('/api/auth/change-passcode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newPasscode: newPasscodeInput.trim() }),
    });
    if (res.ok) {
      setNewPasscodeInput('');
      setSaveNotice(lang === 'hi' ? 'एडमिन पासकोड अपडेट हो गया।' : 'Admin passcode updated.');
    }
  }

  async function downloadProtectedFile(endpoint: string, fallbackName: string) {
    if (!token) return;
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : fallbackName;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function triggerBrowserPrint(jobId: string) {
    const frame = printFrameRef.current;
    if (!frame) return;
    frame.src = `/api/jobs/${jobId}/file`;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.print();
      }
    };
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(''), 2000);
  }

  if (!authStatus) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!token || !authStatus.authenticated) {
    const isFirstRun = !authStatus.configured && !authStatus.envControlled;
    return (
      <div className="max-w-md mx-auto py-8">
        <form
          onSubmit={handleAuthSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              {isFirstRun ? <KeyRound className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {isFirstRun ? t.adminSetupTitle : t.adminAuthTitle}
              </h1>
              <p className="text-xs text-slate-500">
                {isFirstRun
                  ? lang === 'hi'
                    ? 'पहली बार एडमिन पैनल सुरक्षित करने के लिए एक पासकोड चुनें।'
                    : 'Claim your shop Admin Panel by choosing an access passcode.'
                  : lang === 'hi'
                  ? 'प्रिंट कतार, मल्टी-शॉप व बिजनेस सेटिंग्स खोलने के लिए लॉगिन करें।'
                  : 'Sign in to manage branches, printers, rates & clients.'}
              </p>
            </div>
          </div>

          {authError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
              {authError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.adminPasscodeLabel}
            </label>
            <input
              type="password"
              required
              minLength={4}
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder={isFirstRun ? 'Min 4 characters' : 'Enter passcode'}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {authLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{isFirstRun ? t.adminSetupBtn : t.adminLoginBtn}</span>
          </button>
        </form>
      </div>
    );
  }

  const filteredJobs = filterAndSortJobs(jobs, {
    statusFilter: filterStatus,
    fileTypeFilter: filterFileType,
    sortBy,
    searchQuery,
  });

  const editingShop = shops.find((s) => s.id === editingShopId) || shops[0] || null;

  return (
    <div className="space-y-6">
      <iframe ref={printFrameRef} title="admin-print-sheet" className="hidden" />

      {/* Top Admin Header & Sub-Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {lang === 'hi' ? 'एडमिन कंट्रोल पैनल' : 'Business Admin Console'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {shops.length} {lang === 'hi' ? 'शॉप / ब्रांच सक्रिय' : 'Active Branches'} ·{' '}
            {lang === 'hi'
              ? 'मल्टी-शॉप, अलग UPI व WhatsApp, और Windows/Android क्लाइंट्स'
              : 'Multi-shop UPI, WhatsApp & Client Installers'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {(['queue', 'stats', 'shops', 'settings', 'clients', 'integrations'] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveSubTab(tabKey)}
                className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSubTab === tabKey
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.adminTabs[tabKey]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setToken('');
              setAuthStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
            }}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t.adminSignOut}</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Queue & Spooler */}
      {activeSubTab === 'queue' && (
        <div className="space-y-6">
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  {lang === 'hi' ? 'कुल आय (Paid)' : 'Verified Revenue'}
                </p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  ₹{stats.totalRevenue.toFixed(2)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  {lang === 'hi' ? 'कुल प्रिंट जॉब्स' : 'Total Jobs'}
                </p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {stats.totalJobs}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  {lang === 'hi' ? 'प्रिंट हुए पेज' : 'Pages Printed'}
                </p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {stats.totalPagesPrinted}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  {lang === 'hi' ? 'वाट्सअप ऑर्डर्स' : 'WhatsApp Orders'}
                </p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                  {stats.whatsappJobs}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900"
                >
                  <option value="all">{lang === 'hi' ? 'सभी शॉप्स' : 'All Shops'}</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.settings.shopName}
                    </option>
                  ))}
                </select>

                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
                  {([
                    { id: 'all', label: lang === 'hi' ? 'सभी' : 'All' },
                    { id: 'pending', label: lang === 'hi' ? 'पेंडिंग' : 'Pending' },
                    { id: 'printing', label: lang === 'hi' ? 'प्रिंटिंग' : 'Printing' },
                    { id: 'completed', label: lang === 'hi' ? 'पूर्ण' : 'Completed' },
                    { id: 'whatsapp', label: 'WhatsApp' },
                  ] as const).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilterStatus(f.id)}
                      className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        filterStatus === f.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
                  {([
                    { id: 'all', label: lang === 'hi' ? 'सभी फाइलें' : 'All Files' },
                    { id: 'pdf', label: 'PDF' },
                    { id: 'image', label: lang === 'hi' ? 'इमेज' : 'Image' },
                    { id: 'word', label: 'Word' },
                  ] as const).map((ft) => (
                    <button
                      key={ft.id}
                      type="button"
                      onClick={() => setFilterFileType(ft.id)}
                      className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        filterFileType === ft.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {ft.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as JobSortBy)}
                  aria-label={lang === 'hi' ? 'क्रमबद्ध करें' : 'Sort Print Jobs'}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900"
                >
                  <option value="newest">{lang === 'hi' ? 'नवीनतम पहले' : 'Sort: Newest'}</option>
                  <option value="status">{lang === 'hi' ? 'स्थिति (Pending → Completed)' : 'Sort: Status'}</option>
                  <option value="fileType">{lang === 'hi' ? 'फाइल प्रकार (PDF → Image → Word)' : 'Sort: File Type'}</option>
                </select>
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={lang === 'hi' ? 'कोड, शॉप, फाइल खोजें' : 'Search code, shop, file'}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void fetchAdminData(token, selectedShopId)}
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                  aria-label="Refresh Queue"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">{t.emptyQueue}</div>
            ) : filteredJobs.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm text-slate-500">
                  {lang === 'hi'
                    ? 'चुने गए फ़िल्टर में कोई प्रिंट जॉब नहीं मिली।'
                    : 'No print jobs match your selected filters.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterFileType('all');
                    setSortBy('newest');
                    setSearchQuery('');
                  }}
                  className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  {lang === 'hi' ? 'फ़िल्टर रीसेट करें' : 'Reset Filters'}
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                      <th className="py-2.5 pr-3">Code / Shop</th>
                      <th className="py-2.5 pr-3">Customer / Source</th>
                      <th className="py-2.5 pr-3">Document &amp; Specs</th>
                      <th className="py-2.5 pr-3 text-right">Amount</th>
                      <th className="py-2.5 pr-3">Status</th>
                      <th className="py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredJobs.map((job) => {
                      const cat = getJobFileCategory(job);
                      const catLabel =
                        cat === 'pdf'
                          ? 'PDF'
                          : cat === 'image'
                          ? 'Image'
                          : cat === 'word'
                          ? 'Word'
                          : job.fileExtension.replace('.', '').toUpperCase() || 'File';
                      return (
                      <tr key={job.id} className="hover:bg-slate-50/80">
                        <td className="py-3 pr-3 whitespace-nowrap">
                          <div className="font-mono font-bold tabular-nums text-slate-900">
                            {job.code} · PIN {job.pin}
                          </div>
                          <div className="text-[11px] text-blue-700 font-medium">{job.shopName}</div>
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          <div className="font-medium text-slate-900">{job.customerName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {job.source} {job.customerPhone ? `· ${job.customerPhone}` : ''}
                          </div>
                        </td>
                        <td className="py-3 pr-3 max-w-[230px]">
                          <div className="font-medium text-slate-900 truncate">{job.originalFilename}</div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {catLabel} · {job.options.colorMode === 'color' ? 'Color' : 'B&W'} · {job.options.paperSize} ·{' '}
                            {job.options.sides} · {job.printablePages}p × {job.options.copies}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            ₹{job.pricingBreakdown.totalAmount.toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {job.paymentStatus === 'paid' ? `Paid (${job.utrNumber || 'UPI'})` : 'Unpaid'}
                          </div>
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              job.printStatus === 'completed'
                                ? 'text-emerald-700'
                                : job.printStatus === 'printing'
                                ? 'text-blue-700'
                                : job.printStatus === 'cancelled'
                                ? 'text-red-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {getStatusLabel(job.printStatus, lang)}
                          </span>
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {job.paymentStatus !== 'paid' && job.printStatus !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => void handleJobAction(job.id, 'mark_paid')}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                              >
                                Mark Paid
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleJobAction(job.id, 'print_now')}
                              className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 cursor-pointer"
                            >
                              Auto-Print
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerBrowserPrint(job.id)}
                              className="rounded border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100 cursor-pointer"
                              title="Browser Print"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={`/api/jobs/${job.id}/file?download=1`}
                              className="rounded border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            {job.printStatus !== 'cancelled' && job.printStatus !== 'completed' && (
                              <button
                                type="button"
                                onClick={() => void handleJobAction(job.id, 'cancel')}
                                className="rounded border border-slate-200 bg-white p-1.5 text-amber-700 hover:bg-amber-50 cursor-pointer"
                                title="Cancel"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDeleteJob(job.id)}
                              className="rounded border border-slate-200 bg-white p-1.5 text-red-700 hover:bg-red-50 cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Analytics & Stats (Recharts) */}
      {activeSubTab === 'stats' && (
        <Suspense
          fallback={
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          }
        >
          <AdminStatsView
            lang={lang}
            token={token}
            shops={shops}
            liveEventCounter={liveEventCounter}
          />
        </Suspense>
      )}

      {/* Tab 3: Admin-Only Multi-Shop Manager */}
      {activeSubTab === 'shops' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Add New Shop Form (Admin Only) */}
          <form
            onSubmit={handleCreateShop}
            className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Store className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? 'नई शॉप / ब्रांच जोड़ें (Admin Only)' : 'Add New Shop / Branch (Admin Only)'}
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              {lang === 'hi'
                ? 'हर शॉप का अपना अलग UPI पेमेंट QR, WhatsApp नंबर, रेट कार्ड और प्रिंटर एजेंट होगा।'
                : 'Each branch gets its own UPI payment ID, WhatsApp number, counter QR, and Windows/Android print agent key.'}
            </p>

            {shopError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {shopError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {lang === 'hi' ? 'शॉप का नाम *' : 'Shop Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={newShopName}
                  onChange={(e) => setNewShopName(e.target.value)}
                  placeholder="e.g. PrintFlow College Gate Branch"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {lang === 'hi' ? 'शॉप का पता' : 'Counter Address'}
                </label>
                <input
                  type="text"
                  value={newShopAddress}
                  onChange={(e) => setNewShopAddress(e.target.value)}
                  placeholder="Shop 22, University Road"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Merchant UPI ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={newShopUpiId}
                    onChange={(e) => setNewShopUpiId(e.target.value)}
                    placeholder="branch2@upi"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    UPI Payee Name
                  </label>
                  <input
                    type="text"
                    value={newShopPayee}
                    onChange={(e) => setNewShopPayee(e.target.value)}
                    placeholder="Owner / Shop Name"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  WhatsApp Business Number *
                </label>
                <input
                  type="tel"
                  required
                  value={newShopWa}
                  onChange={(e) => setNewShopWa(e.target.value)}
                  placeholder="+9198XXXXXXXX"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">B&W Rate (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={newShopBwRate}
                    onChange={(e) => setNewShopBwRate(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Color Rate (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={newShopColorRate}
                    onChange={(e) => setNewShopColorRate(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={creatingShop}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {creatingShop ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>{lang === 'hi' ? 'नई शॉप जोड़ें' : 'Create Shop Branch'}</span>
            </button>
          </form>

          {/* Right: Existing Shops with Individual QRs, UPI & WhatsApp Info */}
          <div className="lg:col-span-7 space-y-4">
            {shops.map((shop) => {
              const counterUrl =
                typeof window !== 'undefined'
                  ? `${window.location.origin}/?shop=${encodeURIComponent(shop.slug)}&kiosk=1`
                  : '';
              const qrSet = shopQrMap[shop.id];
              return (
                <div
                  key={shop.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono">{shop.slug}</span>
                        <span aria-hidden="true">·</span>
                        <span className={shop.active ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                          {shop.active ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-0.5">
                        {shop.settings.shopName}
                      </h3>
                      <p className="text-xs text-slate-500">{shop.settings.shopAddress}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingShopId(shop.id);
                          setSettings(shop.settings);
                          setActiveSubTab('settings');
                        }}
                        className="min-h-[36px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                      >
                        {lang === 'hi' ? 'सेटिंग्स बदलें' : 'Edit Settings'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleShop(shop.id)}
                        className="min-h-[36px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {shop.active ? 'Pause' : 'Activate'}
                      </button>
                      {shops.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteShop(shop.id)}
                          className="min-h-[36px] rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
                          title="Delete Shop"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                    <div className="sm:col-span-2 space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">UPI Payment ID</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {shop.settings.payment.upiId}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">WhatsApp Number</span>
                        <span className="font-mono font-semibold text-emerald-700">
                          {shop.settings.whatsapp.businessNumber}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Rates (B&W / Color)</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          ₹{shop.settings.pricing.bwPerPage} / ₹{shop.settings.pricing.colorPerPage}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-slate-500 truncate font-mono text-[11px]">
                          {counterUrl}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(counterUrl)}
                          className="inline-flex items-center gap-1 text-blue-700 font-semibold shrink-0 cursor-pointer"
                        >
                          {copiedUrl === counterUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>Copy URL</span>
                        </button>
                      </div>
                    </div>

                    {/* Shop Counter QR + WhatsApp QR thumbnails */}
                    <div className="flex items-center justify-center gap-3">
                      <div className="text-center">
                        {qrSet?.counter ? (
                          <img
                            src={qrSet.counter}
                            alt={`${shop.settings.shopName} Counter QR`}
                            className="w-20 h-20 rounded-lg border border-slate-200 p-1 bg-white"
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                            <QrCode className="w-5 h-5 text-slate-400" />
                          </div>
                        )}
                        <span className="block text-[10px] text-slate-500 mt-1">Counter QR</span>
                      </div>
                      <div className="text-center">
                        {qrSet?.wa ? (
                          <img
                            src={qrSet.wa}
                            alt={`${shop.settings.shopName} WhatsApp QR`}
                            className="w-20 h-20 rounded-lg border border-slate-200 p-1 bg-white"
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                            <QrCode className="w-5 h-5 text-slate-400" />
                          </div>
                        )}
                        <span className="block text-[10px] text-slate-500 mt-1">WhatsApp QR</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Per-Shop Business Settings */}
      {activeSubTab === 'settings' && settings && editingShop && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-slate-700">
                {lang === 'hi' ? 'सेटिंग्स चुनें (किस शॉप के लिए):' : 'Editing Settings For Shop:'}
              </span>
            </div>
            <select
              value={editingShop.id}
              onChange={(e) => {
                const nextId = e.target.value;
                setEditingShopId(nextId);
                const found = shops.find((s) => s.id === nextId);
                if (found) setSettings(found.settings);
                setSaveNotice('');
              }}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.settings.shopName} ({s.slug})
                </option>
              ))}
            </select>
          </div>

          {saveNotice && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{saveNotice}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Shop Profile */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? '1. शॉप प्रोफाइल' : '1. Shop Profile'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Shop Name</label>
                  <input
                    type="text"
                    value={settings.shopName}
                    onChange={(e) => setSettings({ ...settings, shopName: e.target.value })}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tagline</label>
                  <input
                    type="text"
                    value={settings.shopTagline}
                    onChange={(e) => setSettings({ ...settings, shopTagline: e.target.value })}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Counter Address</label>
                    <input
                      type="text"
                      value={settings.shopAddress}
                      onChange={(e) => setSettings({ ...settings, shopAddress: e.target.value })}
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">GSTIN (Optional)</label>
                    <input
                      type="text"
                      value={settings.gstNumber}
                      onChange={(e) => setSettings({ ...settings, gstNumber: e.target.value })}
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Matrix */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? '2. प्रिंटिंग रेट सेटिंग्स (₹)' : '2. Pricing Matrix (INR)'}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">B&W / page (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={settings.pricing.bwPerPage}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: { ...settings.pricing, bwPerPage: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Color / page (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={settings.pricing.colorPerPage}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: { ...settings.pricing, colorPerPage: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Duplex Discount %</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={settings.pricing.duplexDiscountPercent}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: { ...settings.pricing, duplexDiscountPercent: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">A3 Multiplier (×)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={settings.pricing.a3Multiplier}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: { ...settings.pricing, a3Multiplier: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Photo 4×6 (₹)</label>
                  <input
                    type="number"
                    min="1"
                    value={settings.pricing.photo4x6Rate}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: { ...settings.pricing, photo4x6Rate: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Min Order (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={settings.pricing.minOrderAmount}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: { ...settings.pricing, minOrderAmount: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* UPI & Auto-Print */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? '3. इस शॉप की UPI पेमेंट सेटिंग्स' : '3. Shop Payment & Auto-Print'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Merchant UPI ID</label>
                  <input
                    type="text"
                    value={settings.payment.upiId}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        payment: { ...settings.payment, upiId: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">UPI Payee Name</label>
                  <input
                    type="text"
                    value={settings.payment.upiPayeeName}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        payment: { ...settings.payment, upiPayeeName: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2.5 pt-2">
                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.payment.autoPrintOnPayment}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        payment: { ...settings.payment, autoPrintOnPayment: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    {lang === 'hi'
                      ? 'पेमेंट होते ही ऑटो-प्रिंट शुरू करें'
                      : 'Auto-print immediately after payment'}
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.payment.sandboxInstantPayEnabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        payment: { ...settings.payment, sandboxInstantPayEnabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    {lang === 'hi'
                      ? 'टेस्टिंग सैंडबॉक्स पेमेंट बटन सक्षम करें'
                      : 'Enable Sandbox Instant Pay button'}
                  </span>
                </label>
              </div>
            </div>

            {/* Printer Hardware & Spooler */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? '4. प्रिंटर हार्डवेयर व Windows एजेंट मोड' : '4. Printer Hardware & Bridge'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">B&W Printer</label>
                  <input
                    type="text"
                    value={settings.printers.bwPrinterName}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printers: { ...settings.printers, bwPrinterName: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Color Printer</label>
                  <input
                    type="text"
                    value={settings.printers.colorPrinterName}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printers: { ...settings.printers, colorPrinterName: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Photo Printer</label>
                  <input
                    type="text"
                    value={settings.printers.photoPrinterName}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printers: { ...settings.printers, photoPrinterName: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Paper Tray Sheets</label>
                  <input
                    type="number"
                    min="0"
                    value={settings.printers.paperTrayRemaining}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printers: { ...settings.printers, paperTrayRemaining: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Spooler Bridge Mode</label>
                  <select
                    value={settings.printers.bridgeMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printers: {
                          ...settings.printers,
                          bridgeMode: e.target.value as BusinessSettings['printers']['bridgeMode'],
                        },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm bg-white"
                  >
                    <option value="browser_auto">Browser / Kiosk Auto-Print</option>
                    <option value="local_agent">Windows / Android Print Agent (Queued)</option>
                    <option value="ipp_network">IPP / CUPS Network Printer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">IPP Endpoint</label>
                  <input
                    type="text"
                    value={settings.printers.ippEndpoint}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printers: { ...settings.printers, ippEndpoint: e.target.value },
                      })
                    }
                    placeholder="http://192.168.1.50:631/ipp/print"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            {/* WhatsApp Bot Config */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? '5. इस शॉप का वाट्सअप नंबर व बॉट' : '5. Shop WhatsApp Number & Bot'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    WhatsApp Business Number
                  </label>
                  <input
                    type="text"
                    value={settings.whatsapp.businessNumber}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whatsapp: { ...settings.whatsapp, businessNumber: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Default Color Mode
                  </label>
                  <select
                    value={settings.whatsapp.defaultColorMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whatsapp: {
                          ...settings.whatsapp,
                          defaultColorMode: e.target.value === 'color' ? 'color' : 'bw',
                        },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm bg-white"
                  >
                    <option value="bw">Black & White</option>
                    <option value="color">Full Color</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Auto-Reply Welcome Message
                </label>
                <textarea
                  rows={2}
                  value={settings.whatsapp.welcomeMessage}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      whatsapp: { ...settings.whatsapp, welcomeMessage: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.whatsapp.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whatsapp: { ...settings.whatsapp, enabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Enable WhatsApp Print</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.whatsapp.autoReplyOnUpload}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whatsapp: { ...settings.whatsapp, autoReplyOnUpload: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Auto-Reply Payment Link</span>
                </label>
              </div>
            </div>

            {/* Supported Formats & Admin Passcode */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? '6. फाइल फॉर्मेट और सुरक्षा' : '6. File Formats & Security'}
              </h2>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">
                  Allowed Extensions
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_EXTENSIONS.map((ext) => {
                    const active = settings.formats.allowedExtensions.includes(ext);
                    return (
                      <button
                        key={ext}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? settings.formats.allowedExtensions.filter((x) => x !== ext)
                            : [...settings.formats.allowedExtensions, ext];
                          if (next.length > 0) {
                            setSettings({
                              ...settings,
                              formats: { ...settings.formats, allowedExtensions: next },
                            });
                          }
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-mono font-medium cursor-pointer transition-colors ${
                          active
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}
                      >
                        {ext}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Max Size (MB)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={settings.formats.maxFileSizeMb}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        formats: { ...settings.formats, maxFileSizeMb: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Auto-Delete (Hrs)</label>
                  <input
                    type="number"
                    min="1"
                    value={settings.formats.autoDeleteHours}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        formats: { ...settings.formats, autoDeleteHours: Number(e.target.value) },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>

              {!authStatus.envControlled && (
                <div className="pt-3 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    Update Admin Passcode
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={newPasscodeInput}
                      onChange={(e) => setNewPasscodeInput(e.target.value)}
                      placeholder="New passcode (min 4 chars)"
                      className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleChangePasscode()}
                      className="min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                    >
                      Update
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 7. Loyalty Points & Earn Rate */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-600" />
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {lang === 'hi' ? '7. लॉयल्टी पॉइंट्स व अर्न रेट सेटिंग्स' : '7. Loyalty Points & Earn Rate'}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {lang === 'hi'
                        ? 'ग्राहकों को प्रत्येक पूर्ण प्रिंट जॉब पर कितने लॉयल्टी पॉइंट्स मिलें, यहाँ सेट करें।'
                        : 'Configure how customers earn loyalty points for each completed print job at this shop.'}
                    </p>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.loyalty.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        loyalty: { ...settings.loyalty, enabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    {lang === 'hi' ? 'लॉयल्टी पॉइंट्स चालू करें' : 'Enable Loyalty Points'}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {lang === 'hi' ? 'अर्न करने का आधार (Earn Basis)' : 'Earn Basis'}
                  </label>
                  <select
                    value={settings.loyalty.earnMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        loyalty: {
                          ...settings.loyalty,
                          earnMode: e.target.value as BusinessSettings['loyalty']['earnMode'],
                        },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="per_rupee">
                      {lang === 'hi' ? 'प्रति ₹1 खर्च पर पॉइंट्स' : 'Points per ₹1 spent'}
                    </option>
                    <option value="per_page">
                      {lang === 'hi' ? 'प्रति प्रिंट पेज पर पॉइंट्स' : 'Points per printed page'}
                    </option>
                    <option value="per_job">
                      {lang === 'hi' ? 'प्रति प्रिंट जॉब निश्चित पॉइंट्स' : 'Fixed points per printed job'}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {lang === 'hi' ? 'अर्न रेट (Points Rate)' : 'Earn Rate (Points)'}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="1000"
                    value={settings.loyalty.earnRate}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        loyalty: {
                          ...settings.loyalty,
                          earnRate: Math.max(0, Number(e.target.value) || 0),
                        },
                      })
                    }
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums text-slate-900"
                  />
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
                  <span className="block text-[11px] text-amber-700 font-medium">
                    {lang === 'hi' ? 'उदाहरण प्रीव्यू (10 पेज, ₹50 ऑर्डर)' : 'Live Preview (10 pages, ₹50 order)'}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-sm">
                    {!settings.loyalty.enabled || settings.loyalty.earnRate <= 0
                      ? '0 pts'
                      : settings.loyalty.earnMode === 'per_page'
                      ? `+${Math.max(1, Math.floor(10 * settings.loyalty.earnRate))} pts`
                      : settings.loyalty.earnMode === 'per_job'
                      ? `+${Math.max(1, Math.floor(settings.loyalty.earnRate))} pts`
                      : `+${Math.max(1, Math.floor(50 * settings.loyalty.earnRate))} pts`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{t.saveSettings}</span>
            </button>
          </div>
        </form>
      )}

      {/* Tab 4: Windows Installation Client & Android Client App */}
      {activeSubTab === 'clients' && editingShop && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-slate-700">
                {lang === 'hi' ? 'क्लाइंट ऐप जेनरेट करें (शॉप चुनें):' : 'Configure Client Installers For Shop:'}
              </span>
            </div>
            <select
              value={editingShop.id}
              onChange={(e) => setEditingShopId(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.settings.shopName} ({s.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Windows 10/11 Print Agent Installer */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {lang === 'hi'
                      ? 'Windows 10/11 ऑटो-प्रिंट क्लाइंट व इंस्टॉलर'
                      : 'Windows 10/11 Auto-Print Client & Installer'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {editingShop.settings.shopName} · Silent USB &amp; Network Printer Spooler
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                {lang === 'hi'
                  ? 'यह इंस्टॉलर स्क्रिप्ट इस शॉप के लिए पहले से कॉन्फ़िगर है। इसे अपने Windows काउंटर PC पर चलाएं—पेमेंट होते ही PDF और फोटो अपने आप संबंधित B&W या Color प्रिंटर से प्रिंट हो जाएंगे।'
                  : 'Pre-configured PowerShell setup & silent print agent for this branch. Run it on your shop Windows counter PC to auto-print paid jobs to your local B&W or Color printers.'}
              </p>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Shop ID</span>
                  <span className="font-mono font-semibold text-slate-900">{editingShop.id}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Agent Key</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-800 truncate max-w-[160px]">
                      {editingShop.agentKey}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(editingShop.agentKey)}
                      className="text-blue-700 font-semibold cursor-pointer"
                    >
                      {copiedUrl === editingShop.agentKey ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRotateAgentKey(editingShop.id)}
                      className="text-slate-600 hover:text-slate-900 cursor-pointer"
                      title="Rotate Agent Key"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
                <li>
                  {lang === 'hi'
                    ? 'नीचे से Windows Setup (.ps1) फ़ाइल डाउनलोड करें।'
                    : 'Download the pre-configured Windows Setup (.ps1) file below.'}
                </li>
                <li>
                  {lang === 'hi'
                    ? 'फाइल पर Right-Click करके "Run with PowerShell" चुनें।'
                    : 'Right-click the file on your Windows PC and click "Run with PowerShell".'}
                </li>
                <li>
                  {lang === 'hi'
                    ? 'Shop Settings में Bridge Mode को "Windows / Android Print Agent" पर सेट करें।'
                    : 'In Shop Settings, set Bridge Mode to "Windows / Android Print Agent".'}
                </li>
              </ol>

              <button
                type="button"
                onClick={() =>
                  void downloadProtectedFile(
                    `/api/admin/clients/windows?shopId=${encodeURIComponent(editingShop.id)}`,
                    `PrintFlow-${editingShop.slug}-Windows-Setup.ps1`
                  )
                }
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  {lang === 'hi'
                    ? `Windows Setup (.ps1) डाउनलोड करें — ${editingShop.slug}`
                    : `Download Windows Installer (.ps1) — ${editingShop.slug}`}
                </span>
              </button>
            </div>

            {/* Android Client App (Instant WebAPK + Native Kotlin Source) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {lang === 'hi'
                      ? 'Android क्लाइंट ऐप व APK प्रोजेक्ट'
                      : 'Android Client App & APK Source'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    UPI App Launch + File Upload + Android PrintManager
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                {shopQrMap[editingShop.id]?.counter ? (
                  <img
                    src={shopQrMap[editingShop.id].counter}
                    alt="Android App Install QR"
                    className="w-28 h-28 rounded-lg border border-slate-200 p-1 bg-white shrink-0"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-lg border border-slate-200 bg-white shrink-0" />
                )}
                <div className="space-y-1.5 text-center sm:text-left">
                  <p className="text-xs font-semibold text-slate-900">
                    {lang === 'hi'
                      ? 'तुरंत Android App इंस्टॉल (QR स्कैन करें)'
                      : 'Instant Android App Install (Scan QR)'}
                  </p>
                  <p className="text-xs text-slate-600">
                    {lang === 'hi'
                      ? 'Android Chrome में यह QR खोलकर "Install Mobile App" दबाते ही बिना Play Store के ऐप फोन में इंस्टॉल हो जाता है।'
                      : 'Scan on any Android phone and tap "Install Mobile App" to install this branch as a standalone Android app.'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-700">
                  {lang === 'hi'
                    ? 'Android Studio APK बिल्ड फ़ाइलें डाउनलोड करें:'
                    : 'Download Pre-Configured Android Studio Kotlin Files (for APK build):'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void downloadProtectedFile(
                        `/api/admin/clients/android?shopId=${encodeURIComponent(editingShop.id)}&file=activity`,
                        `MainActivity-${editingShop.slug}.kt`
                      )
                    }
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>MainActivity.kt</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void downloadProtectedFile(
                        `/api/admin/clients/android?shopId=${encodeURIComponent(editingShop.id)}&file=manifest`,
                        'AndroidManifest.xml'
                      )
                    }
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Manifest.xml</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void downloadProtectedFile(
                        `/api/admin/clients/android?shopId=${encodeURIComponent(editingShop.id)}&file=gradle`,
                        'build.gradle.kts'
                      )
                    }
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>build.gradle.kts</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: WhatsApp Cloud API, Webhooks & PHP Hosting Installer */}
      {activeSubTab === 'integrations' && integrations && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-900">
                Meta WhatsApp Business Cloud API
              </h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {lang === 'hi'
                ? 'रियल वाट्सअप मैसेज रिसीव करने के लिए Meta Developer Console में नीचे दिया Webhook URL और Verify Token डालें। सिस्टम रिसीव होने वाले नंबर के आधार पर सही शॉप अपने आप चुन लेता है।'
                : 'Paste this Webhook URL into Meta WhatsApp Developer Console. Incoming messages automatically route to the matching shop branch.'}
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600">WhatsApp Webhook Callback URL</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={integrations.webhookUrl}
                  className="flex-1 min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-mono text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => copyText(integrations.webhookUrl)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  {copiedUrl === integrations.webhookUrl ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <div className="pt-2 divide-y divide-slate-100 text-xs">
              <div className="py-2.5 flex items-center justify-between">
                <span className="font-mono text-slate-700">WHATSAPP_VERIFY_TOKEN</span>
                <span className={integrations.whatsappVerifySet ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                  {integrations.whatsappVerifySet ? 'Configured' : 'Not set in Secrets'}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="font-mono text-slate-700">WHATSAPP_ACCESS_TOKEN</span>
                <span className={integrations.whatsappTokenSet ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                  {integrations.whatsappTokenSet ? 'Configured' : 'Not set in Secrets'}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="font-mono text-slate-700">WHATSAPP_PHONE_NUMBER_ID</span>
                <span className={integrations.whatsappPhoneIdSet ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                  {integrations.whatsappPhoneIdSet ? 'Configured' : 'Not set in Secrets'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              UPI / Payment Gateway Auto-Print Webhook
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              {lang === 'hi'
                ? 'Razorpay, Cashfree या PhonePe Business के पेमेंट सफल होते ही ऑटोमैटिक प्रिंट शुरू करने के लिए इस Webhook का उपयोग करें।'
                : 'Connect Razorpay, Cashfree, or your UPI gateway webhook to mark jobs Paid and trigger auto-printing instantaneously.'}
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600">Payment Webhook Endpoint</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={integrations.paymentWebhookUrl}
                  className="flex-1 min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-mono text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => copyText(integrations.paymentWebhookUrl)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  {copiedUrl === integrations.paymentWebhookUrl ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <div className="pt-2 divide-y divide-slate-100 text-xs">
              <div className="py-2.5 flex items-center justify-between">
                <span className="font-mono text-slate-700">PAYMENT_WEBHOOK_SECRET</span>
                <span className={integrations.paymentSecretSet ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                  {integrations.paymentSecretSet ? 'Configured' : 'Not set in Secrets'}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="font-mono text-slate-700">ADMIN_PASSCODE (Env Override)</span>
                <span className={integrations.adminEnvOverride ? 'text-emerald-700 font-semibold' : 'text-slate-500 font-medium'}>
                  {integrations.adminEnvOverride ? 'Active from Env' : 'Managed via Admin Claim'}
                </span>
              </div>
            </div>
          </div>

          {/* cPanel Hosting Package & PHP Installer Card */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <h2 className="text-base font-semibold text-slate-900">
                  {lang === 'hi'
                    ? 'cPanel होस्टिंग पैकेज (PHP Shared Hosting व Node.js App)'
                    : 'cPanel Hosting Deployment (PHP Shared Hosting & Node.js App)'}
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {lang === 'hi'
                    ? 'cPanel पर सीधे चलाने के लिए नीचे से पूरा Ready-to-Upload ZIP पैकेज डाउनलोड करें और File Manager में public_html/ के अंदर Extract करके /install.php खोलें।'
                    : 'Download the complete cPanel public_html ZIP bundle (includes compiled frontend, .htaccess, and full PHP 8+ backend installer). Extract it into public_html/ and visit /install.php.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    void downloadProtectedFile(
                      '/api/admin/cpanel-package',
                      'PrintFlow-cPanel-public_html.zip'
                    )
                  }
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {lang === 'hi'
                      ? 'cPanel ZIP पैकेज डाउनलोड करें'
                      : 'Download cPanel ZIP (public_html)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void downloadProtectedFile('/api/admin/php-installer', 'install.php')}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{lang === 'hi' ? 'केवल install.php' : 'install.php Only'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                <p className="font-semibold text-slate-900">
                  {lang === 'hi'
                    ? 'तरीका 1: Shared PHP Hosting (public_html/)'
                    : 'Option 1: cPanel Shared PHP Hosting (Recommended)'}
                </p>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                  <li>Download &amp; extract <span className="font-mono">PrintFlow-cPanel-public_html.zip</span> into <span className="font-mono">public_html/</span>.</li>
                  <li>Open <span className="font-mono">https://yourdomain.com/install.php</span> to set up MySQL or SQLite + full PHP <span className="font-mono">/api/*</span> backend + <span className="font-mono">.htaccess</span>.</li>
                  <li>Delete <span className="font-mono">install.php</span> after setup completes.</li>
                </ol>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                <p className="font-semibold text-slate-900">
                  {lang === 'hi'
                    ? 'तरीका 2: cPanel Setup Node.js App (Passenger)'
                    : 'Option 2: cPanel Setup Node.js App (Passenger)'}
                </p>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                  <li>Run <span className="font-mono">npm install &amp;&amp; npm run build</span> on the server.</li>
                  <li>Set Application Startup File to <span className="font-mono">app.cjs</span> (Node 18/20/22).</li>
                  <li>Set <span className="font-mono">NODE_ENV=production</span> and restart the Node app in cPanel.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
