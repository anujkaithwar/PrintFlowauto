import 'dotenv/config';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import type {
  BusinessSettings,
  ColorMode,
  JobSource,
  LoyaltyAccount,
  LoyaltyEarnMode,
  PaperSize,
  PricingBreakdown,
  PrintJob,
  PrintOptions,
  PrintOrientation,
  PrintSides,
  PublicShopSummary,
  ShopConfig,
  WhatsAppMessageLog,
} from './src/types.ts';

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

interface AdminAuthRecord {
  salt: string;
  hash: string;
  updatedAt: string;
}

interface StoreSchema {
  shops: ShopConfig[];
  jobs: PrintJob[];
  whatsappLogs: WhatsAppMessageLog[];
  loyaltyAccounts: Record<string, LoyaltyAccount>;
  adminAuth: AdminAuthRecord | null;
}

const DEFAULT_SETTINGS: BusinessSettings = {
  shopName: 'PrintFlow Digital Hub',
  shopTagline: 'Scan QR, Pay via UPI, Collect Instant Prints',
  shopAddress: 'Shop 14, Ground Floor, Tech Plaza',
  gstNumber: '',
  pricing: {
    bwPerPage: 2,
    colorPerPage: 10,
    duplexDiscountPercent: 10,
    a3Multiplier: 2,
    photo4x6Rate: 25,
    minOrderAmount: 5,
  },
  payment: {
    upiId: 'printflow@upi',
    upiPayeeName: 'PrintFlow Digital Hub',
    autoPrintOnPayment: true,
    sandboxInstantPayEnabled: true,
  },
  printers: {
    bwPrinterName: 'HP LaserJet Pro M404dn (B&W)',
    colorPrinterName: 'Epson EcoTank L8050 (Color)',
    photoPrinterName: 'Canon PIXMA G670 (Photo)',
    bridgeMode: 'browser_auto',
    ippEndpoint: '',
    paperTrayRemaining: 450,
  },
  whatsapp: {
    enabled: true,
    businessNumber: '+919876543210',
    welcomeMessage:
      'Namaste! Send any PDF, Document, or Photo here. Reply with options like "Color 2 copies" to get your instant QR payment link.',
    autoReplyOnUpload: true,
    defaultColorMode: 'bw',
  },
  formats: {
    allowedExtensions: [
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
    ],
    maxFileSizeMb: 25,
    autoDeleteHours: 24,
  },
  loyalty: {
    enabled: true,
    earnMode: 'per_rupee',
    earnRate: 1,
  },
};

function mergeSettings(raw?: Partial<BusinessSettings>): BusinessSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    pricing: { ...DEFAULT_SETTINGS.pricing, ...(raw?.pricing || {}) },
    payment: { ...DEFAULT_SETTINGS.payment, ...(raw?.payment || {}) },
    printers: { ...DEFAULT_SETTINGS.printers, ...(raw?.printers || {}) },
    whatsapp: { ...DEFAULT_SETTINGS.whatsapp, ...(raw?.whatsapp || {}) },
    formats: { ...DEFAULT_SETTINGS.formats, ...(raw?.formats || {}) },
    loyalty: { ...DEFAULT_SETTINGS.loyalty, ...(raw?.loyalty || {}) },
  };
}

function createDefaultShop(overrides?: Partial<BusinessSettings>): ShopConfig {
  return {
    id: 'shop-main',
    slug: 'main',
    active: true,
    createdAt: new Date().toISOString(),
    agentKey: crypto.randomBytes(24).toString('hex'),
    settings: mergeSettings(overrides),
  };
}

function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return cleaned || `shop-${crypto.randomInt(100, 999)}`;
}

function loadStore(): StoreSchema {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreSchema> & { settings?: Partial<BusinessSettings> };

      let shops: ShopConfig[] = [];
      if (Array.isArray(parsed.shops) && parsed.shops.length > 0) {
        shops = parsed.shops.map((s) => ({
          id: s.id || crypto.randomUUID(),
          slug: s.slug || slugify(s.settings?.shopName || 'branch'),
          active: s.active !== false,
          createdAt: s.createdAt || new Date().toISOString(),
          agentKey: s.agentKey || crypto.randomBytes(24).toString('hex'),
          settings: mergeSettings(s.settings),
        }));
      } else {
        // Migrate legacy single-shop store cleanly
        shops = [createDefaultShop(parsed.settings)];
      }

      const defaultShop = shops[0];
      const jobs: PrintJob[] = Array.isArray(parsed.jobs)
        ? parsed.jobs.map((j) => ({
            ...j,
            shopId: j.shopId || defaultShop.id,
            shopName: j.shopName || defaultShop.settings.shopName,
          }))
        : [];

      const whatsappLogs: WhatsAppMessageLog[] = Array.isArray(parsed.whatsappLogs)
        ? parsed.whatsappLogs.map((l) => ({
            ...l,
            shopId: l.shopId || defaultShop.id,
            shopName: l.shopName || defaultShop.settings.shopName,
          }))
        : [];

      const loyaltyAccounts: Record<string, LoyaltyAccount> =
        parsed.loyaltyAccounts && typeof parsed.loyaltyAccounts === 'object'
          ? parsed.loyaltyAccounts
          : {};

      const migrated: StoreSchema = {
        shops,
        jobs,
        whatsappLogs,
        loyaltyAccounts,
        adminAuth: parsed.adminAuth || null,
      };
      saveStore(migrated);
      return migrated;
    }
  } catch (err) {
    console.error('Failed to load store.json, initializing fresh store:', err);
  }

  const initial: StoreSchema = {
    shops: [createDefaultShop()],
    jobs: [],
    whatsappLogs: [],
    loyaltyAccounts: {},
    adminAuth: null,
  };
  saveStore(initial);
  return initial;
}

function saveStore(data: StoreSchema): void {
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

const store: StoreSchema = loadStore();

function resolveShop(idOrSlug?: string): ShopConfig {
  const q = (idOrSlug || '').trim().toLowerCase();
  if (q) {
    const found = store.shops.find(
      (s) => s.active && (s.id.toLowerCase() === q || s.slug.toLowerCase() === q)
    );
    if (found) return found;
  }
  return store.shops.find((s) => s.active) || store.shops[0];
}

function getPublicShops(): PublicShopSummary[] {
  return store.shops
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      shopName: s.settings.shopName,
      shopAddress: s.settings.shopAddress,
      upiId: s.settings.payment.upiId,
      whatsappNumber: s.settings.whatsapp.businessNumber,
      whatsappEnabled: s.settings.whatsapp.enabled,
    }));
}

const sseClients = new Set<Response>();

function broadcastEvent(event: string, payload: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

function normalizePhoneKey(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function computeJobLoyaltyPoints(
  printablePages: number,
  copies: number,
  totalAmount: number,
  loyaltyCfg: BusinessSettings['loyalty']
): number {
  if (!loyaltyCfg.enabled || loyaltyCfg.earnRate <= 0) return 0;
  let raw = 0;
  if (loyaltyCfg.earnMode === 'per_page') {
    raw = printablePages * Math.max(1, copies) * loyaltyCfg.earnRate;
  } else if (loyaltyCfg.earnMode === 'per_job') {
    raw = loyaltyCfg.earnRate;
  } else {
    raw = totalAmount * loyaltyCfg.earnRate;
  }
  return Math.max(1, Math.floor(raw));
}

function creditLoyaltyAccount(phone: string, customerName: string, points: number, countJob: boolean): number {
  const key = normalizePhoneKey(phone);
  if (!key || points <= 0) return 0;
  const existing = store.loyaltyAccounts[key];
  const now = new Date().toISOString();
  if (existing) {
    existing.points += points;
    existing.totalEarned += points;
    if (countJob) existing.totalJobsCompleted += 1;
    if (customerName && customerName !== 'Walk-in Customer') {
      existing.customerName = customerName;
    }
    existing.updatedAt = now;
    return existing.points;
  }
  const created: LoyaltyAccount = {
    phone: key,
    customerName: customerName || 'PrintFlow Member',
    points,
    totalJobsCompleted: countJob ? 1 : 0,
    totalEarned: points,
    updatedAt: now,
  };
  store.loyaltyAccounts[key] = created;
  return created.points;
}

function awardLoyaltyPointsForJob(job: PrintJob): void {
  if (job.paymentStatus !== 'paid' || job.printStatus !== 'completed' || job.loyaltyAwarded) {
    return;
  }
  const shop = resolveShop(job.shopId);
  const points = computeJobLoyaltyPoints(
    job.printablePages,
    job.options.copies,
    job.pricingBreakdown.totalAmount,
    shop.settings.loyalty
  );
  job.loyaltyPointsEarned = points;
  job.loyaltyAwarded = true;
  if (points > 0) {
    const key = normalizePhoneKey(job.customerPhone);
    if (key) {
      job.loyaltyCustomerBalance = creditLoyaltyAccount(
        job.customerPhone,
        job.customerName,
        points,
        true
      );
    }
  }
}

function maskPhone(phone: string): string {
  const cleaned = phone.trim();
  if (cleaned.length <= 4) return '••••';
  return `${cleaned.slice(0, 3)}••••${cleaned.slice(-4)}`;
}

function sanitizeJobForPublic(job: PrintJob): PrintJob {
  const key = normalizePhoneKey(job.customerPhone);
  const account = key ? store.loyaltyAccounts[key] : undefined;
  return {
    ...job,
    customerPhone: job.customerPhone ? maskPhone(job.customerPhone) : '',
    loyaltyCustomerBalance: account ? account.points : job.loyaltyCustomerBalance,
  };
}

function getEnvPasscode(): string {
  return (process.env.ADMIN_PASSCODE || '').trim();
}

function hashPasscode(passcode: string, saltHex?: string): AdminAuthRecord {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return { salt, hash: derived, updatedAt: new Date().toISOString() };
}

function verifyPasscode(passcode: string): boolean {
  const envPass = getEnvPasscode();
  if (envPass.length > 0) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPass);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!store.adminAuth) return false;
  const candidate = crypto.scryptSync(passcode, store.adminAuth.salt, 64);
  const stored = Buffer.from(store.adminAuth.hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function signSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
      iat: Date.now(),
      exp: Date.now() + 1000 * 60 * 60 * 12,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    return decoded.role === 'admin' && typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token || !verifySessionToken(token)) {
    res.status(401).json({ error: 'Unauthorized. Admin sign-in required.' });
    return;
  }
  next();
}

