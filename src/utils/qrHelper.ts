import QRCode from 'qrcode';
import { apiUrl } from './api';

export async function generateQrDataUrl(text: string, width = 320): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      width,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
  } catch {
    try {
      const res = await fetch(apiUrl(`/api/qr-image?text=${encodeURIComponent(text)}`));
      if (res.ok) {
        const data = await res.json();
        return data.dataUrl || '';
      }
    } catch {
      // Ignore fallback error
    }
    return '';
  }
}
