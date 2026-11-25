export type BrandSurfaceMode = 'classic' | 'tinted' | 'vibrant';

export interface BrandThemePreset {
  id: string;
  name: string;
  description: string;
  primaryColour: string;
  secondaryColour: string;
  recommendedMode: BrandSurfaceMode;
}

export const BRAND_THEME_PRESETS: BrandThemePreset[] = [
  {
    id: 'estudy-classic',
    name: 'eStudy Classic',
    description: 'Deep marine navy with vibrant emerald accents',
    primaryColour: '#052B66',
    secondaryColour: '#45CC42',
    recommendedMode: 'vibrant',
  },
  {
    id: 'master-v9-gold',
    name: 'Master v9.0 Executive',
    description: 'Academic navy paired with warm executive gold',
    primaryColour: '#1B365D',
    secondaryColour: '#B68D2C',
    recommendedMode: 'tinted',
  },
  {
    id: 'ocean-teal',
    name: 'Ocean Slate & Teal',
    description: 'Midnight slate anchored by crisp studio teal',
    primaryColour: '#0F172A',
    secondaryColour: '#0D9488',
    recommendedMode: 'vibrant',
  },
  {
    id: 'indigo-coral',
    name: 'Royal Indigo & Coral',
    description: 'Rich indigo balanced with energetic coral orange',
    primaryColour: '#1E1B4B',
    secondaryColour: '#F97316',
    recommendedMode: 'vibrant',
  },
  {
    id: 'forest-amber',
    name: 'Botanical Forest & Amber',
    description: 'Deep pine green paired with sunlit gold amber',
    primaryColour: '#14532D',
    secondaryColour: '#EAB308',
    recommendedMode: 'tinted',
  },
  {
    id: 'burgundy-sky',
    name: 'Burgundy & Cerulean',
    description: 'Executive wine burgundy with bright sky blue',
    primaryColour: '#4C0519',
    secondaryColour: '#0284C7',
    recommendedMode: 'vibrant',
  },
];

export function normalizeHex(hex: string | undefined | null, fallback = '#052B66'): string {
  if (!hex || typeof hex !== 'string') return fallback;
  const trimmed = hex.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  const short = trimmed.match(/^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  }
  return fallback;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHex(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * Blend two hex colours: weightA = 1 returns hexA, weightA = 0 returns hexB.
 */
export function mixHex(hexA: string, hexB: string, weightA: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightA));
  return rgbToHex(
    a.r * w + b.r * (1 - w),
    a.g * w + b.g * (1 - w),
    a.b * w + b.b * (1 - w)
  );
}