function verifyShopAgentKey(req: Request): ShopConfig | null {
  const providedKey = String(req.headers['x-agent-key'] || '').trim();
  if (!providedKey) return null;
  const a = Buffer.from(providedKey);
  for (const shop of store.shops) {
    const b = Buffer.from(shop.agentKey);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return shop;
    }
  }
  return null;
}

function parsePageRangeCount(pageRange: string, detectedPages: number): number {
  const trimmed = pageRange.trim().toLowerCase();
  if (!trimmed || trimmed === 'all') return detectedPages;
  const selected = new Set<number>();
  const parts = trimmed.split(',');
  for (const part of parts) {
    const seg = part.trim();
    if (!seg) continue;
    if (seg.includes('-')) {
      const [startStr, endStr] = seg.split('-');
      const start = Math.max(1, Number.parseInt(startStr, 10) || 1);
      const end = Math.min(detectedPages, Number.parseInt(endStr, 10) || detectedPages);
      for (let i = start; i <= end; i++) selected.add(i);
    } else {
      const p = Number.parseInt(seg, 10);
      if (p >= 1 && p <= detectedPages) selected.add(p);
    }
  }
  return selected.size > 0 ? selected.size : detectedPages;
}

function computePricing(
  printablePages: number,
  options: PrintOptions,
  settings: BusinessSettings
): PricingBreakdown {
  const { pricing } = settings;
  const copies = Math.max(1, Math.min(200, Math.floor(options.copies || 1)));
  let unitRate = options.colorMode === 'color' ? pricing.colorPerPage : pricing.bwPerPage;
  let multiplier = 1;

  if (options.paperSize === 'Photo_4x6') {
    unitRate = pricing.photo4x6Rate;
  } else if (options.paperSize === 'A3') {
    multiplier = pricing.a3Multiplier;
  } else if (options.paperSize === 'Legal') {
    multiplier = 1.25;
  }

  const rawPerSheet = unitRate * multiplier;
  const duplexDiscountRate =
    options.sides === 'double' && printablePages * copies >= 2
      ? pricing.duplexDiscountPercent / 100
      : 0;

  const subtotal = Math.round(printablePages * copies * rawPerSheet * 100) / 100;
  const discountAmount = Math.round(subtotal * duplexDiscountRate * 100) / 100;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const totalAmount = Math.max(pricing.minOrderAmount, Math.round(afterDiscount * 100) / 100);

  return {
    unitRate,
    multiplier,
    duplexDiscount: discountAmount,
    subtotal,
    totalAmount,
    currency: 'INR',
  };
}

function buildUpiUri(jobId: string, code: string, amount: number, settings: BusinessSettings): string {
  const pa = settings.payment.upiId || 'printflow@upi';
  const pn = settings.payment.upiPayeeName || settings.shopName || 'PrintFlow';
  const params = new URLSearchParams({
    pa,
    pn,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `Print ${code}`,
    tr: jobId,
  });
  return `upi://pay?${params.toString()}`;
}

function pickAssignedPrinter(options: PrintOptions, settings: BusinessSettings): string {
  if (options.paperSize === 'Photo_4x6') return settings.printers.photoPrinterName;
  return options.colorMode === 'color'
    ? settings.printers.colorPrinterName
    : settings.printers.bwPrinterName;
}

async function detectPageCount(buffer: Buffer, ext: string): Promise<number> {
  if (ext === '.pdf') {
    try {
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return Math.max(1, doc.getPageCount());
    } catch {
      return 1;
    }
  }
  if (ext === '.txt' || ext === '.csv') {
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).length;
    return Math.max(1, Math.ceil(lines / 45));
  }
  return 1;
}

function generateJobCode(): string {
  const num = crypto.randomInt(1000, 9999);
  return `PF-${num}`;
}

function generatePin(): string {
  return String(crypto.randomInt(100000, 999999));
}

function resolveUploadPath(storedFilename: string): string {
  const safeBase = path.basename(storedFilename);
  const resolved = path.resolve(UPLOAD_DIR, safeBase);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

function triggerAutoPrintPipeline(jobId: string): void {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job || job.paymentStatus !== 'paid') return;

  const shop = resolveShop(job.shopId);

  // If shop uses local_agent (Windows/Android print agent), keep job in 'queued' or 'printing' until agent picks it up,
  // or auto-complete in browser_auto mode
  if (shop.settings.printers.bridgeMode === 'local_agent') {
    job.printStatus = 'queued';
    saveStore(store);
    broadcastEvent('job_updated', sanitizeJobForPublic(job));
    broadcastEvent('auto_print_dispatch', {
      jobId: job.id,
      shopId: job.shopId,
      code: job.code,
      printer: job.assignedPrinter,
      bridgeMode: shop.settings.printers.bridgeMode,
      originalFilename: job.originalFilename,
      copies: job.options.copies,
      colorMode: job.options.colorMode,
    });
    return;
  }

  job.printStatus = 'printing';
  saveStore(store);
  broadcastEvent('job_updated', sanitizeJobForPublic(job));
  broadcastEvent('auto_print_dispatch', {
    jobId: job.id,
    shopId: job.shopId,
    code: job.code,
    printer: job.assignedPrinter,
    bridgeMode: shop.settings.printers.bridgeMode,
    originalFilename: job.originalFilename,
    copies: job.options.copies,
    colorMode: job.options.colorMode,
  });

  setTimeout(() => {
    const current = store.jobs.find((j) => j.id === jobId);
    if (!current || current.printStatus !== 'printing') return;
    const sheetsUsed =
      current.options.sides === 'double'
        ? Math.ceil((current.printablePages * current.options.copies) / 2)
        : current.printablePages * current.options.copies;
    shop.settings.printers.paperTrayRemaining = Math.max(
      0,
      shop.settings.printers.paperTrayRemaining - sheetsUsed
    );
    current.printStatus = 'completed';
    current.printedAt = new Date().toISOString();
    awardLoyaltyPointsForJob(current);
    saveStore(store);
    broadcastEvent('job_updated', sanitizeJobForPublic(current));
  }, 2400);
}

function parseWhatsAppCaptionOptions(caption: string, defaultColor: ColorMode): PrintOptions {
  const lower = (caption || '').toLowerCase();
  const colorMode: ColorMode =
    lower.includes('color') || lower.includes('colour') || lower.includes('कलर') || lower.includes('रंगीन')
      ? 'color'
      : lower.includes('bw') || lower.includes('b&w') || lower.includes('black') || lower.includes('ब्लैक')
      ? 'bw'
      : defaultColor;

  const sides: PrintSides =
    lower.includes('double') || lower.includes('duplex') || lower.includes('both') || lower.includes('दोनों')
      ? 'double'
      : 'single';

  let paperSize: PaperSize = 'A4';
  if (lower.includes('a3')) paperSize = 'A3';
  else if (lower.includes('photo') || lower.includes('4x6')) paperSize = 'Photo_4x6';
  else if (lower.includes('legal')) paperSize = 'Legal';
  else if (lower.includes('letter')) paperSize = 'Letter';

  const copyMatch = lower.match(/(\d+)\s*(copy|copies|copi|प्रति|कॉपी)/);
  const copies = copyMatch ? Math.max(1, Math.min(100, Number.parseInt(copyMatch[1], 10))) : 1;

  const orientation: PrintOrientation = lower.includes('landscape') ? 'landscape' : 'auto';

  return {
    colorMode,
    paperSize,
    sides,
    copies,
    pageRange: 'all',
    orientation,
  };
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

async function sendWhatsAppReply(toPhone: string, messageBody: string): Promise<void> {
  const token = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneId) return;
  try {
    await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: messageBody },
      }),
    });
  } catch (err) {
    console.error('WhatsApp Cloud API reply failed:', err);
  }
}

