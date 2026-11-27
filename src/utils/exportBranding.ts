import type { CompanyWorkspace } from '../types';
import { apiFetch } from './apiClient';

export interface ResolvedLogoAsset {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
  dataUri: string;
  width: number;
  height: number;
  docxBytes?: Uint8Array;
  docxType?: 'png' | 'jpg';
}

export interface ExportBrandOptions {
  companyId?: string;
  companyName?: string;
  logoUrl?: string | null;
  primaryColour?: string | null;
  secondaryColour?: string | null;
  logoAsset?: ResolvedLogoAsset;
}

const MAX_LOGO_ASSET_BYTES = 2 * 1024 * 1024;

export function toExportBrandOptions(
  company?: Partial<CompanyWorkspace> | null
): ExportBrandOptions | undefined {
  if (!company) return undefined;
  return {
    companyId: company.id || undefined,
    companyName: company.companyName || undefined,
    logoUrl: company.logoUrl ?? null,
    primaryColour: company.primaryColour || '#052B66',
    secondaryColour: company.secondaryColour || '#45CC42',
  };
}

export function sanitizeBrandHex(input: string | null | undefined, fallback: string): string {
  const clean = String(input || '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9A-Fa-f]{6}$/.test(clean)) {
    return clean.toUpperCase();
  }
  return fallback.replace(/^#/, '').toUpperCase();
}

export function ensureContrastHex(hex6: string, fallback = '052B66'): string {
  const clean = sanitizeBrandHex(hex6, fallback);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Relative perceived brightness; avoid light colors for text/table headers
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? fallback : clean;
}

export function buildCompanyMonogram(companyName?: string): string {
  const words = String(companyName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'eS';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
}

export function detectImageFormatFromBytes(
  bytes: Uint8Array
): { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' } | null {
  if (!bytes || bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: 'image/png', ext: 'png' };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }

  return null;
}

export function parseImageDimensions(
  bytes: Uint8Array,
  ext: 'png' | 'jpg' | 'webp'
): { width: number; height: number } | null {
  try {
    if (ext === 'png' && bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) return { width, height };
    }

    if (ext === 'jpg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        // Standalone markers
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          if (width > 0 && height > 0) return { width, height };
          break;
        }
        if (offset + 3 >= bytes.length) break;
        const segmentLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (segmentLen < 2) break;
        offset += 2 + segmentLen;
      }
    }

    if (ext === 'webp' && bytes.length >= 30) {
      const chunkHeader =
        String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (chunkHeader === 'VP8X' && bytes.length >= 30) {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8 ' && bytes.length >= 30) {
        const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
        const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8L' && bytes.length >= 25) {
        const bits =
          bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        if (width > 0 && height > 0) return { width, height };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = String(base64 || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function createLogoAssetFromBytes(
  bytes: Uint8Array,
  fallbackDims?: { width: number; height: number }
): ResolvedLogoAsset | null {
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_ASSET_BYTES) {
    return null;
  }
  const fmt = detectImageFormatFromBytes(bytes);
  if (!fmt) return null;

  const dims = parseImageDimensions(bytes, fmt.ext) || fallbackDims || { width: 120, height: 48 };
  const dataUri = `data:${fmt.mimeType};base64,${bytesToBase64(bytes)}`;

  return {
    bytes,
    mimeType: fmt.mimeType,
    ext: fmt.ext,
    dataUri,
    width: Math.max(1, dims.width),
    height: Math.max(1, dims.height),
    ...(fmt.ext === 'png' || fmt.ext === 'jpg'
      ? { docxBytes: bytes, docxType: fmt.ext }
      : {}),
  };
}

export function parseDataUriLogoAsset(dataUri: string | null | undefined): ResolvedLogoAsset | null {
  if (!dataUri || typeof dataUri !== 'string') return null;
  const trimmed = dataUri.trim();
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) return null;
  try {
    const bytes = base64ToBytes(match[2]);
    return createLogoAssetFromBytes(bytes);
  } catch {
    return null;
  }
}

export function computeLogoFitDimensions(
  asset: Pick<ResolvedLogoAsset, 'width' | 'height'>,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const natW = Math.max(1, asset.width || maxHeight);
  const natH = Math.max(1, asset.height || maxHeight);
  const ratio = Math.min(maxWidth / natW, maxHeight / natH);
  return {
    width: Math.max(18, Math.round(natW * ratio)),
    height: Math.max(18, Math.round(natH * ratio)),
  };
}

async function convertWebpToPngInBrowser(asset: ResolvedLogoAsset): Promise<ResolvedLogoAsset> {
  if (asset.docxBytes && asset.docxType) return asset;
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return asset;
  }
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.max(1, img.naturalWidth || asset.width || 120);
        const h = Math.max(1, img.naturalHeight || asset.height || 48);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(asset);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const pngDataUrl = canvas.toDataURL('image/png');
        const parsedPng = parseDataUriLogoAsset(pngDataUrl);
        if (parsedPng && parsedPng.docxBytes) {
          resolve({
            ...asset,
            width: w,
            height: h,
            docxBytes: parsedPng.docxBytes,
            docxType: 'png',
          });
          return;
        }
      } catch {
        /* ignore canvas export errors */
      }
      resolve(asset);
    };
    img.onerror = () => resolve(asset);
    img.src = asset.dataUri;
  });
}

