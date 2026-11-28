import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Printer, QrCode, Smartphone } from 'lucide-react';
import { copy, getStatusLabel } from '../i18n';
import type { Language, PrintJob, PublicConfig } from '../types';
import {
  filterAndSortJobs,
  getJobFileCategory,
  getStatusBucket,
  type FileTypeFilter,
  type JobSortBy,
  type JobStatusFilter,
} from '../utils/jobFilters';
import { apiUrl, getAppBasePath } from '../utils/api';
import { generateQrDataUrl } from '../utils/qrHelper';

interface KioskDisplayProps {
  lang: Language;
  config: PublicConfig;
  queue: PrintJob[];
  autoDispatchJobId: string | null;
  onOpenJob: (jobCode: string) => void;
}

export const KioskDisplay: React.FC<KioskDisplayProps> = ({
  lang,
  config,
  queue,
  autoDispatchJobId,
  onOpenJob,
}) => {
  const t = copy[lang];
  const [counterQr, setCounterQr] = useState('');
  const [waQr, setWaQr] = useState('');
  const [autoOpenPrintSheet, setAutoOpenPrintSheet] = useState(false);
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>('all');
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const [sortBy, setSortBy] = useState<JobSortBy>('newest');
  const dispatchFrameRef = useRef<HTMLIFrameElement | null>(null);

  const statusCounts = useMemo(() => {
    let pending = 0;
    let printing = 0;
    let completed = 0;
    for (const j of queue) {
      const bucket = getStatusBucket(j);
      if (bucket === 'pending') pending += 1;
      else if (bucket === 'printing') printing += 1;
      else if (bucket === 'completed') completed += 1;
    }
    return { all: queue.length, pending, printing, completed };
  }, [queue]);

  const filteredQueue = useMemo(
    () =>
      filterAndSortJobs(queue, {
        statusFilter,
        fileTypeFilter,
        sortBy,
      }),
    [queue, statusFilter, fileTypeFilter, sortBy]
  );

  const counterUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${getAppBasePath()}/?shop=${encodeURIComponent(config.shopSlug)}&kiosk=counter-1`
      : `/?shop=${encodeURIComponent(config.shopSlug)}&kiosk=counter-1`;
  const cleanedNumber = config.whatsapp.businessNumber.replace(/[^0-9]/g, '');
  const waUrl = `https://wa.me/${cleanedNumber}?text=${encodeURIComponent('Hi, I want to print a document')}`;

  useEffect(() => {
    void (async () => {
      try {
        const [cUrl, wUrl] = await Promise.all([
          generateQrDataUrl(counterUrl),
          generateQrDataUrl(waUrl),
        ]);
        if (cUrl) setCounterQr(cUrl);
        if (wUrl) setWaQr(wUrl);
      } catch {
        // Ignore transient QR generation error
      }
    })();
  }, [counterUrl, waUrl]);

  useEffect(() => {
    if (!autoOpenPrintSheet || !autoDispatchJobId) return;
    const frame = dispatchFrameRef.current;
    if (!frame) return;
    frame.src = apiUrl(`/api/jobs/${autoDispatchJobId}/file`);
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // Browser blocked silent print if unsupported for this MIME
      }
    };
  }, [autoDispatchJobId, autoOpenPrintSheet]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5 no-print">
        <div className="max-w-2xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {t.kioskTitle}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-600">{t.kioskSub}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>{t.kioskPrintPoster}</span>
          </button>
        </div>
      </div>

      {/* Hidden frame for counter auto-print bridge */}
      <iframe ref={dispatchFrameRef} title="counter-auto-print" className="hidden" />

      {/* Counter Poster & QR Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-900">
            <QrCode className="w-4 h-4 text-blue-600" />
            <span>{t.kioskCounterQr}</span>
          </div>
          {counterQr ? (
            <img
              src={counterQr}
              alt="Store Counter Upload QR"
              className="w-56 h-56 mx-auto rounded-xl border border-slate-200 p-2 bg-white"
            />
          ) : (
            <div className="w-56 h-56 mx-auto rounded-xl border border-slate-200 bg-slate-50" />
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">{config.shopName}</p>
            <p className="text-xs text-slate-600">
              {lang === 'hi'
                ? 'मोबाइल से स्कैन करें → फाइल चुनें → UPI पेमेंट करें → तुरंत प्रिंट पाएं'
                : 'Scan with Phone Camera → Upload File → Pay via UPI → Auto-Print'}
            </p>
            <p className="text-[11px] font-mono text-slate-400 break-all pt-1">{counterUrl}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-900">
            <Smartphone className="w-4 h-4 text-emerald-600" />
            <span>{t.kioskWaQr}</span>
          </div>
          {waQr ? (
            <img
              src={waQr}
              alt="WhatsApp Print QR"
              className="w-56 h-56 mx-auto rounded-xl border border-slate-200 p-2 bg-white"
            />
          ) : (
            <div className="w-56 h-56 mx-auto rounded-xl border border-slate-200 bg-slate-50" />
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              WhatsApp: <span className="font-mono">{config.whatsapp.businessNumber}</span>
            </p>
            <p className="text-xs text-slate-600">
              {lang === 'hi'
                ? 'वाट्सअप पर PDF या फोटो भेजें और ऑटोमैटिक पेमेंट लिंक प्राप्त करें'
                : 'Send any PDF, Doc, or Photo on WhatsApp to get instant payment QR'}
            </p>
            <p className="text-xs font-mono text-slate-500 pt-1">
              B&W ₹{config.pricing.bwPerPage} · Color ₹{config.pricing.colorPerPage}
            </p>
          </div>
        </div>
      </div>

      {/* Counter PC Auto-Dispatch Toggle + Live Queue */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t.liveQueueTitle}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'hi'
                ? 'कस्टमर पेमेंट होते ही प्रिंट जॉब यहाँ तुरंत अपडेट होती है।'
                : 'Updates automatically in real time as customers scan and pay.'}
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer select-none min-h-[40px]">
            <input
              type="checkbox"
              checked={autoOpenPrintSheet}
              onChange={(e) => setAutoOpenPrintSheet(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>{t.kioskAutoDispatch}</span>
          </label>
        </div>

        {/* Filter & Sort Controls: Status & File Type */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {([
                { id: 'all', label: lang === 'hi' ? 'सभी' : 'All', count: statusCounts.all },
                { id: 'pending', label: lang === 'hi' ? 'पेंडिंग' : 'Pending', count: statusCounts.pending },
                { id: 'printing', label: lang === 'hi' ? 'प्रिंटिंग' : 'Printing', count: statusCounts.printing },
                { id: 'completed', label: lang === 'hi' ? 'पूर्ण' : 'Completed', count: statusCounts.completed },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStatusFilter(item.id)}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === item.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}{' '}
                  <span className="font-mono tabular-nums text-slate-400 ml-0.5">{item.count}</span>
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
                  onClick={() => setFileTypeFilter(ft.id)}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    fileTypeFilter === ft.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="kiosk-sort-by" className="text-xs font-medium text-slate-500 whitespace-nowrap">
              {lang === 'hi' ? 'क्रम:' : 'Sort by:'}
            </label>
            <select
              id="kiosk-sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as JobSortBy)}
              className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900"
            >
              <option value="newest">{lang === 'hi' ? 'नवीनतम पहले' : 'Newest First'}</option>
              <option value="status">{lang === 'hi' ? 'स्थिति (Pending → Completed)' : 'Status (Pending → Completed)'}</option>
              <option value="fileType">{lang === 'hi' ? 'फाइल प्रकार (PDF → Image → Word)' : 'File Type (PDF → Image → Word)'}</option>
            </select>
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">{t.emptyQueue}</div>
        ) : filteredQueue.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-slate-500">
              {lang === 'hi'
                ? 'चुने गए Status या File Type फ़िल्टर में कोई जॉब नहीं मिली।'
                : 'No print jobs match the selected Status or File Type filter.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setFileTypeFilter('all');
                setSortBy('newest');
              }}
              className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              {lang === 'hi' ? 'फ़िल्टर रीसेट करें' : 'Reset Filters'}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Job Code</th>
                  <th className="py-2.5 pr-4">File</th>
                  <th className="py-2.5 pr-4">Specs</th>
                  <th className="py-2.5 pr-4">Printer</th>
                  <th className="py-2.5 pr-4 text-right">Amount</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQueue.map((job) => {
                  const category = getJobFileCategory(job);
                  const categoryText =
                    category === 'pdf'
                      ? 'PDF'
                      : category === 'image'
                      ? 'Image'
                      : category === 'word'
                      ? 'Word'
                      : job.fileExtension.replace('.', '').toUpperCase() || 'File';
                  return (
                    <tr key={job.id} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-4 font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenJob(job.code)}
                          className="text-blue-700 hover:underline cursor-pointer"
                        >
                          {job.code}
                        </button>
                      </td>
                      <td className="py-3 pr-4 max-w-[200px] truncate text-slate-800">
                        <div className="truncate font-medium">{job.originalFilename}</div>
                        <div className="text-[11px] font-mono text-slate-500">{categoryText}</div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {job.options.colorMode === 'color' ? 'Color' : 'B&W'} · {job.options.paperSize} ·{' '}
                        {job.printablePages}p × {job.options.copies}
                      </td>
                      <td className="py-3 pr-4 text-xs font-mono text-slate-600 max-w-[180px] truncate">
                        {job.assignedPrinter}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                        ₹{job.pricingBreakdown.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                            job.printStatus === 'completed'
                              ? 'text-emerald-700'
                              : job.printStatus === 'printing'
                              ? 'text-blue-700'
                              : job.printStatus === 'cancelled'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {job.printStatus === 'completed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : job.printStatus === 'printing' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                          <span>{getStatusLabel(job.printStatus, lang)}</span>
                        </span>
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
  );
};