function sanitizePowerShellLiteral(val: string): string {
  return val.replace(/["`$'\r\n]/g, '');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), shops: store.shops.length });
  });

  // Public shop configuration + active shop directory
  app.get('/api/public/config', (req, res) => {
    const shop = resolveShop(String(req.query.shop || ''));
    const s = shop.settings;
    res.json({
      shopId: shop.id,
      shopSlug: shop.slug,
      shopName: s.shopName,
      shopTagline: s.shopTagline,
      shopAddress: s.shopAddress,
      pricing: s.pricing,
      payment: s.payment,
      printers: {
        bwPrinterName: s.printers.bwPrinterName,
        colorPrinterName: s.printers.colorPrinterName,
        photoPrinterName: s.printers.photoPrinterName,
        bridgeMode: s.printers.bridgeMode,
        paperTrayRemaining: s.printers.paperTrayRemaining,
      },
      whatsapp: {
        enabled: s.whatsapp.enabled,
        businessNumber: s.whatsapp.businessNumber,
        defaultColorMode: s.whatsapp.defaultColorMode,
      },
      formats: s.formats,
      loyalty: s.loyalty,
      shops: getPublicShops(),
    });
  });

  app.get('/api/loyalty/balance', (req, res) => {
    const rawPhone = String(req.query.phone || '').trim();
    const key = normalizePhoneKey(rawPhone);
    if (!key) {
      res.status(400).json({ error: 'Enter a valid 6+ digit mobile number.' });
      return;
    }
    const acct = store.loyaltyAccounts[key];
    if (!acct) {
      res.json({
        found: false,
        phone: key,
        customerName: '',
        points: 0,
        totalJobsCompleted: 0,
        totalEarned: 0,
      });
      return;
    }
    res.json({
      found: true,
      phone: acct.phone,
      customerName: acct.customerName,
      points: acct.points,
      totalJobsCompleted: acct.totalJobsCompleted,
      totalEarned: acct.totalEarned,
    });
  });

  app.get('/api/public/queue', (req, res) => {
    const shopParam = String(req.query.shop || '').trim();
    const targetShop = shopParam ? resolveShop(shopParam) : null;
    const filtered = targetShop
      ? store.jobs.filter((j) => j.shopId === targetShop.id)
      : store.jobs;
    res.json({ jobs: filtered.slice(0, 12).map(sanitizeJobForPublic) });
  });

  app.get('/api/qr-image', async (req, res) => {
    const rawText = String(req.query.text || '').trim();
    if (!rawText || rawText.length > 512) {
      res.status(400).json({ error: 'Invalid QR payload' });
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(rawText, {
        width: 320,
        margin: 2,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });
      res.json({ dataUrl });
    } catch {
      res.status(500).json({ error: 'QR generation failed' });
    }
  });

  // Upload document & create print job for selected Shop
  app.post('/api/jobs', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Please select a document or image file to upload.' });
        return;
      }

      const shop = resolveShop(String(req.body.shopId || ''));
      const settings = shop.settings;

      const maxBytes = settings.formats.maxFileSizeMb * 1024 * 1024;
      if (file.size > maxBytes) {
        res.status(400).json({
          error: `File exceeds maximum allowed size of ${settings.formats.maxFileSizeMb} MB.`,
        });
        return;
      }

      const originalFilename = path.basename(file.originalname || 'document.pdf');
      const ext = path.extname(originalFilename).toLowerCase() || '.bin';
      const allowed = settings.formats.allowedExtensions.map((e) => e.toLowerCase());
      if (!allowed.includes(ext)) {
        res.status(400).json({
          error: `Unsupported file format (${ext}). Supported: ${allowed.join(', ')}`,
        });
        return;
      }

      const storedFilename = `${crypto.randomUUID()}${ext}`;
      const targetPath = resolveUploadPath(storedFilename);
      fs.writeFileSync(targetPath, file.buffer);

      const detectedPages = await detectPageCount(file.buffer, ext);

      const rawColor = String(req.body.colorMode || 'bw');
      const colorMode: ColorMode = rawColor === 'color' ? 'color' : 'bw';
      const allowedPapers: PaperSize[] = ['A4', 'A3', 'Letter', 'Legal', 'Photo_4x6'];
      const rawPaper = String(req.body.paperSize || 'A4') as PaperSize;
      const paperSize: PaperSize = allowedPapers.includes(rawPaper) ? rawPaper : 'A4';
      const sides: PrintSides = String(req.body.sides || 'single') === 'double' ? 'double' : 'single';
      const copies = Math.max(1, Math.min(200, Number.parseInt(String(req.body.copies || '1'), 10) || 1));
      const pageRange = String(req.body.pageRange || 'all').slice(0, 64);
      const rawOrient = String(req.body.orientation || 'auto');
      const orientation: PrintOrientation =
        rawOrient === 'portrait' || rawOrient === 'landscape' ? rawOrient : 'auto';

      const printablePages = parsePageRangeCount(pageRange, detectedPages);
      const options: PrintOptions = {
        colorMode,
        paperSize,
        sides,
        copies,
        pageRange,
        orientation,
      };
      const pricingBreakdown = computePricing(printablePages, options, settings);

      const id = crypto.randomUUID();
      const code = generateJobCode();
      const pin = generatePin();
      const rawSource = String(req.body.source || 'web_upload');
      const source: JobSource =
        rawSource === 'kiosk_qr' || rawSource === 'whatsapp' ? rawSource : 'web_upload';

      const job: PrintJob = {
        id,
        shopId: shop.id,
        shopName: settings.shopName,
        code,
        pin,
        source,
        customerName: String(req.body.customerName || 'Walk-in Customer').trim().slice(0, 60),
        customerPhone: String(req.body.customerPhone || '').trim().slice(0, 20),
        originalFilename,
        storedFilename,
        mimeType: file.mimetype || 'application/octet-stream',
        fileExtension: ext,
        fileSizeBytes: file.size,
        detectedPages,
        printablePages,
        options,
        pricingBreakdown,
        paymentStatus: 'pending',
        upiUri: buildUpiUri(id, code, pricingBreakdown.totalAmount, settings),
        printStatus: 'awaiting_payment',
        assignedPrinter: pickAssignedPrinter(options, settings),
        createdAt: new Date().toISOString(),
        notes: String(req.body.notes || '').trim().slice(0, 200),
        loyaltyPointsEarned: computeJobLoyaltyPoints(
          printablePages,
          options.copies,
          pricingBreakdown.totalAmount,
          settings.loyalty
        ),
        loyaltyAwarded: false,
      };

      store.jobs.unshift(job);
      saveStore(store);
      broadcastEvent('job_created', sanitizeJobForPublic(job));

      const qrDataUrl = await QRCode.toDataURL(job.upiUri, {
        width: 300,
        margin: 2,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });

      res.status(201).json({
        job: sanitizeJobForPublic(job),
        qrDataUrl,
      });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: 'Failed to process print job.' });
    }
  });

  app.patch('/api/jobs/:id/options', async (req, res) => {
    const job = store.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Print job not found.' });
      return;
    }
    if (job.paymentStatus === 'paid') {
      res.status(400).json({ error: 'Options cannot be changed after payment.' });
      return;
    }

    const shop = resolveShop(job.shopId);
    const body = req.body as Partial<PrintOptions>;
    const allowedPapers: PaperSize[] = ['A4', 'A3', 'Letter', 'Legal', 'Photo_4x6'];
    job.options = {
      colorMode: body.colorMode === 'color' ? 'color' : 'bw',
      paperSize: body.paperSize && allowedPapers.includes(body.paperSize) ? body.paperSize : job.options.paperSize,
      sides: body.sides === 'double' ? 'double' : 'single',
      copies: Math.max(1, Math.min(200, Number.parseInt(String(body.copies || job.options.copies), 10) || 1)),
      pageRange: typeof body.pageRange === 'string' ? body.pageRange.slice(0, 64) : job.options.pageRange,
      orientation:
        body.orientation === 'portrait' || body.orientation === 'landscape' || body.orientation === 'auto'
          ? body.orientation
          : job.options.orientation,
    };
    job.printablePages = parsePageRangeCount(job.options.pageRange, job.detectedPages);
    job.pricingBreakdown = computePricing(job.printablePages, job.options, shop.settings);
    job.upiUri = buildUpiUri(job.id, job.code, job.pricingBreakdown.totalAmount, shop.settings);
    job.assignedPrinter = pickAssignedPrinter(job.options, shop.settings);
    job.loyaltyPointsEarned = computeJobLoyaltyPoints(
      job.printablePages,
      job.options.copies,
      job.pricingBreakdown.totalAmount,
      shop.settings.loyalty
    );
    saveStore(store);

    const qrDataUrl = await QRCode.toDataURL(job.upiUri, {
      width: 300,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });

    broadcastEvent('job_updated', sanitizeJobForPublic(job));
    res.json({ job: sanitizeJobForPublic(job), qrDataUrl });
  });

  app.get('/api/jobs/:idOrCode', async (req, res) => {
    const q = req.params.idOrCode.trim().toUpperCase();
    const job = store.jobs.find(
      (j) => j.id.toUpperCase() === q || j.code.toUpperCase() === q || j.pin === q
    );
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const qrDataUrl = await QRCode.toDataURL(job.upiUri, {
      width: 300,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    res.json({ job: sanitizeJobForPublic(job), qrDataUrl });
  });

  app.get('/api/jobs/:id/file', (req, res) => {
    const job = store.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    try {
      const filePath = resolveUploadPath(job.storedFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Stored file no longer exists.' });
        return;
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', job.mimeType || 'application/octet-stream');
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      const safeName = job.originalFilename.replace(/["\r\n]/g, '_');
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
      res.sendFile(filePath);
    } catch {
      res.status(403).json({ error: 'Invalid file access.' });
    }
  });

  app.post('/api/jobs/:id/pay', (req, res) => {
    const job = store.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Print job not found.' });
      return;
    }
    if (job.paymentStatus === 'paid') {
      res.json({ job: sanitizeJobForPublic(job), alreadyPaid: true });
      return;
    }

    const shop = resolveShop(job.shopId);
    const mode = String(req.body?.mode || 'upi_qr');
    const utrNumber = String(req.body?.utrNumber || '').trim().slice(0, 40);

    if (mode === 'upi_sandbox' && !shop.settings.payment.sandboxInstantPayEnabled) {
      res.status(403).json({ error: 'Sandbox instant confirmation is disabled by admin for this shop.' });
      return;
    }

    if (mode === 'upi_qr' && utrNumber.length < 6) {
      res.status(400).json({ error: 'Enter a valid 6+ digit UPI UTR / Reference number.' });
      return;
    }

    job.paymentStatus = 'paid';
    job.paymentMethod = mode === 'upi_sandbox' ? 'upi_sandbox' : 'upi_qr';
    job.utrNumber = utrNumber || `UPI${Date.now().toString().slice(-8)}`;
    job.paidAt = new Date().toISOString();
    job.printStatus = 'queued';
    saveStore(store);

    broadcastEvent('job_updated', sanitizeJobForPublic(job));

    if (shop.settings.payment.autoPrintOnPayment) {
      triggerAutoPrintPipeline(job.id);
    }

    res.json({ job: sanitizeJobForPublic(job) });
  });

  app.post('/api/jobs/:id/claim-loyalty', (req, res) => {
    const job = store.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Print job not found.' });
      return;
    }
    if (job.paymentStatus !== 'paid' || job.printStatus !== 'completed') {
      res.status(400).json({ error: 'Points can only be claimed after the job is printed.' });
      return;
    }
    if (normalizePhoneKey(job.customerPhone)) {
      res.status(409).json({ error: 'Loyalty points for this job are already linked to a mobile number.' });
      return;
    }
    const rawPhone = String(req.body?.phone || '').trim().slice(0, 20);
    const key = normalizePhoneKey(rawPhone);
    if (!key) {
      res.status(400).json({ error: 'Enter a valid 6+ digit mobile number.' });
      return;
    }
    const points = job.loyaltyPointsEarned || 0;
    job.customerPhone = rawPhone;
    job.loyaltyAwarded = true;
    if (points > 0) {
      job.loyaltyCustomerBalance = creditLoyaltyAccount(rawPhone, job.customerName, points, true);
    }
    saveStore(store);
    broadcastEvent('job_updated', sanitizeJobForPublic(job));
    res.json({ job: sanitizeJobForPublic(job), balance: job.loyaltyCustomerBalance || 0 });
  });

  app.post('/api/webhook/payment', (req, res) => {
    const secret = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      res.status(503).json({ error: 'PAYMENT_WEBHOOK_SECRET is not configured on server.' });
      return;
    }
    const provided = String(req.headers['x-webhook-secret'] || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }

    const { jobId, utrNumber } = req.body as { jobId?: string; utrNumber?: string };
    const job = store.jobs.find((j) => j.id === jobId || j.code === jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const shop = resolveShop(job.shopId);
    job.paymentStatus = 'paid';
    job.paymentMethod = 'webhook';
    job.utrNumber = String(utrNumber || `WH-${Date.now()}`).slice(0, 40);
    job.paidAt = new Date().toISOString();
    job.printStatus = 'queued';
    saveStore(store);
    broadcastEvent('job_updated', sanitizeJobForPublic(job));

    if (shop.settings.payment.autoPrintOnPayment) {
      triggerAutoPrintPipeline(job.id);
    }

    res.json({ ok: true, jobId: job.id, status: job.printStatus });
  });

  // Meta WhatsApp Cloud API Webhook
  app.get('/api/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    const expected = (process.env.WHATSAPP_VERIFY_TOKEN || '').trim();

    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  });

  app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
      const body = req.body as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              metadata?: { display_phone_number?: string };
              contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
              messages?: Array<{
                from?: string;
                type?: string;
                text?: { body?: string };
                document?: { filename?: string; mime_type?: string; caption?: string };
                image?: { mime_type?: string; caption?: string };
              }>;
            };
          }>;
        }>;
      };

      const change = body.entry?.[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      if (!msg || !msg.from) {
        res.status(200).json({ received: true });
        return;
      }

      // Match receiving WhatsApp Business number to Shop
      const receivingDisplay = (change?.metadata?.display_phone_number || '').replace(/[^0-9]/g, '');
      const matchedShop =
        (receivingDisplay &&
          store.shops.find(
            (s) =>
              s.active &&
              s.settings.whatsapp.businessNumber.replace(/[^0-9]/g, '').endsWith(receivingDisplay.slice(-10))
          )) ||
        resolveShop();

      const senderPhone = msg.from;
      const senderName = change?.contacts?.[0]?.profile?.name || 'WhatsApp User';
      const caption = msg.document?.caption || msg.image?.caption || msg.text?.body || '';
      const filename =
        msg.document?.filename || (msg.type === 'image' ? `whatsapp-photo-${Date.now()}.jpg` : '');

      const inboundLog: WhatsAppMessageLog = {
        id: crypto.randomUUID(),
        shopId: matchedShop.id,
        shopName: matchedShop.settings.shopName,
        direction: 'inbound',
        phone: senderPhone,
        senderName,
        text: caption || (filename ? `Sent ${filename}` : 'Message received'),
        attachmentName: filename || undefined,
        timestamp: new Date().toISOString(),
      };
      store.whatsappLogs.unshift(inboundLog);
      broadcastEvent('whatsapp_log', { ...inboundLog, phone: maskPhone(inboundLog.phone) });

      if (filename) {
        const ext = path.extname(filename).toLowerCase() || '.pdf';
        const options = parseWhatsAppCaptionOptions(caption, matchedShop.settings.whatsapp.defaultColorMode);
        const pricingBreakdown = computePricing(1, options, matchedShop.settings);
        const id = crypto.randomUUID();
        const code = generateJobCode();
        const pin = generatePin();
        const storedFilename = `${crypto.randomUUID()}${ext}`;
        const placeholderText = `WhatsApp Print Job ${code}\nShop: ${matchedShop.settings.shopName}\nSender: ${senderName}\nFile: ${filename}`;
        fs.writeFileSync(resolveUploadPath(storedFilename), placeholderText, 'utf8');

        const job: PrintJob = {
          id,
          shopId: matchedShop.id,
          shopName: matchedShop.settings.shopName,
          code,
          pin,
          source: 'whatsapp',
          customerName: senderName,
          customerPhone: senderPhone,
          originalFilename: filename,
          storedFilename,
          mimeType: msg.document?.mime_type || msg.image?.mime_type || 'application/pdf',
          fileExtension: ext,
          fileSizeBytes: Buffer.byteLength(placeholderText),
          detectedPages: 1,
          printablePages: 1,
          options,
          pricingBreakdown,
          paymentStatus: 'pending',
          upiUri: buildUpiUri(id, code, pricingBreakdown.totalAmount, matchedShop.settings),
          printStatus: 'awaiting_payment',
          assignedPrinter: pickAssignedPrinter(options, matchedShop.settings),
          createdAt: new Date().toISOString(),
          notes: `WhatsApp: ${caption || 'Default print'}`,
          loyaltyPointsEarned: computeJobLoyaltyPoints(
            1,
            options.copies,
            pricingBreakdown.totalAmount,
            matchedShop.settings.loyalty
          ),
          loyaltyAwarded: false,
        };

        store.jobs.unshift(job);
        const payLink = `${getAppBaseUrl(req)}/?shop=${matchedShop.slug}&job=${job.code}`;
        const replyText = `[${matchedShop.settings.shopName}] Job ${job.code} (PIN: ${job.pin}) ready! Total: INR ${job.pricingBreakdown.totalAmount}. Pay & auto-print here: ${payLink}`;

        const outboundLog: WhatsAppMessageLog = {
          id: crypto.randomUUID(),
          shopId: matchedShop.id,
          shopName: matchedShop.settings.shopName,
          direction: 'outbound',
          phone: senderPhone,
          senderName: matchedShop.settings.shopName,
          text: replyText,
          jobId: job.id,
          jobCode: job.code,
          timestamp: new Date().toISOString(),
        };
        store.whatsappLogs.unshift(outboundLog);
        saveStore(store);

        broadcastEvent('job_created', sanitizeJobForPublic(job));
        broadcastEvent('whatsapp_log', { ...outboundLog, phone: maskPhone(outboundLog.phone) });

        if (matchedShop.settings.whatsapp.autoReplyOnUpload) {
          await sendWhatsAppReply(senderPhone, replyText);
        }
      } else {
        const outboundLog: WhatsAppMessageLog = {
          id: crypto.randomUUID(),
          shopId: matchedShop.id,
          shopName: matchedShop.settings.shopName,
          direction: 'outbound',
          phone: senderPhone,
          senderName: matchedShop.settings.shopName,
          text: matchedShop.settings.whatsapp.welcomeMessage,
          timestamp: new Date().toISOString(),
        };
        store.whatsappLogs.unshift(outboundLog);
        saveStore(store);
        broadcastEvent('whatsapp_log', { ...outboundLog, phone: maskPhone(outboundLog.phone) });
        await sendWhatsAppReply(senderPhone, matchedShop.settings.whatsapp.welcomeMessage);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error('WhatsApp webhook error:', err);
      res.status(500).json({ error: 'Webhook processing error' });
    }
  });

  app.post('/api/whatsapp/simulate', upload.single('file'), async (req, res) => {
    try {
      const shop = resolveShop(String(req.body.shopId || ''));
      if (!shop.settings.whatsapp.enabled) {
        res.status(400).json({ error: 'WhatsApp print service is currently paused for this shop.' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Attach a document or image to simulate incoming WhatsApp print.' });
        return;
      }

      const senderPhone = String(req.body.phone || '+919811223344').trim().slice(0, 20);
      const senderName = String(req.body.name || 'WhatsApp Customer').trim().slice(0, 60);
      const caption = String(req.body.caption || 'Color 1 copy').trim().slice(0, 200);

      const originalFilename = path.basename(file.originalname || 'whatsapp-doc.pdf');
      const ext = path.extname(originalFilename).toLowerCase() || '.pdf';
      const allowed = shop.settings.formats.allowedExtensions.map((e) => e.toLowerCase());
      if (!allowed.includes(ext)) {
        res.status(400).json({ error: `Unsupported format (${ext})` });
        return;
      }

      const storedFilename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(resolveUploadPath(storedFilename), file.buffer);

      const detectedPages = await detectPageCount(file.buffer, ext);
      const options = parseWhatsAppCaptionOptions(caption, shop.settings.whatsapp.defaultColorMode);
      const pricingBreakdown = computePricing(detectedPages, options, shop.settings);

      const id = crypto.randomUUID();
      const code = generateJobCode();
      const pin = generatePin();

      const job: PrintJob = {
        id,
        shopId: shop.id,
        shopName: shop.settings.shopName,
        code,
        pin,
        source: 'whatsapp',
        customerName: senderName,
        customerPhone: senderPhone,
        originalFilename,
        storedFilename,
        mimeType: file.mimetype || 'application/octet-stream',
        fileExtension: ext,
        fileSizeBytes: file.size,
        detectedPages,
        printablePages: detectedPages,
        options,
        pricingBreakdown,
        paymentStatus: 'pending',
        upiUri: buildUpiUri(id, code, pricingBreakdown.totalAmount, shop.settings),
        printStatus: 'awaiting_payment',
        assignedPrinter: pickAssignedPrinter(options, shop.settings),
        createdAt: new Date().toISOString(),
        notes: `WhatsApp caption: "${caption}"`,
        loyaltyPointsEarned: computeJobLoyaltyPoints(
          detectedPages,
          options.copies,
          pricingBreakdown.totalAmount,
          shop.settings.loyalty
        ),
        loyaltyAwarded: false,
      };

      const inboundLog: WhatsAppMessageLog = {
        id: crypto.randomUUID(),
        shopId: shop.id,
        shopName: shop.settings.shopName,
        direction: 'inbound',
        phone: senderPhone,
        senderName,
        text: caption,
        attachmentName: originalFilename,
        jobId: job.id,
        jobCode: job.code,
        timestamp: new Date().toISOString(),
      };

      const payLink = `${getAppBaseUrl(req)}/?shop=${shop.slug}&job=${job.code}`;
      const replyText = `[${shop.settings.shopName}] Job ${job.code} (PIN: ${job.pin}) · ${detectedPages}p · ${
        options.colorMode === 'color' ? 'Color' : 'B&W'
      } × ${options.copies} · Total ₹${pricingBreakdown.totalAmount}. Scan QR or open ${payLink} to pay & auto-print.`;

      const outboundLog: WhatsAppMessageLog = {
        id: crypto.randomUUID(),
        shopId: shop.id,
        shopName: shop.settings.shopName,
        direction: 'outbound',
        phone: senderPhone,
        senderName: shop.settings.shopName,
        text: replyText,
        jobId: job.id,
        jobCode: job.code,
        timestamp: new Date().toISOString(),
      };

      store.jobs.unshift(job);
      store.whatsappLogs.unshift(outboundLog, inboundLog);
      saveStore(store);

      broadcastEvent('job_created', sanitizeJobForPublic(job));
      broadcastEvent('whatsapp_log', { ...inboundLog, phone: maskPhone(inboundLog.phone) });
      broadcastEvent('whatsapp_log', { ...outboundLog, phone: maskPhone(outboundLog.phone) });

      const qrDataUrl = await QRCode.toDataURL(job.upiUri, {
        width: 300,
        margin: 2,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });

      res.status(201).json({
        job: sanitizeJobForPublic(job),
        qrDataUrl,
        replyText,
      });
    } catch (err) {
      console.error('WhatsApp simulation error:', err);
      res.status(500).json({ error: 'Failed to process WhatsApp document.' });
    }
  });

  app.get('/api/whatsapp/logs', (req, res) => {
    const token = extractBearerToken(req);
    const isAdmin = token ? verifySessionToken(token) : false;
    const shopParam = String(req.query.shop || '').trim();
    const targetShop = shopParam ? resolveShop(shopParam) : null;
    const filtered = targetShop
      ? store.whatsappLogs.filter((l) => l.shopId === targetShop.id)
      : store.whatsappLogs;
    const logs = filtered.slice(0, 30).map((log) => ({
      ...log,
      phone: isAdmin ? log.phone : maskPhone(log.phone),
    }));
    res.json({ logs });
  });

  // ---- Print Agent Routes (Windows & Android Clients using X-Agent-Key) ----
  app.get('/api/agent/pending', (req, res) => {
    const shop = verifyShopAgentKey(req);
    if (!shop) {
      res.status(401).json({ error: 'Invalid or missing X-Agent-Key' });
      return;
    }
    const requestedShopId = String(req.query.shopId || shop.id);
    if (requestedShopId !== shop.id) {
      res.status(403).json({ error: 'Agent key is not authorized for this shop.' });
      return;
    }
    const pendingJobs = store.jobs.filter(
      (j) => j.shopId === shop.id && j.paymentStatus === 'paid' && j.printStatus === 'queued'
    );
    res.json({ shopId: shop.id, shopName: shop.settings.shopName, jobs: pendingJobs });
  });

  app.get('/api/agent/jobs/:id/file', (req, res) => {
    const shop = verifyShopAgentKey(req);
    if (!shop) {
      res.status(401).json({ error: 'Invalid or missing X-Agent-Key' });
      return;
    }
    const job = store.jobs.find((j) => j.id === req.params.id && j.shopId === shop.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found for this shop.' });
      return;
    }
    try {
      const filePath = resolveUploadPath(job.storedFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Stored file not found.' });
        return;
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', job.mimeType || 'application/octet-stream');
      res.sendFile(filePath);
    } catch {
      res.status(403).json({ error: 'Invalid path' });
    }
  });

  app.post('/api/agent/jobs/:id/status', (req, res) => {
    const shop = verifyShopAgentKey(req);
    if (!shop) {
      res.status(401).json({ error: 'Invalid or missing X-Agent-Key' });
      return;
    }
    const job = store.jobs.find((j) => j.id === req.params.id && j.shopId === shop.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found for this shop.' });
      return;
    }
    const status = req.body?.status === 'error' ? 'error' : 'completed';
    job.printStatus = status;
    if (status === 'completed') {
      job.printedAt = new Date().toISOString();
      const sheetsUsed =
        job.options.sides === 'double'
          ? Math.ceil((job.printablePages * job.options.copies) / 2)
          : job.printablePages * job.options.copies;
      shop.settings.printers.paperTrayRemaining = Math.max(
        0,
        shop.settings.printers.paperTrayRemaining - sheetsUsed
      );
      awardLoyaltyPointsForJob(job);
    }
    saveStore(store);
    broadcastEvent('job_updated', sanitizeJobForPublic(job));
    res.json({ ok: true, job: sanitizeJobForPublic(job) });
  });

  // ---- Admin Auth Routes ----
  app.get('/api/auth/status', (req, res) => {
    const envControlled = getEnvPasscode().length > 0;
    const configured = envControlled || store.adminAuth !== null;
    const token = extractBearerToken(req);
    const authenticated = token ? verifySessionToken(token) : false;
    res.json({ configured, envControlled, authenticated });
  });

  app.post('/api/auth/setup', (req, res) => {
    if (getEnvPasscode().length > 0) {
      res.status(409).json({ error: 'Admin passcode is managed by server environment variables.' });
      return;
    }
    if (store.adminAuth !== null) {
      res.status(409).json({ error: 'Admin passcode is already claimed. Please sign in.' });
      return;
    }
    const passcode = String(req.body?.passcode || '').trim();
    if (passcode.length < 4 || passcode.length > 64) {
      res.status(400).json({ error: 'Passcode must be between 4 and 64 characters.' });
      return;
    }
    store.adminAuth = hashPasscode(passcode);
    saveStore(store);
    const token = signSessionToken();
    res.status(201).json({ token });
  });

  app.post('/api/auth/login', (req, res) => {
    const passcode = String(req.body?.passcode || '').trim();
    if (!passcode || !verifyPasscode(passcode)) {
      res.status(401).json({ error: 'Incorrect admin passcode.' });
      return;
    }
    const token = signSessionToken();
    res.json({ token });
  });

  app.post('/api/auth/change-passcode', requireAdmin, (req, res) => {
    if (getEnvPasscode().length > 0) {
      res.status(400).json({ error: 'Cannot change passcode while ADMIN_PASSCODE env variable is set.' });
      return;
    }
    const newPasscode = String(req.body?.newPasscode || '').trim();
    if (newPasscode.length < 4 || newPasscode.length > 64) {
      res.status(400).json({ error: 'New passcode must be 4–64 characters.' });
      return;
    }
    store.adminAuth = hashPasscode(newPasscode);
    saveStore(store);
    res.json({ ok: true });
  });

  // ---- Protected Admin APIs (Multi-Shop & Queue) ----
  app.get('/api/admin/jobs', requireAdmin, (req, res) => {
    const shopFilter = String(req.query.shopId || '').trim();
    const scopedJobs =
      shopFilter && shopFilter !== 'all'
        ? store.jobs.filter((j) => j.shopId === shopFilter)
        : store.jobs;

    const paidJobs = scopedJobs.filter((j) => j.paymentStatus === 'paid');
    const totalRevenue = paidJobs.reduce((acc, j) => acc + j.pricingBreakdown.totalAmount, 0);
    const totalPages = scopedJobs
      .filter((j) => j.printStatus === 'completed')
      .reduce((acc, j) => acc + j.printablePages * j.options.copies, 0);

    const activeShop = shopFilter && shopFilter !== 'all' ? resolveShop(shopFilter) : store.shops[0];

    res.json({
      jobs: scopedJobs,
      shops: store.shops,
      stats: {
        totalJobs: scopedJobs.length,
        paidJobs: paidJobs.length,
        completedJobs: scopedJobs.filter((j) => j.printStatus === 'completed').length,
        pendingJobs: scopedJobs.filter((j) => j.printStatus === 'awaiting_payment').length,
        whatsappJobs: scopedJobs.filter((j) => j.source === 'whatsapp').length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalPagesPrinted: totalPages,
      },
      settings: activeShop.settings,
    });
  });

  app.get('/api/admin/analytics', requireAdmin, (req, res) => {
    const rawDays = Number(req.query.days || 14);
    const days = rawDays === 7 || rawDays === 30 ? rawDays : 14;
    const shopFilter = String(req.query.shopId || 'all').trim() || 'all';

    const palette = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];

    const toDateKey = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const formatDayLabel = (date: Date) =>
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayBuckets: Array<{
      dateKey: string;
      label: string;
      bwPages: number;
      colorPages: number;
      totalPages: number;
      jobsCount: number;
      revenue: number;
    }> = [];
    const dayIndexMap = new Map<string, number>();

    const trendBuckets: Array<Record<string, number | string>> = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateKey = toDateKey(d);
      const label = formatDayLabel(d);
      dayIndexMap.set(dateKey, dayBuckets.length);
      dayBuckets.push({
        dateKey,
        label,
        bwPages: 0,
        colorPages: 0,
        totalPages: 0,
        jobsCount: 0,
        revenue: 0,
      });
      const trendEntry: Record<string, number | string> = { dateKey, label };
      for (const shop of store.shops) {
        trendEntry[shop.id] = 0;
      }
      trendBuckets.push(trendEntry);
    }

    const peakHours = Array.from({ length: 24 }, (_, hour) => {
      const h12 = hour % 12 === 0 ? 12 : hour % 12;
      const suffix = hour < 12 ? 'a' : 'p';
      return {
        hour,
        hourLabel: `${String(hour).padStart(2, '0')}:00`,
        shortHour: `${h12}${suffix}`,
        jobsCount: 0,
        pagesCount: 0,
        revenue: 0,
        bwJobs: 0,
        colorJobs: 0,
      };
    });

    const shopAccumulator = new Map<
      string,
      { totalRevenue: number; totalJobs: number; totalPages: number; whatsappJobs: number }
    >();
    for (const shop of store.shops) {
      shopAccumulator.set(shop.id, {
        totalRevenue: 0,
        totalJobs: 0,
        totalPages: 0,
        whatsappJobs: 0,
      });
    }

    let summaryRevenue = 0;
    let summaryJobs = 0;
    let summaryPaidJobs = 0;
    let summaryBwPages = 0;
    let summaryColorPages = 0;

    for (const job of store.jobs) {
      const createdDate = new Date(job.createdAt);
      if (Number.isNaN(createdDate.getTime())) continue;

      const createdKey = toDateKey(createdDate);
      const createdBucketIdx = dayIndexMap.get(createdKey);
      const pages =
        job.printStatus === 'cancelled'
          ? 0
          : Math.max(0, job.printablePages * Math.max(1, job.options.copies));

      const paidDate = new Date(job.paidAt || job.createdAt);
      const paidKey = Number.isNaN(paidDate.getTime()) ? createdKey : toDateKey(paidDate);
      const paidBucketIdx = dayIndexMap.get(paidKey);

      const isPaid = job.paymentStatus === 'paid';
      const amount = isPaid ? job.pricingBreakdown.totalAmount : 0;

      // Update per-shop totals and multi-shop revenue trend (for jobs inside the selected day window)
      if (createdBucketIdx !== undefined) {
        const sAcc = shopAccumulator.get(job.shopId);
        if (sAcc) {
          sAcc.totalJobs += 1;
          sAcc.totalPages += pages;
          if (job.source === 'whatsapp') sAcc.whatsappJobs += 1;
        }
      }
      if (isPaid && paidBucketIdx !== undefined) {
        const sAcc = shopAccumulator.get(job.shopId);
        if (sAcc) {
          sAcc.totalRevenue += amount;
        }
        const trendPoint = trendBuckets[paidBucketIdx];
        if (trendPoint && typeof trendPoint[job.shopId] === 'number') {
          trendPoint[job.shopId] =
            Math.round(((trendPoint[job.shopId] as number) + amount) * 100) / 100;
        }
      }

      // Scoped metrics (All Shops or single shop filter)
      const matchesScope = shopFilter === 'all' || job.shopId === shopFilter;
      if (!matchesScope) continue;

      if (createdBucketIdx !== undefined) {
        const bucket = dayBuckets[createdBucketIdx];
        bucket.jobsCount += 1;
        if (job.options.colorMode === 'color') {
          bucket.colorPages += pages;
          summaryColorPages += pages;
        } else {
          bucket.bwPages += pages;
          summaryBwPages += pages;
        }
        bucket.totalPages += pages;
        summaryJobs += 1;

        const hr = createdDate.getHours();
        if (peakHours[hr]) {
          peakHours[hr].jobsCount += 1;
          peakHours[hr].pagesCount += pages;
          if (job.options.colorMode === 'color') {
            peakHours[hr].colorJobs += 1;
          } else {
            peakHours[hr].bwJobs += 1;
          }
          if (isPaid) {
            peakHours[hr].revenue = Math.round((peakHours[hr].revenue + amount) * 100) / 100;
          }
        }
      }

      if (isPaid && paidBucketIdx !== undefined) {
        dayBuckets[paidBucketIdx].revenue =
          Math.round((dayBuckets[paidBucketIdx].revenue + amount) * 100) / 100;
        summaryRevenue += amount;
        summaryPaidJobs += 1;
      }
    }

    const totalAllShopRevenue = Array.from(shopAccumulator.values()).reduce(
      (sum, item) => sum + item.totalRevenue,
      0
    );

    const shopsMeta = store.shops.map((shop, idx) => {
      const acc = shopAccumulator.get(shop.id) || {
        totalRevenue: 0,
        totalJobs: 0,
        totalPages: 0,
        whatsappJobs: 0,
      };
      const roundedRev = Math.round(acc.totalRevenue * 100) / 100;
      const sharePercent =
        totalAllShopRevenue > 0
          ? Math.round((roundedRev / totalAllShopRevenue) * 1000) / 10
          : 0;
      return {
        id: shop.id,
        name: shop.settings.shopName,
        slug: shop.slug,
        totalRevenue: roundedRev,
        totalJobs: acc.totalJobs,
        totalPages: acc.totalPages,
        whatsappJobs: acc.whatsappJobs,
        sharePercent,
        color: palette[idx % palette.length],
      };
    });

    const sortedShopsByRev = [...shopsMeta].sort((a, b) => b.totalRevenue - a.totalRevenue);
    const topShop = sortedShopsByRev[0];

    const busiestHour = peakHours.reduce(
      (best, cur) => (cur.jobsCount > best.jobsCount ? cur : best),
      peakHours[0]
    );

    res.json({
      days,
      shopFilter,
      summary: {
        totalRevenue: Math.round(summaryRevenue * 100) / 100,
        totalJobs: summaryJobs,
        paidJobs: summaryPaidJobs,
        totalPages: summaryBwPages + summaryColorPages,
        bwPages: summaryBwPages,
        colorPages: summaryColorPages,
        avgOrderValue:
          summaryPaidJobs > 0 ? Math.round((summaryRevenue / summaryPaidJobs) * 100) / 100 : 0,
        peakHourLabel: busiestHour && busiestHour.jobsCount > 0 ? busiestHour.hourLabel : '—',
        peakHourJobs: busiestHour ? busiestHour.jobsCount : 0,
        topShopName: topShop && topShop.totalRevenue > 0 ? topShop.name : store.shops[0]?.settings.shopName || '—',
        topShopRevenue: topShop ? topShop.totalRevenue : 0,
      },
      dailyVolume: dayBuckets,
      shopsMeta,
      revenueTrendsPerShop: trendBuckets,
      peakHours,
    });
  });

  // Admin-Only: Create New Shop / Branch
  app.post('/api/admin/shops', requireAdmin, (req, res) => {
    const body = req.body as {
      shopName?: string;
      shopAddress?: string;
      shopTagline?: string;
      upiId?: string;
      upiPayeeName?: string;
      whatsappNumber?: string;
      bwPerPage?: number;
      colorPerPage?: number;
      bwPrinterName?: string;
      colorPrinterName?: string;
    };

    const name = String(body.shopName || '').trim().slice(0, 80);
    if (!name) {
      res.status(400).json({ error: 'Shop name is required.' });
      return;
    }

    let baseSlug = slugify(name);
    let uniqueSlug = baseSlug;
    let counter = 2;
    while (store.shops.some((s) => s.slug === uniqueSlug)) {
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    const newShop: ShopConfig = {
      id: `shop-${crypto.randomUUID().slice(0, 8)}`,
      slug: uniqueSlug,
      active: true,
      createdAt: new Date().toISOString(),
      agentKey: crypto.randomBytes(24).toString('hex'),
      settings: mergeSettings({
        shopName: name,
        shopTagline: String(body.shopTagline || DEFAULT_SETTINGS.shopTagline).trim().slice(0, 120),
        shopAddress: String(body.shopAddress || 'New Branch Counter').trim().slice(0, 150),
        pricing: {
          ...DEFAULT_SETTINGS.pricing,
          bwPerPage: Math.max(0.5, Number(body.bwPerPage ?? 2) || 2),
          colorPerPage: Math.max(1, Number(body.colorPerPage ?? 10) || 10),
        },
        payment: {
          ...DEFAULT_SETTINGS.payment,
          upiId: String(body.upiId || 'printflow@upi').trim().slice(0, 80),
          upiPayeeName: String(body.upiPayeeName || name).trim().slice(0, 80),
        },
        printers: {
          ...DEFAULT_SETTINGS.printers,
          bwPrinterName: String(body.bwPrinterName || DEFAULT_SETTINGS.printers.bwPrinterName).trim().slice(0, 80),
          colorPrinterName: String(body.colorPrinterName || DEFAULT_SETTINGS.printers.colorPrinterName).trim().slice(0, 80),
        },
        whatsapp: {
          ...DEFAULT_SETTINGS.whatsapp,
          businessNumber: String(body.whatsappNumber || DEFAULT_SETTINGS.whatsapp.businessNumber).trim().slice(0, 24),
        },
      }),
    };

    store.shops.push(newShop);
    saveStore(store);
    broadcastEvent('settings_updated', { shopId: newShop.id, shopName: newShop.settings.shopName });
    res.status(201).json({ shop: newShop });
  });

  // Admin-Only: Update Shop Active Status or Rotate Agent Key
  app.post('/api/admin/shops/:id/rotate-agent-key', requireAdmin, (req, res) => {
    const shop = store.shops.find((s) => s.id === req.params.id);
    if (!shop) {
      res.status(404).json({ error: 'Shop not found.' });
      return;
    }
    shop.agentKey = crypto.randomBytes(24).toString('hex');
    saveStore(store);
    res.json({ shop });
  });

  app.patch('/api/admin/shops/:id/toggle', requireAdmin, (req, res) => {
    const shop = store.shops.find((s) => s.id === req.params.id);
    if (!shop) {
      res.status(404).json({ error: 'Shop not found.' });
      return;
    }
    const activeCount = store.shops.filter((s) => s.active).length;
    if (shop.active && activeCount <= 1) {
      res.status(400).json({ error: 'At least one shop must remain active.' });
      return;
    }
    shop.active = !shop.active;
    saveStore(store);
    broadcastEvent('settings_updated', { shopId: shop.id });
    res.json({ shop });
  });

  app.delete('/api/admin/shops/:id', requireAdmin, (req, res) => {
    if (store.shops.length <= 1) {
      res.status(400).json({ error: 'Cannot delete the only remaining shop.' });
      return;
    }
    const idx = store.shops.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Shop not found.' });
      return;
    }
    store.shops.splice(idx, 1);
    saveStore(store);
    broadcastEvent('settings_updated', { deletedShopId: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/admin/jobs/:id/action', requireAdmin, (req, res) => {
    const job = store.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const shop = resolveShop(job.shopId);
    const action = String(req.body?.action || '');
    if (action === 'mark_paid') {
      job.paymentStatus = 'paid';
      job.paymentMethod = 'cash_counter';
      job.utrNumber = `CASH-${Date.now().toString().slice(-6)}`;
      job.paidAt = new Date().toISOString();
      job.printStatus = 'queued';
      saveStore(store);
      broadcastEvent('job_updated', sanitizeJobForPublic(job));
      if (shop.settings.payment.autoPrintOnPayment) {
        triggerAutoPrintPipeline(job.id);
      }
    } else if (action === 'print_now' || action === 'reprint') {
      if (job.paymentStatus !== 'paid') {
        job.paymentStatus = 'paid';
        job.paymentMethod = 'cash_counter';
        job.paidAt = new Date().toISOString();
      }
      saveStore(store);
      triggerAutoPrintPipeline(job.id);
    } else if (action === 'mark_completed') {
      job.printStatus = 'completed';
      job.printedAt = new Date().toISOString();
      awardLoyaltyPointsForJob(job);
      saveStore(store);
      broadcastEvent('job_updated', sanitizeJobForPublic(job));
    } else if (action === 'cancel') {
      job.printStatus = 'cancelled';
      saveStore(store);
      broadcastEvent('job_updated', sanitizeJobForPublic(job));
    } else {
      res.status(400).json({ error: 'Unknown admin job action.' });
      return;
    }

    res.json({ job });
  });

  app.delete('/api/admin/jobs/:id', requireAdmin, (req, res) => {
    const idx = store.jobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const [removed] = store.jobs.splice(idx, 1);
    saveStore(store);
    try {
      const filePath = resolveUploadPath(removed.storedFilename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Ignore cleanup errors
    }
    broadcastEvent('job_deleted', { id: removed.id });
    res.json({ ok: true });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const body = req.body as Partial<BusinessSettings> & { shopId?: string };
    const shop = resolveShop(body.shopId);
    const current = shop.settings;

    const updated: BusinessSettings = {
      shopName:
        typeof body.shopName === 'string' && body.shopName.trim()
          ? body.shopName.trim().slice(0, 80)
          : current.shopName,
      shopTagline: typeof body.shopTagline === 'string' ? body.shopTagline.trim().slice(0, 120) : current.shopTagline,
      shopAddress: typeof body.shopAddress === 'string' ? body.shopAddress.trim().slice(0, 150) : current.shopAddress,
      gstNumber: typeof body.gstNumber === 'string' ? body.gstNumber.trim().slice(0, 30) : current.gstNumber,
      pricing: {
        bwPerPage: Math.max(0.5, Number(body.pricing?.bwPerPage ?? current.pricing.bwPerPage) || 2),
        colorPerPage: Math.max(1, Number(body.pricing?.colorPerPage ?? current.pricing.colorPerPage) || 10),
        duplexDiscountPercent: Math.min(
          50,
          Math.max(0, Number(body.pricing?.duplexDiscountPercent ?? current.pricing.duplexDiscountPercent) || 0)
        ),
        a3Multiplier: Math.max(1, Number(body.pricing?.a3Multiplier ?? current.pricing.a3Multiplier) || 2),
        photo4x6Rate: Math.max(1, Number(body.pricing?.photo4x6Rate ?? current.pricing.photo4x6Rate) || 25),
        minOrderAmount: Math.max(0, Number(body.pricing?.minOrderAmount ?? current.pricing.minOrderAmount) || 0),
      },
      payment: {
        upiId:
          typeof body.payment?.upiId === 'string' && body.payment.upiId.trim()
            ? body.payment.upiId.trim().slice(0, 80)
            : current.payment.upiId,
        upiPayeeName:
          typeof body.payment?.upiPayeeName === 'string' && body.payment.upiPayeeName.trim()
            ? body.payment.upiPayeeName.trim().slice(0, 80)
            : current.payment.upiPayeeName,
        autoPrintOnPayment: Boolean(body.payment?.autoPrintOnPayment ?? current.payment.autoPrintOnPayment),
        sandboxInstantPayEnabled: Boolean(
          body.payment?.sandboxInstantPayEnabled ?? current.payment.sandboxInstantPayEnabled
        ),
      },
      printers: {
        bwPrinterName:
          typeof body.printers?.bwPrinterName === 'string' && body.printers.bwPrinterName.trim()
            ? body.printers.bwPrinterName.trim().slice(0, 80)
            : current.printers.bwPrinterName,
        colorPrinterName:
          typeof body.printers?.colorPrinterName === 'string' && body.printers.colorPrinterName.trim()
            ? body.printers.colorPrinterName.trim().slice(0, 80)
            : current.printers.colorPrinterName,
        photoPrinterName:
          typeof body.printers?.photoPrinterName === 'string' && body.printers.photoPrinterName.trim()
            ? body.printers.photoPrinterName.trim().slice(0, 80)
            : current.printers.photoPrinterName,
        bridgeMode:
          body.printers?.bridgeMode === 'ipp_network' || body.printers?.bridgeMode === 'local_agent'
            ? body.printers.bridgeMode
            : 'browser_auto',
        ippEndpoint:
          typeof body.printers?.ippEndpoint === 'string'
            ? body.printers.ippEndpoint.trim().slice(0, 150)
            : current.printers.ippEndpoint,
        paperTrayRemaining: Math.max(
          0,
          Number(body.printers?.paperTrayRemaining ?? current.printers.paperTrayRemaining) || 0
        ),
      },
      whatsapp: {
        enabled: Boolean(body.whatsapp?.enabled ?? current.whatsapp.enabled),
        businessNumber:
          typeof body.whatsapp?.businessNumber === 'string'
            ? body.whatsapp.businessNumber.trim().slice(0, 24)
            : current.whatsapp.businessNumber,
        welcomeMessage:
          typeof body.whatsapp?.welcomeMessage === 'string'
            ? body.whatsapp.welcomeMessage.trim().slice(0, 400)
            : current.whatsapp.welcomeMessage,
        autoReplyOnUpload: Boolean(body.whatsapp?.autoReplyOnUpload ?? current.whatsapp.autoReplyOnUpload),
        defaultColorMode: body.whatsapp?.defaultColorMode === 'color' ? 'color' : 'bw',
      },
      formats: {
        allowedExtensions:
          Array.isArray(body.formats?.allowedExtensions) && body.formats.allowedExtensions.length > 0
            ? body.formats.allowedExtensions
                .map((e) => String(e).toLowerCase().trim())
                .filter((e) => e.startsWith('.'))
            : current.formats.allowedExtensions,
        maxFileSizeMb: Math.min(
          50,
          Math.max(1, Number(body.formats?.maxFileSizeMb ?? current.formats.maxFileSizeMb) || 25)
        ),
        autoDeleteHours: Math.max(
          1,
          Number(body.formats?.autoDeleteHours ?? current.formats.autoDeleteHours) || 24
        ),
      },
      loyalty: {
        enabled: Boolean(body.loyalty?.enabled ?? current.loyalty.enabled),
        earnMode:
          body.loyalty?.earnMode === 'per_page' || body.loyalty?.earnMode === 'per_job'
            ? (body.loyalty.earnMode as LoyaltyEarnMode)
            : 'per_rupee',
        earnRate: Math.max(0, Math.min(1000, Number(body.loyalty?.earnRate ?? current.loyalty.earnRate) || 0)),
      },
    };

    shop.settings = updated;
    saveStore(store);
    broadcastEvent('settings_updated', { shopId: shop.id, shopName: updated.shopName });
    res.json({ settings: updated, shop });
  });

  app.get('/api/admin/integration-status', requireAdmin, (req, res) => {
    const baseUrl = getAppBaseUrl(req);
    res.json({
      whatsappTokenSet: Boolean((process.env.WHATSAPP_ACCESS_TOKEN || '').trim()),
      whatsappVerifySet: Boolean((process.env.WHATSAPP_VERIFY_TOKEN || '').trim()),
      whatsappPhoneIdSet: Boolean((process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()),
      paymentSecretSet: Boolean((process.env.PAYMENT_WEBHOOK_SECRET || '').trim()),
      adminEnvOverride: getEnvPasscode().length > 0,
      webhookUrl: `${baseUrl}/api/webhook/whatsapp`,
      paymentWebhookUrl: `${baseUrl}/api/webhook/payment`,
    });
  });

  app.get('/api/admin/php-installer', requireAdmin, (_req, res) => {
    const installerPath = path.resolve(ROOT_DIR, 'php-installer', 'install.php');
    if (!fs.existsSync(installerPath)) {
      res.status(404).json({ error: 'PHP installer script not found.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/x-php; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="install.php"');
    res.sendFile(installerPath);
  });

  // Zero-dependency PKZIP archive builder for one-click cPanel public_html deployment bundle
  const buildZipArchive = (entries: Array<{ name: string; data: Buffer }>): Buffer => {
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c >>> 0;
    }
    const calcCrc32 = (buf: Buffer): number => {
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
      const normalizedName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
      const nameBuf = Buffer.from(normalizedName, 'utf8');
      const rawBuf = entry.data;
      const compressed = zlib.deflateRawSync(rawBuf);
      const useDeflate = compressed.length < rawBuf.length;
      const payload = useDeflate ? compressed : rawBuf;
      const method = useDeflate ? 8 : 0;
      const crc = calcCrc32(rawBuf);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(payload.length, 18);
      localHeader.writeUInt32LE(rawBuf.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      localParts.push(localHeader, nameBuf, payload);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(method, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(payload.length, 20);
      centralHeader.writeUInt32LE(rawBuf.length, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);

      centralParts.push(centralHeader, nameBuf);
      offset += localHeader.length + nameBuf.length + payload.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, ...centralParts, eocd]);
  };

  app.get('/api/admin/cpanel-package', requireAdmin, (req, res) => {
    const mode = String(req.query.mode || 'php').trim();
    const distDir = path.resolve(ROOT_DIR, 'dist');
    const distIndex = path.resolve(distDir, 'index.html');
    const distServerEntry = path.resolve(ROOT_DIR, 'dist-server', 'server.mjs');

    if (!fs.existsSync(distIndex) || (mode === 'npm-full' && !fs.existsSync(distServerEntry))) {
      try {
        execSync('npm run build', { cwd: ROOT_DIR, stdio: 'pipe', timeout: 120000 });
      } catch (err) {
        res.status(500).json({
          error: `Automatic production build failed: ${err instanceof Error ? err.message : 'Build error'}`,
        });
        return;
      }
    }

    if (!fs.existsSync(distIndex)) {
      res.status(500).json({
        error: 'Production build (dist/index.html) could not be generated.',
      });
      return;
    }

    const entries: Array<{ name: string; data: Buffer }> = [];
    const seen = new Set<string>();
    const addEntry = (zipName: string, filePath: string) => {
      const normalized = zipName.replace(/\\/g, '/').replace(/^\/+/, '');
      if (seen.has(normalized) || !fs.existsSync(filePath)) return;
      seen.add(normalized);
      entries.push({ name: normalized, data: fs.readFileSync(filePath) });
    };
    const walkIntoZip = (dir: string, prefix = '') => {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dev-dist' || item.name === 'aistudio') continue;
        const fullPath = path.join(dir, item.name);
        const relPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          walkIntoZip(fullPath, relPath);
        } else if (item.isFile()) {
          addEntry(relPath, fullPath);
        }
      }
    };

    if (mode === 'npm-full') {
      // Full cPanel Node.js + NPM package (also includes dist/, install.php, and .htaccess)
      for (const rootFile of [
        'package.json',
        'package-lock.json',
        '.npmrc',
        'app.cjs',
        '.env.example',
        'index.html',
        'server.ts',
        'tsconfig.json',
        'vite.config.ts',
        'metadata.json',
      ]) {
        addEntry(rootFile, path.resolve(ROOT_DIR, rootFile));
      }
      addEntry('.htaccess', path.resolve(ROOT_DIR, 'public', '.htaccess'));
      addEntry('install.php', path.resolve(ROOT_DIR, 'php-installer', 'install.php'));
      walkIntoZip(path.resolve(ROOT_DIR, 'src'), 'src');
      walkIntoZip(path.resolve(ROOT_DIR, 'public'), 'public');
      walkIntoZip(distDir, 'dist');
      walkIntoZip(path.resolve(ROOT_DIR, 'dist-server'), 'dist-server');
      walkIntoZip(path.resolve(ROOT_DIR, 'php-installer'), 'php-installer');
      walkIntoZip(path.resolve(ROOT_DIR, 'windows-client'), 'windows-client');
      walkIntoZip(path.resolve(ROOT_DIR, 'android-client'), 'android-client');
    } else {
      // Ready-to-run cPanel Shared PHP Hosting (public_html/) package
      walkIntoZip(distDir);
      addEntry('.htaccess', path.resolve(ROOT_DIR, 'public', '.htaccess'));
      addEntry('install.php', path.resolve(ROOT_DIR, 'php-installer', 'install.php'));
      walkIntoZip(path.resolve(ROOT_DIR, 'windows-client'), 'windows-client');
      walkIntoZip(path.resolve(ROOT_DIR, 'android-client'), 'android-client');
    }

    const readme = [
      'PrintFlow AutoPrint — cPanel Deployment Guide',
      '==============================================',
      '',
      'OPTION A: cPanel Shared PHP Hosting (public_html/)',
      '--------------------------------------------------',
      '1. Upload and extract PrintFlow-cPanel-public_html.zip into public_html/ (or a subfolder).',
      '   Make sure hidden files (.htaccess) are visible/extracted.',
      '2. Visit https://your-domain.com/install.php in your browser.',
      '   Note: If you extracted the Full NPM ZIP into public_html/, install.php will automatically',
      '   deploy the compiled dist/ files to the web root so the index page renders cleanly.',
      '3. Choose SQLite (zero-config) or MySQL/MariaDB, enter Shop & Admin Passcode, and click Install.',
      '4. Delete install.php after installation completes.',
      '',
      'OPTION B: cPanel "Setup Node.js App" (NPM Files Included)',
      '----------------------------------------------------------',
      '1. Extract PrintFlow-cPanel-NodeJS-NPM.zip into your Node application root (e.g. /home/user/printflow).',
      '2. Click "Run NPM Install" in cPanel (uses package.json, package-lock.json & .npmrc).',
      '3. Set Application Startup File to: app.cjs',
      '4. Set NODE_ENV=production and SESSION_SECRET (min 16 chars) in cPanel Env Vars.',
      '5. Restart the Node app in cPanel (dist/ and dist-server/server.mjs are already pre-built!).',
      '',
    ].join('\r\n');
    entries.push({ name: 'CPANEL-README.txt', data: Buffer.from(readme, 'utf8') });

    const zipBuffer = buildZipArchive(entries);
    const zipFilename =
      mode === 'npm-full'
        ? 'PrintFlow-cPanel-NodeJS-NPM.zip'
        : 'PrintFlow-cPanel-public_html.zip';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.send(zipBuffer);
  });

  // Download pre-configured Windows Installation Client (.ps1) for a specific shop
  app.get('/api/admin/clients/windows', requireAdmin, (req, res) => {
    const templatePath = path.resolve(ROOT_DIR, 'windows-client', 'PrintFlow-Windows-Setup.ps1');
    if (!fs.existsSync(templatePath)) {
      res.status(404).json({ error: 'Windows client template not found.' });
      return;
    }
    const shop = resolveShop(String(req.query.shopId || ''));
    const baseUrl = getAppBaseUrl(req);

    const script = fs
      .readFileSync(templatePath, 'utf8')
      .replace('__SERVER_URL__', sanitizePowerShellLiteral(baseUrl))
      .replace('__SHOP_ID__', sanitizePowerShellLiteral(shop.id))
      .replace('__SHOP_NAME__', sanitizePowerShellLiteral(shop.settings.shopName))
      .replace('__AGENT_KEY__', sanitizePowerShellLiteral(shop.agentKey))
      .replace('__BW_PRINTER__', sanitizePowerShellLiteral(shop.settings.printers.bwPrinterName))
      .replace('__COLOR_PRINTER__', sanitizePowerShellLiteral(shop.settings.printers.colorPrinterName));

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="PrintFlow-${shop.slug}-Windows-Setup.ps1"`
    );
    res.send(script);
  });

  // Download pre-configured Android Client MainActivity.kt (or build manifest) for a specific shop
  app.get('/api/admin/clients/android', requireAdmin, (req, res) => {
    const fileType = String(req.query.file || 'activity');
    const shop = resolveShop(String(req.query.shopId || ''));
    const baseUrl = getAppBaseUrl(req);
    const shopUrl = `${baseUrl}/?shop=${encodeURIComponent(shop.slug)}`;

    if (fileType === 'manifest') {
      const manifestPath = path.resolve(ROOT_DIR, 'android-client', 'AndroidManifest.xml');
      const content = fs
        .readFileSync(manifestPath, 'utf8')
        .replace('__SHOP_NAME__', shop.settings.shopName.replace(/[<>&"]/g, ''));
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="AndroidManifest.xml"');
      res.send(content);
      return;
    }

    if (fileType === 'gradle') {
      const gradlePath = path.resolve(ROOT_DIR, 'android-client', 'build.gradle.kts');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="build.gradle.kts"');
      res.sendFile(gradlePath);
      return;
    }

    const ktPath = path.resolve(ROOT_DIR, 'android-client', 'MainActivity.kt');
    const content = fs
      .readFileSync(ktPath, 'utf8')
      .replace('__SHOP_URL__', shopUrl.replace(/["\\\r\n]/g, ''));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="MainActivity-${shop.slug}.kt"`);
    res.send(content);
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    const indexHtmlPath = path.resolve(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      if (!fs.existsSync(indexHtmlPath)) {
        res.status(503).send('PrintFlow frontend build (dist/index.html) missing. Run npm run build.');
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  }

  const isPassenger = Boolean(process.env.PASSENGER_APP_ENV || process.env.IN_PASSENGER);
  if (isPassenger) {
    httpServer.listen(PORT, () => {
      console.log(`PrintFlow AutoPrint running under Phusion Passenger (port ${PORT})`);
    });
  } else {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`PrintFlow AutoPrint server running on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