export function darkenHex(hex: string, amount = 0.16): string {
  return mixHex('#090D16', hex, amount);
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linearize = (channel: number) => {
    const sRGB = channel / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function getContrastRatio(hexA: string, hexB: string): number {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick high-contrast foreground text (#FFFFFF or dark ink) that achieves >= 4.5:1 AA contrast when possible.
 */
export function getContrastText(bgHex: string, preferredDark = '#0F172A'): string {
  const lightRatio = getContrastRatio(bgHex, '#FFFFFF');
  const darkRatio = getContrastRatio(bgHex, preferredDark);
  if (lightRatio >= 4.5 && lightRatio >= darkRatio) return '#FFFFFF';
  if (darkRatio >= 4.5 && darkRatio >= lightRatio) return preferredDark;
  if (lightRatio > darkRatio) return '#FFFFFF';
  const deeper = '#020617';
  if (getContrastRatio(bgHex, deeper) >= 4.5) return deeper;
  return getContrastRatio(bgHex, '#000000') > lightRatio ? '#000000' : '#FFFFFF';
}

/**
 * Ensure secondary accent text rendered on crisp white (#FFFFFF) meets >= 4.5:1 WCAG AA contrast.
 */
export function getReadableAccentInk(secondaryHex: string): string {
  const norm = normalizeHex(secondaryHex, '#45CC42');
  if (getContrastRatio(norm, '#FFFFFF') >= 4.5) return norm;
  for (let step = 0.1; step <= 0.85; step += 0.05) {
    const candidate = mixHex('#0F172A', norm, step);
    if (getContrastRatio(candidate, '#FFFFFF') >= 4.7) {
      return candidate;
    }
  }
  return '#0F172A';
}

export interface ComputedBrandTokens {
  primary: string;
  primaryDark: string;
  primaryContrast: string;
  primarySoft: string;
  primaryTint: string;
  primaryBorder: string;
  secondary: string;
  secondaryDark: string;
  secondaryContrast: string;
  secondaryInk: string;
  secondarySoft: string;
  secondaryTint: string;
  secondaryBorder: string;
  gradient: string;
  surface: string;
  surfaceMode: BrandSurfaceMode;
}

export function computeBrandThemeTokens(
  rawPrimary?: string | null,
  rawSecondary?: string | null,
  surfaceMode: BrandSurfaceMode = 'vibrant'
): ComputedBrandTokens {
  const primary = normalizeHex(rawPrimary, '#052B66');
  const secondary = normalizeHex(rawSecondary, '#45CC42');

  const primaryDark = darkenHex(primary, 0.22);
  const primaryContrast = getContrastText(primary);
  const primarySoft = hexToRgba(primary, 0.09);
  const primaryTint = mixHex(primary, '#FFFFFF', 0.08);
  const primaryBorder = hexToRgba(primary, 0.26);

  const secondaryDark = darkenHex(secondary, 0.16);
  const secondaryContrast = getContrastText(secondary);
  const secondaryInk = getReadableAccentInk(secondary);

  const softAlpha =
    surfaceMode === 'vibrant' ? 0.18 : surfaceMode === 'tinted' ? 0.14 : 0.1;
  const tintWeight =
    surfaceMode === 'vibrant' ? 0.14 : surfaceMode === 'tinted' ? 0.11 : 0.07;

  const secondarySoft = hexToRgba(secondary, softAlpha);
  const secondaryTint = mixHex(secondary, '#FFFFFF', tintWeight);
  const secondaryBorder = hexToRgba(secondary, surfaceMode === 'vibrant' ? 0.55 : 0.38);

  // Subtle multi-stop brand gradient weaving primary -> primary/secondary blend so secondary enriches dark headers
  const gradientEnd =
    surfaceMode === 'classic'
      ? darkenHex(primary, 0.14)
      : mixHex(primary, secondary, surfaceMode === 'vibrant' ? 0.78 : 0.85);
  const gradient = `linear-gradient(135deg, ${primary} 0%, ${mixHex(primary, gradientEnd, 0.45)} 58%, ${gradientEnd} 100%)`;

  const surface =
    surfaceMode === 'tinted'
      ? mixHex(secondary, mixHex(primary, '#F8FAFC', 0.04), 0.045)
      : surfaceMode === 'vibrant'
      ? mixHex(secondary, '#F4F7FB', 0.03)
      : '#F5F7FA';

  return {
    primary,
    primaryDark,
    primaryContrast,
    primarySoft,
    primaryTint,
    primaryBorder,
    secondary,
    secondaryDark,
    secondaryContrast,
    secondaryInk,
    secondarySoft,
    secondaryTint,
    secondaryBorder,
    gradient,
    surface,
    surfaceMode,
  };
}

const THEME_MODE_STORAGE_PREFIX = 'estudy_theme_mode_';

export function getStoredSurfaceMode(companyId?: string | null): BrandSurfaceMode {
  try {
    const key = `${THEME_MODE_STORAGE_PREFIX}${companyId || 'default'}`;
    const raw = localStorage.getItem(key);
    if (raw === 'classic' || raw === 'tinted' || raw === 'vibrant') {
      return raw;
    }
  } catch {
    // ignore storage failures
  }
  return 'vibrant';
}

export function saveStoredSurfaceMode(
  companyId: string | undefined | null,
  mode: BrandSurfaceMode
): void {
  try {
    const key = `${THEME_MODE_STORAGE_PREFIX}${companyId || 'default'}`;
    localStorage.setItem(key, mode);
  } catch {
    // ignore storage failures
  }
}

export function applyBrandThemeToDocument(
  rawPrimary?: string | null,
  rawSecondary?: string | null,
  surfaceMode: BrandSurfaceMode = 'vibrant'
): ComputedBrandTokens {
  const tokens = computeBrandThemeTokens(rawPrimary, rawSecondary, surfaceMode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement.style;
    root.setProperty('--brand-primary', tokens.primary);
    root.setProperty('--brand-primary-dark', tokens.primaryDark);
    root.setProperty('--brand-primary-contrast', tokens.primaryContrast);
    root.setProperty('--brand-primary-soft', tokens.primarySoft);
    root.setProperty('--brand-primary-tint', tokens.primaryTint);
    root.setProperty('--brand-primary-border', tokens.primaryBorder);
    root.setProperty('--brand-secondary', tokens.secondary);
    root.setProperty('--brand-secondary-dark', tokens.secondaryDark);
    root.setProperty('--brand-secondary-contrast', tokens.secondaryContrast);
    root.setProperty('--brand-secondary-ink', tokens.secondaryInk);
    root.setProperty('--brand-secondary-soft', tokens.secondarySoft);
    root.setProperty('--brand-secondary-tint', tokens.secondaryTint);
    root.setProperty('--brand-secondary-border', tokens.secondaryBorder);
    root.setProperty('--brand-gradient', tokens.gradient);
    root.setProperty('--brand-surface', tokens.surface);
  }
  return tokens;
}
