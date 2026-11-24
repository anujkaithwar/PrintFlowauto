export type Language = 'hi' | 'en';

export type AppTab = 'print' | 'whatsapp' | 'kiosk' | 'admin';

export type ColorMode = 'bw' | 'color';
export type PaperSize = 'A4' | 'A3' | 'Letter' | 'Legal' | 'Photo_4x6';
export type PrintSides = 'single' | 'double';
export type PrintOrientation = 'auto' | 'portrait' | 'landscape';
export type JobSource = 'kiosk_qr' | 'web_upload' | 'whatsapp';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PrintStatus = 'awaiting_payment' | 'queued' | 'printing' | 'completed' | 'cancelled' | 'error';
export type LoyaltyEarnMode = 'per_rupee' | 'per_page' | 'per_job';

export interface LoyaltyAccount {
  phone: string;
  customerName: string;
  points: number;
  totalJobsCompleted: number;
  totalEarned: number;
  updatedAt: string;
}

export interface PrintOptions {
  colorMode: ColorMode;
  paperSize: PaperSize;
  sides: PrintSides;
  copies: number;
  pageRange: string;
  orientation: PrintOrientation;
}

export interface PricingBreakdown {
  unitRate: number;
  multiplier: number;
  duplexDiscount: number;
  subtotal: number;
  totalAmount: number;
  currency: string;
}

export interface PrintJob {
  id: string;
  shopId: string;
  shopName: string;
  code: string;
  pin: string;
  source: JobSource;
  customerName: string;
  customerPhone: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  fileExtension: string;
  fileSizeBytes: number;
  detectedPages: number;
  printablePages: number;
  options: PrintOptions;
  pricingBreakdown: PricingBreakdown;
  paymentStatus: PaymentStatus;
  paymentMethod?: 'upi_qr' | 'upi_sandbox' | 'cash_counter' | 'webhook';
  utrNumber?: string;
  upiUri: string;
  printStatus: PrintStatus;
  assignedPrinter: string;
  createdAt: string;
  paidAt?: string;
  printedAt?: string;
  notes?: string;
  loyaltyPointsEarned?: number;
  loyaltyAwarded?: boolean;
  loyaltyCustomerBalance?: number;
}

export interface WhatsAppMessageLog {
  id: string;
  shopId: string;
  shopName: string;
  direction: 'inbound' | 'outbound';
  phone: string;
  senderName: string;
  text: string;
  attachmentName?: string;
  jobId?: string;
  jobCode?: string;
  timestamp: string;
}

export interface BusinessSettings {
  shopName: string;
  shopTagline: string;
  shopAddress: string;
  gstNumber: string;
  pricing: {
    bwPerPage: number;
    colorPerPage: number;
    duplexDiscountPercent: number;
    a3Multiplier: number;
    photo4x6Rate: number;
    minOrderAmount: number;
  };
  payment: {
    upiId: string;
    upiPayeeName: string;
    autoPrintOnPayment: boolean;
    sandboxInstantPayEnabled: boolean;
  };
  printers: {
    bwPrinterName: string;
    colorPrinterName: string;
    photoPrinterName: string;
    bridgeMode: 'browser_auto' | 'ipp_network' | 'local_agent';
    ippEndpoint: string;
    paperTrayRemaining: number;
  };
  whatsapp: {
    enabled: boolean;
    businessNumber: string;
    welcomeMessage: string;
    autoReplyOnUpload: boolean;
    defaultColorMode: ColorMode;
  };
  formats: {
    allowedExtensions: string[];
    maxFileSizeMb: number;
    autoDeleteHours: number;
  };
  loyalty: {
    enabled: boolean;
    earnMode: LoyaltyEarnMode;
    earnRate: number;
  };
}

export interface ShopConfig {
  id: string;
  slug: string;
  active: boolean;
  createdAt: string;
  agentKey: string;
  settings: BusinessSettings;
}

export interface PublicShopSummary {
  id: string;
  slug: string;
  shopName: string;
  shopAddress: string;
  upiId: string;
  whatsappNumber: string;
  whatsappEnabled: boolean;
}

export interface PublicConfig {
  shopId: string;
  shopSlug: string;
  shopName: string;
  shopTagline: string;
  shopAddress: string;
  pricing: BusinessSettings['pricing'];
  payment: {
    upiId: string;
    upiPayeeName: string;
    autoPrintOnPayment: boolean;
    sandboxInstantPayEnabled: boolean;
  };
  printers: {
    bwPrinterName: string;
    colorPrinterName: string;
    photoPrinterName: string;
    bridgeMode: BusinessSettings['printers']['bridgeMode'];
    paperTrayRemaining: number;
  };
  whatsapp: {
    enabled: boolean;
    businessNumber: string;
    defaultColorMode: ColorMode;
  };
  formats: BusinessSettings['formats'];
  loyalty: BusinessSettings['loyalty'];
  shops: PublicShopSummary[];
}

export interface AuthStatus {
  configured: boolean;
  envControlled: boolean;
  authenticated: boolean;
}

export interface IntegrationStatus {
  whatsappTokenSet: boolean;
  whatsappVerifySet: boolean;
  whatsappPhoneIdSet: boolean;
  paymentSecretSet: boolean;
  adminEnvOverride: boolean;
  webhookUrl: string;
  paymentWebhookUrl: string;
}

export interface DailyVolumePoint {
  dateKey: string;
  label: string;
  bwPages: number;
  colorPages: number;
  totalPages: number;
  jobsCount: number;
  revenue: number;
}

export interface ShopTrendMeta {
  id: string;
  name: string;
  slug: string;
  totalRevenue: number;
  totalJobs: number;
  totalPages: number;
  whatsappJobs: number;
  sharePercent: number;
  color: string;
}

export type ShopRevenueTrendPoint = {
  dateKey: string;
  label: string;
} & Record<string, number | string>;

export interface PeakHourPoint {
  hour: number;
  hourLabel: string;
  shortHour: string;
  jobsCount: number;
  pagesCount: number;
  revenue: number;
  bwJobs: number;
  colorJobs: number;
}

export interface AdminAnalyticsResponse {
  days: number;
  shopFilter: string;
  summary: {
    totalRevenue: number;
    totalJobs: number;
    paidJobs: number;
    totalPages: number;
    bwPages: number;
    colorPages: number;
    avgOrderValue: number;
    peakHourLabel: string;
    peakHourJobs: number;
    topShopName: string;
    topShopRevenue: number;
  };
  dailyVolume: DailyVolumePoint[];
  shopsMeta: ShopTrendMeta[];
  revenueTrendsPerShop: ShopRevenueTrendPoint[];
  peakHours: PeakHourPoint[];
}