async function fetchBinaryWithTimeout(
  url: string,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  init?: RequestInit,
  timeoutMs = 5000
): Promise<Uint8Array | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetcher(url, {
      ...init,
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves the active company's persisted logo into verified image bytes, data URI,
 * and natural dimensions for offline embedding in DOCX, HTML, Print/PDF, and SCORM 1.2.
 * Fails gracefully to a clean text/monogram fallback if logoUrl is empty or inaccessible.
 */
export async function resolveExportBrand(
  brand?: ExportBrandOptions,
  options?: {
    fetchImpl?: typeof fetch;
    apiFetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  }
): Promise<ExportBrandOptions | undefined> {
  if (!brand) return undefined;

  if (brand.logoAsset) {
    const readyAsset = await convertWebpToPngInBrowser(brand.logoAsset);
    return { ...brand, logoAsset: readyAsset };
  }

  const trimmedUrl = typeof brand.logoUrl === 'string' ? brand.logoUrl.trim() : '';
  if (!trimmedUrl) {
    return { ...brand, logoAsset: undefined };
  }

  if (trimmedUrl.startsWith('data:image/')) {
    const parsed = parseDataUriLogoAsset(trimmedUrl);
    if (!parsed) return { ...brand, logoAsset: undefined };
    return {
      ...brand,
      logoAsset: await convertWebpToPngInBrowser(parsed),
    };
  }

  const activeApiFetch = options?.apiFetchImpl || apiFetch;
  const activeFetch = options?.fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!activeFetch && !options?.apiFetchImpl) {
    return { ...brand, logoAsset: undefined };
  }

  let bytes: Uint8Array | null = null;

  // Prefer same-origin authenticated tenant asset endpoint to bypass external CORS blocks
  // while strictly pinning the active company via X-Company-Id.
  if (brand.companyId) {
    bytes = await fetchBinaryWithTimeout(
      '/api/v2/tenant/company/logo/asset',
      activeApiFetch,
      {
        method: 'GET',
        headers: { 'X-Company-Id': brand.companyId },
      }
    );
  }

  // Fallback to direct URL fetch when running in standalone/public/test contexts
  if (!bytes && activeFetch && (/^https?:\/\//i.test(trimmedUrl) || trimmedUrl.startsWith('/'))) {
    bytes = await fetchBinaryWithTimeout(trimmedUrl, activeFetch, { method: 'GET' });
  }

  if (!bytes) {
    return { ...brand, logoAsset: undefined };
  }

  const asset = createLogoAssetFromBytes(bytes);
  if (!asset) {
    return { ...brand, logoAsset: undefined };
  }

  return {
    ...brand,
    logoAsset: await convertWebpToPngInBrowser(asset),
  };
}
