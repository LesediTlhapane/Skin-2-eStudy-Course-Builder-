import { apiFetch, parseApiJson } from './apiClient';
import type { CompanyWorkspace } from '../types';

export const MAX_COMPANY_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export type AllowedLogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ValidatedLogoFile {
  file: File;
  fileName: string;
  mimeType: AllowedLogoMime;
  previewDataUrl: string;
  base64Data: string;
  sizeBytes: number;
}

function detectImageSignatureFromBytes(bytes: Uint8Array): AllowedLogoMime | null {
  if (bytes.length < 12) return null;

  // Block text/XML/SVG/HTML disguised with image extensions
  const headText = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, Math.min(bytes.length, 64)))
    .trimStart()
    .toLowerCase();
  if (
    headText.startsWith('<svg') ||
    headText.startsWith('<?xml') ||
    headText.startsWith('<!doctype') ||
    headText.startsWith('<html') ||
    headText.startsWith('<script')
  ) {
    return null;
  }

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
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
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
    return 'image/webp';
  }

  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read selected image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });
}

export async function validateLogoFileClient(
  file: File
): Promise<{ ok: true; logo: ValidatedLogoFile } | { ok: false; error: string }> {
  if (!file) {
    return { ok: false, error: 'No file selected.' };
  }

  if (file.size <= 0) {
    return { ok: false, error: 'The selected image file is empty.' };
  }

  if (file.size > MAX_COMPANY_LOGO_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      ok: false,
      error: `Logo file is too large (${sizeMb} MB). Maximum supported size is 2 MB.`,
    };
  }

  const lowerName = (file.name || '').toLowerCase();
  const lowerType = (file.type || '').toLowerCase();
  if (
    lowerType.includes('svg') ||
    lowerType.includes('html') ||
    lowerName.endsWith('.svg') ||
    lowerName.endsWith('.html') ||
    lowerName.endsWith('.htm')
  ) {
    return {
      ok: false,
      error: 'SVG and HTML files are not permitted. Upload a PNG, JPG, JPEG, or WebP logo.',
    };
  }

  try {
    const headerSlice = await file.slice(0, 64).arrayBuffer();
    const detectedMime = detectImageSignatureFromBytes(new Uint8Array(headerSlice));
    if (!detectedMime) {
      return {
        ok: false,
        error: 'Unsupported image format. Please choose a valid PNG, JPG, JPEG, or WebP logo.',
      };
    }

    const previewDataUrl = await readFileAsDataUrl(file);
    const commaIdx = previewDataUrl.indexOf(',');
    const base64Data = commaIdx >= 0 ? previewDataUrl.slice(commaIdx + 1) : '';
    if (!base64Data) {
      return { ok: false, error: 'Could not encode image file for upload.' };
    }

    return {
      ok: true,
      logo: {
        file,
        fileName: file.name || `company-logo.${detectedMime === 'image/jpeg' ? 'jpg' : detectedMime.split('/')[1]}`,
        mimeType: detectedMime,
        previewDataUrl,
        base64Data,
        sizeBytes: file.size,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unable to inspect selected image file.' };
  }
}

export async function uploadCompanyLogoToServer(params: {
  logo: ValidatedLogoFile;
  accessToken?: string | null;
  companyId?: string | null;
}): Promise<{ company: CompanyWorkspace; logoUrl: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }
  if (params.companyId) {
    headers['X-Company-Id'] = params.companyId;
  }

  const res = await apiFetch('/api/v2/tenant/company/logo', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileName: params.logo.fileName,
      mimeType: params.logo.mimeType,
      base64Data: params.logo.base64Data,
    }),
  });

  const data = await parseApiJson<any>(res);
  if (!res.ok || !data.success || !data.company) {
    throw new Error(data.error || 'Failed to upload company logo.');
  }

  return {
    company: data.company as CompanyWorkspace,
    logoUrl: String(data.logoUrl || data.company.logoUrl || ''),
  };
}

export async function removeCompanyLogoOnServer(params?: {
  accessToken?: string | null;
  companyId?: string | null;
}): Promise<{ company: CompanyWorkspace }> {
  const headers: Record<string, string> = {};
  if (params?.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }
  if (params?.companyId) {
    headers['X-Company-Id'] = params.companyId;
  }

  const res = await apiFetch('/api/v2/tenant/company/logo', {
    method: 'DELETE',
    headers,
  });

  const data = await parseApiJson<any>(res);
  if (!res.ok || !data.success || !data.company) {
    throw new Error(data.error || 'Failed to remove company logo.');
  }

  return { company: data.company as CompanyWorkspace };
}
