import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { copy, getStatusLabel } from '../i18n';
import type {
  ColorMode,
  Language,
  PaperSize,
  PrintJob,
  PrintOrientation,
  PrintSides,
  PublicConfig,
} from '../types';
import { apiUrl } from '../utils/api';
import { generateQrDataUrl } from '../utils/qrHelper';
import { generateJobReceiptPdf } from '../utils/receiptPdf';
import { createSamplePrintPdf } from '../utils/samplePdf';

interface PrintStudioProps {
  lang: Language;
  config: PublicConfig;
  initialJobCode?: string;
  sourceMode: 'web_upload' | 'kiosk_qr';
  liveJobUpdate: PrintJob | null;
}

export const PrintStudio: React.FC<PrintStudioProps> = ({
  lang,
  config,
  initialJobCode,
  sourceMode,
  liveJobUpdate,
}) => {
  const t = copy[lang];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [updatingOptions, setUpdatingOptions] = useState(false);
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [lookupInput, setLookupInput] = useState(initialJobCode || '');

  const [activeJob, setActiveJob] = useState<PrintJob | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [utrInput, setUtrInput] = useState('');

  // Loyalty Points state
  const [loyaltyPhoneInput, setLoyaltyPhoneInput] = useState('');
  const [loyaltyBalance, setLoyaltyBalance] = useState<{
    phone: string;
    points: number;
    totalJobsCompleted: number;
  } | null>(null);
  const [checkingLoyalty, setCheckingLoyalty] = useState(false);
  const [claimPhoneInput, setClaimPhoneInput] = useState('');
  const [claimingLoyalty, setClaimingLoyalty] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState('');
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);

  useEffect(() => {
    if (initialJobCode) {
      void handleLookup(initialJobCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobCode]);

  useEffect(() => {
    if (liveJobUpdate && activeJob && liveJobUpdate.id === activeJob.id) {
      setActiveJob(liveJobUpdate);
    }
  }, [liveJobUpdate, activeJob]);

  async function handleLookup(codeOrPin: string) {
    const trimmed = codeOrPin.trim();
    if (!trimmed) return;
    setErrorMsg('');
    try {
      const res = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(trimmed)}`));
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Job not found');
        return;
      }
      setActiveJob(data.job);
      setQrDataUrl(data.qrDataUrl || (data.job?.upiUri ? await generateQrDataUrl(data.job.upiUri) : ''));
    } catch {
      setErrorMsg(lang === 'hi' ? 'जॉब खोजने में समस्या आई।' : 'Unable to look up job.');
    }
  }

  async function uploadFile(file: File) {
    setErrorMsg('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('shopId', config.shopId);
      form.append('colorMode', 'bw');
      form.append('paperSize', 'A4');
      form.append('sides', 'single');
      form.append('copies', '1');
      form.append('pageRange', 'all');
      form.append('orientation', 'auto');
      form.append('source', sourceMode);
      if (customerName.trim()) form.append('customerName', customerName.trim());
      if (customerPhone.trim()) form.append('customerPhone', customerPhone.trim());

      const res = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Upload failed');
        return;
      }
      setActiveJob(data.job);
      setQrDataUrl(data.qrDataUrl || (data.job?.upiUri ? await generateQrDataUrl(data.job.upiUri) : ''));
      setUtrInput('');
    } catch {
      setErrorMsg(lang === 'hi' ? 'फाइल अपलोड नहीं हो सकी।' : 'Could not upload file.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSampleTest() {
    setUploading(true);
    setErrorMsg('');
    try {
      const pdfFile = await createSamplePrintPdf(config.shopName);
      await uploadFile(pdfFile);
    } catch {
      setErrorMsg('Could not generate sample PDF.');
      setUploading(false);
    }
  }

  async function updateOption(patch: {
    colorMode?: ColorMode;
    paperSize?: PaperSize;
    sides?: PrintSides;
    copies?: number;
    pageRange?: string;
    orientation?: PrintOrientation;
  }) {
    if (!activeJob || activeJob.paymentStatus === 'paid') return;
    setUpdatingOptions(true);
    setErrorMsg('');
    try {
      const res = await fetch(apiUrl(`/api/jobs/${activeJob.id}/options`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...activeJob.options, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Update failed');
        return;
      }
      setActiveJob(data.job);
      setQrDataUrl(data.qrDataUrl || (data.job?.upiUri ? await generateQrDataUrl(data.job.upiUri) : ''));
    } catch {
      setErrorMsg(lang === 'hi' ? 'सेटिंग अपडेट नहीं हो सकी।' : 'Failed to update print options.');
    } finally {
      setUpdatingOptions(false);
    }
  }

  async function handlePayment(mode: 'upi_qr' | 'upi_sandbox') {
    if (!activeJob) return;
    setErrorMsg('');
    if (mode === 'upi_qr' && utrInput.trim().length < 6) {
      setErrorMsg(
        lang === 'hi'
          ? 'कृपया कम से कम 6 अंकों का UPI UTR / रेफरेंस नंबर दर्ज करें।'
          : 'Please enter a valid 6+ digit UPI UTR / Reference number.'
      );
      return;
    }
    setPaying(true);
    try {
      const res = await fetch(apiUrl(`/api/jobs/${activeJob.id}/pay`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, utrNumber: utrInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Payment verification failed');
        return;
      }
      setActiveJob(data.job);
    } catch {
      setErrorMsg(lang === 'hi' ? 'पेमेंट वेरिफाई नहीं हो सका।' : 'Could not confirm payment.');
    } finally {
      setPaying(false);
    }
  }

  async function handleCheckLoyalty(phoneToSearch?: string) {
    const raw = (phoneToSearch ?? loyaltyPhoneInput).trim();
    if (raw.replace(/\D/g, '').length < 6) {
      setLoyaltyError(
        lang === 'hi' ? 'कृपया सही मोबाइल नंबर दर्ज करें।' : 'Enter a valid 6+ digit mobile number.'
      );
      return;
    }
    setCheckingLoyalty(true);
    setLoyaltyError('');
    try {
      const res = await fetch(apiUrl(`/api/loyalty/balance?phone=${encodeURIComponent(raw)}`));
      const data = await res.json();
      if (!res.ok) {
        setLoyaltyError(data.error || 'Unable to check loyalty points.');
        return;
      }
      setLoyaltyBalance({
        phone: data.phone,
        points: data.points || 0,
        totalJobsCompleted: data.totalJobsCompleted || 0,
      });
    } catch {
      setLoyaltyError(lang === 'hi' ? 'पॉइंट्स लोड नहीं हो सके।' : 'Could not check loyalty balance.');
    } finally {
      setCheckingLoyalty(false);
    }
  }

  async function handleClaimLoyalty(e: React.FormEvent) {
    e.preventDefault();
    if (!activeJob) return;
    setLoyaltyError('');
    setClaimingLoyalty(true);
    try {
      const res = await fetch(apiUrl(`/api/jobs/${activeJob.id}/claim-loyalty`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: claimPhoneInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoyaltyError(data.error || 'Could not claim points.');
        return;
      }
      setActiveJob(data.job);
      setLoyaltyBalance({
        phone: claimPhoneInput.trim(),
        points: data.balance || 0,
        totalJobsCompleted: (loyaltyBalance?.totalJobsCompleted || 0) + 1,
      });
      setClaimPhoneInput('');
    } catch {
      setLoyaltyError(lang === 'hi' ? 'पॉइंट्स सेव नहीं हो सके।' : 'Failed to save points.');
    } finally {
      setClaimingLoyalty(false);
    }
  }

  function handlePrintDocument() {
    if (!activeJob) return;
    const isImageOrPdf =
      activeJob.mimeType.startsWith('image/') || activeJob.fileExtension === '.pdf';
    if (isImageOrPdf && printFrameRef.current?.contentWindow) {
      try {
        printFrameRef.current.contentWindow.focus();
        printFrameRef.current.contentWindow.print();
        return;
      } catch {
        // Fallback to standard page print
      }
    }
    window.print();
  }

  async function handleDownloadReceiptPdf() {
    if (!activeJob) return;
    setDownloadingReceipt(true);
    setErrorMsg('');
    try {
      const pdfBytes = await generateJobReceiptPdf(activeJob, config);
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PrintFlow-Receipt-${activeJob.code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErrorMsg(
        lang === 'hi'
          ? 'PDF रसीद तैयार करने में समस्या आई।'
          : 'Could not generate PDF receipt.'
      );
    } finally {
      setDownloadingReceipt(false);
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const isPaid = activeJob?.paymentStatus === 'paid';
  const isImage = activeJob?.mimeType.startsWith('image/');
  const isPdf = activeJob?.fileExtension === '.pdf';

  return (
    <div className="space-y-6">
      {/* Header + Lookup Bar */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-blue-700 mb-1.5">
            {config.shopName} · {config.shopAddress}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            {t.heroTitle}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
            {t.heroSubtitle}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleLookup(lookupInput);
          }}
          className="flex items-center gap-2 w-full lg:w-auto shrink-0"
        >
          <div className="relative flex-1 lg:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder={t.lookupPlaceholder}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t.lookupBtn}
          </button>
        </form>
      </section>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {errorMsg}
        </div>
      )}

      {/* Main 2-Column Workspace */}
      {!activeJob ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Dropzone */}
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {t.customerName}
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={lang === 'hi' ? 'जैसे: राहुल शर्मा' : 'e.g. Rahul Sharma'}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {t.customerPhone}
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+91 98XXXXXXXX"
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 font-mono tabular-nums focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) void uploadFile(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              className={`rounded-xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-300 bg-slate-50/60 hover:border-blue-500 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={config.formats.allowedExtensions.join(',')}
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) void uploadFile(selected);
                }}
              />

              <div className="mx-auto w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-4">
                {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
              </div>
              <p className="text-base font-semibold text-slate-900">
                {uploading ? t.uploading : t.uploadTitle}
              </p>
              <p className="mt-1.5 text-sm text-slate-600">
                {t.uploadSub} · Max {config.formats.maxFileSizeMb} MB
              </p>
              <p className="mt-3 text-xs font-mono text-slate-500">
                {config.formats.allowedExtensions.map((ext) => ext.replace('.', '').toUpperCase()).join(' · ')}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                {lang === 'hi'
                  ? 'तुरंत डेमो देखने के लिए सैंपल डॉक्यूमेंट आज़माएं:'
                  : 'Want to try the complete QR pay & auto-print flow?'}
              </span>
              <button
                type="button"
                disabled={uploading}
                onClick={() => void handleSampleTest()}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <FileText className="w-4 h-4 text-blue-600" />
                <span>{t.sampleBtn}</span>
              </button>
            </div>
          </div>

          {/* Right: Live Rate Card & Supported Printers */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'hi' ? 'प्रिंटिंग दरें (ऑटोमैटिक बिलिंग)' : 'Transparent Per-Page Rates'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {lang === 'hi' ? 'एडमिन पैनल से सभी दरें बदली जा सकती हैं' : 'Live rates synced from Admin settings'}
              </p>
              <div className="mt-4 divide-y divide-slate-100 border-t border-b border-slate-100 text-sm">
                <div className="py-3 flex items-center justify-between">
                  <span className="text-slate-700">{t.bwLabel} (A4)</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    ₹{config.pricing.bwPerPage.toFixed(2)} / page
                  </span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-slate-700">{t.colorLabel} (A4)</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    ₹{config.pricing.colorPerPage.toFixed(2)} / page
                  </span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-slate-700">{t.doubleSide}</span>
                  <span className="font-mono font-semibold tabular-nums text-emerald-700">
                    -{config.pricing.duplexDiscountPercent}%
                  </span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-slate-700">Photo 4×6 Glossy</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    ₹{config.pricing.photo4x6Rate.toFixed(2)} / sheet
                  </span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-slate-700">A3 Large Format</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    {config.pricing.a3Multiplier}× A4 rate
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
                {lang === 'hi' ? 'कनेक्टेड प्रिंटर स्पूलर' : 'Active Printer Routing'}
              </h3>
              <div className="space-y-2.5 text-xs text-slate-600">
                <div className="flex items-center justify-between py-1">
                  <span>{t.bwLabel}</span>
                  <span className="font-mono text-slate-900 truncate max-w-[200px]">
                    {config.printers.bwPrinterName}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span>{t.colorLabel}</span>
                  <span className="font-mono text-slate-900 truncate max-w-[200px]">
                    {config.printers.colorPrinterName}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span>{lang === 'hi' ? 'पेपर ट्रे शेष' : 'Paper Tray'}</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {config.printers.paperTrayRemaining} sheets
                  </span>
                </div>
              </div>
            </div>

            {config.loyalty?.enabled && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <Award className="w-4 h-4 text-amber-600" />
                    <span>{lang === 'hi' ? 'लॉयल्टी पॉइंट्स रिवॉर्ड' : 'Loyalty Rewards'}</span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-amber-700">
                    +{config.loyalty.earnRate}{' '}
                    {config.loyalty.earnMode === 'per_page'
                      ? lang === 'hi'
                        ? 'pts/पेज'
                        : 'pts/page'
                      : config.loyalty.earnMode === 'per_job'
                      ? lang === 'hi'
                        ? 'pts/प्रिंट'
                        : 'pts/job'
                      : lang === 'hi'
                      ? 'pts/₹1'
                      : 'pts/₹1'}
                  </span>
                </div>

                <p className="text-xs text-slate-600">
                  {lang === 'hi'
                    ? 'प्रत्येक प्रिंट जॉब पूरा होने पर पॉइंट्स पाएं। अपना बैलेंस देखने के लिए मोबाइल नंबर डालें:'
                    : 'Earn points automatically on every completed print job. Check your balance by phone:'}
                </p>

                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={loyaltyPhoneInput || customerPhone}
                    onChange={(e) => setLoyaltyPhoneInput(e.target.value)}
                    placeholder="+91 98XXXXXXXX"
                    className="flex-1 min-h-[38px] rounded-lg border border-slate-300 px-3 text-xs font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={checkingLoyalty}
                    onClick={() => void handleCheckLoyalty(loyaltyPhoneInput || customerPhone)}
                    className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {checkingLoyalty
                      ? '...'
                      : lang === 'hi'
                      ? 'बैलेंस देखें'
                      : 'Check Points'}
                  </button>
                </div>

                {loyaltyError && <p className="text-xs text-red-700">{loyaltyError}</p>}

                {loyaltyBalance && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-medium text-slate-700">
                        {lang === 'hi' ? 'उपलब्ध पॉइंट्स' : 'Saved Balance'}
                      </span>
                      <span className="block text-[11px] text-slate-500 font-mono">
                        {loyaltyBalance.totalJobsCompleted}{' '}
                        {lang === 'hi' ? 'प्रिंट पूर्ण' : 'prints completed'}
                      </span>
                    </div>
                    <span className="text-lg font-bold font-mono tabular-nums text-amber-800">
                      {loyaltyBalance.points} pts
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Document Preview & Print Options */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-900">{activeJob.code}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(activeJob.fileSizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {activeJob.detectedPages} {lang === 'hi' ? 'पेज' : 'pages'}
                    </span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900 truncate">
                    {activeJob.originalFilename}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveJob(null);
                    setQrDataUrl('');
                    setErrorMsg('');
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{t.newPrintBtn}</span>
                </button>
              </div>

              {/* Document Preview Window */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                {isImage ? (
                  <img
                    src={apiUrl(`/api/jobs/${activeJob.id}/file`)}
                    alt={activeJob.originalFilename}
                    className="w-full max-h-72 object-contain mx-auto bg-white"
                  />
                ) : isPdf ? (
                  <iframe
                    src={apiUrl(`/api/jobs/${activeJob.id}/file#toolbar=0`)}
                    title={activeJob.originalFilename}
                    className="w-full h-72 bg-white"
                  />
                ) : (
                  <div className="p-8 text-center">
                    <ImageIcon className="w-9 h-9 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-800">{activeJob.originalFilename}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {activeJob.fileExtension.toUpperCase()} · Ready for spooling on {activeJob.assignedPrinter}
                    </p>
                  </div>
                )}
              </div>

              {/* Hidden iframe used for instant browser print dispatch */}
              <iframe
                ref={printFrameRef}
                src={apiUrl(`/api/jobs/${activeJob.id}/file`)}
                title="print-dispatch-frame"
                className="hidden"
              />

              {/* Print Options Controls */}
              <div className="mt-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{t.optionsTitle}</h3>
                  {updatingOptions && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-blue-700">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {lang === 'hi' ? 'अपडेट हो रहा है...' : 'Updating...'}
                    </span>
                  )}
                </div>

                {/* Color Mode */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">{t.colorMode}</label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                    <button
                      type="button"
                      disabled={isPaid}
                      onClick={() => void updateOption({ colorMode: 'bw' })}
                      className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        activeJob.options.colorMode === 'bw'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t.bwLabel} · ₹{config.pricing.bwPerPage}
                    </button>
                    <button
                      type="button"
                      disabled={isPaid}
                      onClick={() => void updateOption({ colorMode: 'color' })}
                      className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        activeJob.options.colorMode === 'color'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t.colorLabel} · ₹{config.pricing.colorPerPage}
                    </button>
                  </div>
                </div>

                {/* Paper Size */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">{t.paperSize}</label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {(['A4', 'A3', 'Letter', 'Legal', 'Photo_4x6'] as PaperSize[]).map((size) => (
                      <button
                        key={size}
                        type="button"
                        disabled={isPaid}
                        onClick={() => void updateOption({ paperSize: size })}
                        className={`min-h-[44px] rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                          activeJob.options.paperSize === size
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {size.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sides & Copies */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-2">{t.sides}</label>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                      <button
                        type="button"
                        disabled={isPaid}
                        onClick={() => void updateOption({ sides: 'single' })}
                        className={`min-h-[44px] rounded-lg px-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                          activeJob.options.sides === 'single'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {t.singleSide}
                      </button>
                      <button
                        type="button"
                        disabled={isPaid}
                        onClick={() => void updateOption({ sides: 'double' })}
                        className={`min-h-[44px] rounded-lg px-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                          activeJob.options.sides === 'double'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {t.doubleSide}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-2">{t.copies}</label>
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        disabled={isPaid || activeJob.options.copies <= 1}
                        onClick={() =>
                          void updateOption({ copies: Math.max(1, activeJob.options.copies - 1) })
                        }
                        className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-700 disabled:opacity-40 cursor-pointer"
                        aria-label="Decrease copies"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="font-mono text-base font-bold tabular-nums text-slate-900">
                        {activeJob.options.copies}
                      </span>
                      <button
                        type="button"
                        disabled={isPaid}
                        onClick={() => void updateOption({ copies: activeJob.options.copies + 1 })}
                        className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-700 disabled:opacity-40 cursor-pointer"
                        aria-label="Increase copies"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Page Range & Orientation */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                      {t.pageRange}
                    </label>
                    <input
                      type="text"
                      disabled={isPaid}
                      value={activeJob.options.pageRange}
                      onChange={(e) =>
                        setActiveJob({
                          ...activeJob,
                          options: { ...activeJob.options, pageRange: e.target.value },
                        })
                      }
                      onBlur={(e) => void updateOption({ pageRange: e.target.value })}
                      placeholder="all or 1-3, 5"
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm font-mono text-slate-900 disabled:bg-slate-100 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                      {t.orientation}
                    </label>
                    <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                      {(['auto', 'portrait', 'landscape'] as PrintOrientation[]).map((orient) => (
                        <button
                          key={orient}
                          type="button"
                          disabled={isPaid}
                          onClick={() => void updateOption({ orientation: orient })}
                          className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-60 ${
                            activeJob.options.orientation === orient
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600'
                          }`}
                        >
                          {orient === 'auto'
                            ? t.orientAuto
                            : orient === 'portrait'
                            ? t.orientPortrait
                            : t.orientLandscape}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Live Bill, UPI QR & Auto-Print Status */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">{t.summaryTitle}</h3>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                  activeJob.printStatus === 'completed'
                    ? 'text-emerald-700'
                    : activeJob.printStatus === 'printing'
                    ? 'text-blue-700'
                    : 'text-amber-700'
                }`}
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{getStatusLabel(activeJob.printStatus, lang)}</span>
              </span>
            </div>

            {/* Price Breakdown */}
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{t.printablePages}</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {activeJob.printablePages} × {activeJob.options.copies} copies
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>{t.unitRate}</span>
                <span className="font-mono tabular-nums text-slate-900">
                  ₹{(activeJob.pricingBreakdown.unitRate * activeJob.pricingBreakdown.multiplier).toFixed(2)}
                </span>
              </div>
              {activeJob.pricingBreakdown.duplexDiscount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>{t.duplexDiscount}</span>
                  <span className="font-mono tabular-nums">
                    -₹{activeJob.pricingBreakdown.duplexDiscount.toFixed(2)}
                  </span>
                </div>
              )}
              {config.loyalty?.enabled && (activeJob.loyaltyPointsEarned ?? 0) > 0 && (
                <div className="flex justify-between text-amber-700 text-xs pt-1">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Award className="w-3.5 h-3.5" />
                    <span>{lang === 'hi' ? 'लॉयल्टी पॉइंट्स रिवॉर्ड' : 'Loyalty Points'}</span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    +{activeJob.loyaltyPointsEarned} pts {lang === 'hi' ? '(प्रिंट पर)' : 'on print'}
                  </span>
                </div>
              )}
              <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
                <span className="font-semibold text-slate-900">{t.totalPayable}</span>
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                  ₹{activeJob.pricingBreakdown.totalAmount.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Payment QR or Completed Auto-Print Card */}
            {!isPaid ? (
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <div className="text-center">
                  <p className="text-xs font-medium text-slate-600 mb-3">{t.scanToPay}</p>
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="UPI Payment QR Code"
                      className="w-52 h-52 mx-auto rounded-xl border border-slate-200 p-2 bg-white"
                    />
                  ) : (
                    <div className="w-52 h-52 mx-auto rounded-xl border border-slate-200 flex items-center justify-center bg-slate-50">
                      <QrCode className="w-10 h-10 text-slate-400" />
                    </div>
                  )}
                  <p className="mt-2 text-xs font-mono text-slate-500">
                    UPI: {config.payment.upiId}
                  </p>
                  <a
                    href={activeJob.upiUri}
                    className="mt-3 inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-blue-600 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{t.openUpiApp}</span>
                  </a>
                </div>

                {/* UTR Verification */}
                <div className="space-y-2.5 pt-3 border-t border-slate-100">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={utrInput}
                      onChange={(e) => setUtrInput(e.target.value)}
                      placeholder={t.utrPlaceholder}
                      className="flex-1 min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={paying}
                      onClick={() => void handlePayment('upi_qr')}
                      className="min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {t.confirmUtrBtn}
                    </button>
                  </div>

                  {config.payment.sandboxInstantPayEnabled && (
                    <button
                      type="button"
                      disabled={paying}
                      onClick={() => void handlePayment('upi_sandbox')}
                      className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>{t.instantDemoPay}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    {activeJob.printStatus === 'printing' ? (
                      <Loader2 className="w-5 h-5 text-blue-700 animate-spin shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {activeJob.printStatus === 'completed' ? t.printCompleted : t.paymentSuccess}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 font-mono">
                        UTR: {activeJob.utrNumber} · {activeJob.assignedPrinter}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-xs text-slate-500">{t.jobCodeLabel}</span>
                    <span className="mt-1 block text-lg font-bold font-mono tabular-nums text-slate-900">
                      {activeJob.code}
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-xs text-slate-500">{t.pinLabel}</span>
                    <span className="mt-1 block text-lg font-bold font-mono tabular-nums text-blue-700">
                      {activeJob.pin}
                    </span>
                  </div>
                </div>

                {config.loyalty?.enabled && (activeJob.loyaltyPointsEarned ?? 0) > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                        <Award className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>
                          {activeJob.printStatus === 'completed'
                            ? lang === 'hi'
                              ? `+${activeJob.loyaltyPointsEarned} लॉयल्टी पॉइंट्स मिले!`
                              : `+${activeJob.loyaltyPointsEarned} Loyalty Points Earned!`
                            : lang === 'hi'
                            ? `प्रिंट पूरा होते ही +${activeJob.loyaltyPointsEarned} पॉइंट्स जुड़ेंगे`
                            : `Earning +${activeJob.loyaltyPointsEarned} points once printed...`}
                        </span>
                      </div>
                      {activeJob.loyaltyCustomerBalance !== undefined && (
                        <span className="font-mono text-xs font-bold tabular-nums text-amber-900">
                          {lang === 'hi' ? 'कुल:' : 'Balance:'} {activeJob.loyaltyCustomerBalance} pts
                        </span>
                      )}
                    </div>

                    {activeJob.printStatus === 'completed' && !activeJob.customerPhone && (
                      <form onSubmit={(e) => void handleClaimLoyalty(e)} className="space-y-2 pt-1">
                        <p className="text-[11px] text-amber-800">
                          {lang === 'hi'
                            ? 'अपने मोबाइल नंबर पर ये पॉइंट्स सेव करें:'
                            : 'Enter your mobile number to save these points to your account:'}
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="tel"
                            required
                            value={claimPhoneInput}
                            onChange={(e) => setClaimPhoneInput(e.target.value)}
                            placeholder="+91 98XXXXXXXX"
                            className="flex-1 min-h-[38px] rounded-lg border border-amber-300 bg-white px-3 text-xs font-mono text-slate-900 focus:border-amber-600 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={claimingLoyalty}
                            className="min-h-[38px] rounded-lg bg-amber-700 px-3.5 text-xs font-semibold text-white hover:bg-amber-800 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            {claimingLoyalty
                              ? '...'
                              : lang === 'hi'
                              ? 'पॉइंट्स सेव करें'
                              : 'Claim Points'}
                          </button>
                        </div>
                        {loyaltyError && <p className="text-[11px] text-red-700">{loyaltyError}</p>}
                      </form>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={downloadingReceipt}
                    onClick={() => void handleDownloadReceiptPdf()}
                    className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {downloadingReceipt ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span>{lang === 'hi' ? 'Print Receipt (रसीद PDF)' : 'Print Receipt'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintDocument}
                    className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>{lang === 'hi' ? 'डॉक्यूमेंट प्रिंट करें' : 'Print Document'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
