import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquare,
  Send,
  Upload,
} from 'lucide-react';
import { copy } from '../i18n';
import type { Language, PublicConfig, WhatsAppMessageLog } from '../types';
import { apiUrl } from '../utils/api';
import { generateQrDataUrl } from '../utils/qrHelper';
import { createSamplePrintPdf } from '../utils/samplePdf';

interface WhatsAppStationProps {
  lang: Language;
  config: PublicConfig;
  onOpenJobPayment: (jobCode: string) => void;
  liveLog: WhatsAppMessageLog | null;
}

export const WhatsAppStation: React.FC<WhatsAppStationProps> = ({
  lang,
  config,
  onOpenJobPayment,
  liveLog,
}) => {
  const t = copy[lang];
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [waQrUrl, setWaQrUrl] = useState('');
  const [logs, setLogs] = useState<WhatsAppMessageLog[]>([]);
  const [phone, setPhone] = useState('+919811223344');
  const [name, setName] = useState('Aarav Mehta');
  const [caption, setCaption] = useState('Color 2 copies double');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [resultBanner, setResultBanner] = useState<{ code: string; pin: string; replyText: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const cleanedNumber = config.whatsapp.businessNumber.replace(/[^0-9]/g, '');
  const waDeepLink = `https://wa.me/${cleanedNumber}?text=${encodeURIComponent(
    'Hi, I want to print a document'
  )}`;

  useEffect(() => {
    void (async () => {
      try {
        const [qrUrl, logsRes] = await Promise.all([
          generateQrDataUrl(waDeepLink),
          fetch(apiUrl(`/api/whatsapp/logs?shop=${encodeURIComponent(config.shopId)}`)),
        ]);
        if (qrUrl) {
          setWaQrUrl(qrUrl);
        }
        if (logsRes.ok) {
          const lData = await logsRes.json();
          setLogs(lData.logs || []);
        }
      } catch {
        // Ignore transient load error
      }
    })();
  }, [waDeepLink, config.shopId]);

  useEffect(() => {
    if (liveLog && liveLog.shopId === config.shopId) {
      setLogs((prev) => [liveLog, ...prev.filter((l) => l.id !== liveLog.id)].slice(0, 30));
    }
  }, [liveLog, config.shopId]);

  async function handleSimulateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSending(true);
    try {
      const fileToSend = selectedFile || (await createSamplePrintPdf(config.shopName));
      const form = new FormData();
      form.append('file', fileToSend);
      form.append('shopId', config.shopId);
      form.append('phone', phone);
      form.append('name', name);
      form.append('caption', caption);

      const res = await fetch(apiUrl('/api/whatsapp/simulate'), {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'WhatsApp intake failed');
        return;
      }
      setResultBanner({
        code: data.job.code,
        pin: data.job.pin,
        replyText: data.replyText,
      });
      setSelectedFile(null);
    } catch {
      setErrorMsg(lang === 'hi' ? 'वाट्सअप सिमुलेशन विफल रहा।' : 'Failed to process WhatsApp print request.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {t.whatsappTitle}
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-2xl">
          {t.whatsappSub}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Customer WhatsApp QR + Test Bot Intake */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col sm:flex-row items-center gap-6">
            <div className="shrink-0">
              {waQrUrl ? (
                <img
                  src={waQrUrl}
                  alt="WhatsApp Print QR Code"
                  className="w-40 h-40 rounded-xl border border-slate-200 p-2 bg-white"
                />
              ) : (
                <div className="w-40 h-40 rounded-xl border border-slate-200 bg-slate-50" />
              )}
            </div>
            <div className="space-y-3 text-center sm:text-left">
              <h2 className="text-base font-semibold text-slate-900">{t.whatsappQrTitle}</h2>
              <p className="text-sm text-slate-600">
                {lang === 'hi'
                  ? 'ग्राहक वाट्सअप पर कोई भी PDF, फोटो या Word डॉक्यूमेंट भेजकर "Color 2 copies" लिखें — बॉट तुरंत पेमेंट लिंक भेज देगा।'
                  : 'Customers send any PDF, Photo, or Doc with a message like "Color 2 copies" and immediately receive a UPI QR payment link.'}
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <span className="font-mono text-xs text-slate-700">
                  {config.whatsapp.businessNumber}
                </span>
                <a
                  href={waDeepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{t.openWhatsapp}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Interactive WhatsApp Bot Intake Tester */}
          <form
            onSubmit={handleSimulateSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
          >
            <div>
              <h2 className="text-base font-semibold text-slate-900">{t.waSimTitle}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {lang === 'hi'
                  ? 'असली फाइल अपलोड करके देखें कि वाट्सअप बॉट ऑटोमैटिक प्राइसिंग और जॉब कैसे बनाता है।'
                  : 'Test the automated WhatsApp parser with any real document and print instruction caption.'}
              </p>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {lang === 'hi' ? 'कस्टमर नाम' : 'Sender Name'}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {lang === 'hi' ? 'वाट्सअप नंबर' : 'WhatsApp Number'}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">{t.waSimCaption}</label>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Color 2 copies double"
                className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept={config.formats.allowedExtensions.join(',')}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-slate-600" />
                <span>
                  {selectedFile
                    ? selectedFile.name
                    : lang === 'hi'
                    ? 'अटैचमेंट चुनें (या डिफ़ॉल्ट सैंपल PDF)'
                    : 'Attach File (or use Sample PDF)'}
                </span>
              </button>

              <button
                type="submit"
                disabled={sending}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{t.waSimSend}</span>
              </button>
            </div>

            {resultBanner && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {lang === 'hi' ? 'बॉट द्वारा जॉब तैयार:' : 'Bot Created Print Job:'} {resultBanner.code}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenJobPayment(resultBanner.code)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    <span>{lang === 'hi' ? 'QR पेमेंट खोलें' : 'Open QR Payment'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-slate-700 font-mono break-all">{resultBanner.replyText}</p>
              </div>
            )}
          </form>
        </div>

        {/* Right: Live WhatsApp Conversation Log */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">{t.waLogsTitle}</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">{logs.length}</span>
          </div>

          {logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {lang === 'hi'
                ? 'अभी कोई वाट्सअप मैसेज नहीं आया है। बाईं ओर से टेस्ट भेजकर देखें।'
                : 'No WhatsApp messages logged yet. Send a test request on the left.'}
            </div>
          ) : (
            <div className="mt-4 space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`rounded-xl border p-3.5 text-xs ${
                    log.direction === 'outbound'
                      ? 'border-blue-100 bg-blue-50/50'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-slate-500 mb-1">
                    <span className="font-semibold text-slate-800">
                      {log.direction === 'outbound' ? `${log.senderName} (Bot)` : log.senderName}
                    </span>
                    <span className="font-mono tabular-nums">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed break-words">{log.text}</p>
                  {log.attachmentName && (
                    <p className="mt-1.5 font-mono text-[11px] text-slate-500">
                      File: {log.attachmentName}
                    </p>
                  )}
                  {log.jobCode && (
                    <button
                      type="button"
                      onClick={() => onOpenJobPayment(log.jobCode!)}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      <span>Pay & Print {log.jobCode}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
