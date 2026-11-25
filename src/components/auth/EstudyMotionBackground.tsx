import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

export const AUTH_MOTION_INTENSITY_KEY = 'estudy_auth_motion_intensity';
export const DEFAULT_MOTION_INTENSITY = 25;
export const MIN_MOTION_INTENSITY = 10;
export const MAX_MOTION_INTENSITY = 55;
export const MOTION_INTENSITY_STEP = 5;

export function clampMotionIntensity(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_MOTION_INTENSITY;
  const clamped = Math.max(MIN_MOTION_INTENSITY, Math.min(MAX_MOTION_INTENSITY, num));
  return Math.round(clamped / MOTION_INTENSITY_STEP) * MOTION_INTENSITY_STEP;
}

export function readStoredMotionIntensity(): number {
  try {
    const raw = localStorage.getItem(AUTH_MOTION_INTENSITY_KEY);
    if (raw !== null) {
      return clampMotionIntensity(raw);
    }
  } catch {
    // ignore storage restrictions
  }
  return DEFAULT_MOTION_INTENSITY;
}

export function saveStoredMotionIntensity(intensity: number): void {
  try {
    localStorage.setItem(AUTH_MOTION_INTENSITY_KEY, String(clampMotionIntensity(intensity)));
  } catch {
    // ignore storage restrictions
  }
}

const DIGITAL_PARTICLES = [
  { id: 'p1', left: '8%', top: '18%', size: 5, dur: '19s', delay: '-2s', tone: 'green' },
  { id: 'p2', left: '16%', top: '72%', size: 4, dur: '23s', delay: '-6s', tone: 'blue' },
  { id: 'p3', left: '24%', top: '34%', size: 6, dur: '21s', delay: '-11s', tone: 'green' },
  { id: 'p4', left: '31%', top: '82%', size: 3.5, dur: '17s', delay: '-4s', tone: 'blue' },
  { id: 'p5', left: '42%', top: '14%', size: 4.5, dur: '24s', delay: '-9s', tone: 'blue' },
  { id: 'p6', left: '53%', top: '86%', size: 5, dur: '20s', delay: '-13s', tone: 'green' },
  { id: 'p7', left: '64%', top: '20%', size: 4, dur: '18s', delay: '-3s', tone: 'green' },
  { id: 'p8', left: '72%', top: '64%', size: 6, dur: '25s', delay: '-7s', tone: 'blue' },
  { id: 'p9', left: '79%', top: '28%', size: 4.5, dur: '22s', delay: '-14s', tone: 'green' },
  { id: 'p10', left: '88%', top: '76%', size: 5.5, dur: '19s', delay: '-5s', tone: 'green' },
  { id: 'p11', left: '92%', top: '40%', size: 3.5, dur: '24s', delay: '-10s', tone: 'blue' },
  { id: 'p12', left: '12%', top: '48%', size: 4, dur: '20s', delay: '-8s', tone: 'blue' },
  { id: 'p13', left: '48%', top: '58%', size: 3.5, dur: '26s', delay: '-15s', tone: 'green' },
  { id: 'p14', left: '84%', top: '15%', size: 4, dur: '21s', delay: '-1s', tone: 'blue' },
] as const;

interface EstudyMotionBackgroundProps {
  intensity: number;
  onChangeIntensity: (next: number) => void;
  children: React.ReactNode;
}

export const EstudyMotionBackground: React.FC<EstudyMotionBackgroundProps> = ({
  intensity,
  onChangeIntensity,
  children,
}) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);

  // Boost base visibility slightly at higher percentages while keeping strict proportional mapping (0.10 to 0.55)
  const motionOpacity = clampMotionIntensity(intensity) / 100;

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto flex flex-col justify-center"
      style={{
        // Layer 1: Official eStudy luminous deep navy base (never pitch-black, never dull)
        background:
          'linear-gradient(135deg, #03193E 0%, #052B66 48%, #073B8A 100%)',
      }}
    >
      {/* Fixed Non-Interactive Background Viewport */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden"
      >
        {/* Static Subtle Brand Atmospheric Foundation */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 15% 15%, rgba(28, 114, 224, 0.28) 0%, transparent 65%), radial-gradient(ellipse 65% 55% at 88% 82%, rgba(69, 204, 66, 0.16) 0%, transparent 68%)',
          }}
        />

        {/* Layer 5: Adjustable Background Opacity Layer (never affects foreground auth card) */}
        <div
          className="absolute inset-0 transition-opacity duration-200 ease-out"
          style={{ opacity: motionOpacity }}
        >
          {/* Layer 3: Electric-Blue & Deep Navy Atmospheric Light Waves */}
          <div
            className={`absolute -top-1/4 -left-1/4 w-[85vw] h-[85vw] max-w-[1100px] max-h-[1100px] rounded-full blur-3xl ${
              prefersReducedMotion ? '' : 'estudy-wave-a'
            }`}
            style={{
              background:
                'radial-gradient(circle, rgba(42, 139, 242, 0.72) 0%, rgba(13, 77, 161, 0.35) 45%, transparent 72%)',
            }}
          />

          <div
            className={`absolute -bottom-1/3 -right-1/4 w-[80vw] h-[80vw] max-w-[1050px] max-h-[1050px] rounded-full blur-3xl ${
              prefersReducedMotion ? '' : 'estudy-wave-b'
            }`}
            style={{
              background:
                'radial-gradient(circle, rgba(69, 204, 66, 0.78) 0%, rgba(29, 111, 216, 0.25) 48%, transparent 74%)',
            }}
          />

          <div
            className={`absolute top-1/4 left-1/3 w-[52vw] h-[52vw] max-w-[700px] max-h-[700px] rounded-full blur-3xl ${
              prefersReducedMotion ? '' : 'estudy-glow-breathe'
            }`}
            style={{
              background:
                'radial-gradient(circle, rgba(69, 204, 66, 0.45) 0%, rgba(5, 43, 102, 0) 68%)',
            }}
          />

          {/* Layer 2: Animated Luminous Green Light Trails & Interconnected Digital Patterns (Official #052B66 & #45CC42 + Electric Blue) */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 1440 900"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <defs>
              <linearGradient id="estudyGreenTrailA" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#45CC42" stopOpacity="0" />
                <stop offset="35%" stopColor="#45CC42" stopOpacity="0.95" />
                <stop offset="70%" stopColor="#86EFAC" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#45CC42" stopOpacity="0" />
              </linearGradient>

              <linearGradient id="estudyBlueWaveA" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0" />
                <stop offset="45%" stopColor="#60A5FA" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0" />
              </linearGradient>

              <linearGradient id="estudyGreenNetwork" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1D6FD8" stopOpacity="0.25" />
                <stop offset="50%" stopColor="#45CC42" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.3" />
              </linearGradient>

              <filter id="estudySoftGlow" x="-15%" y="-15%" width="130%" height="130%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Subtle architectural digital grid / perspective arcs */}
            <g opacity="0.45" stroke="url(#estudyGreenNetwork)" strokeWidth="1">
              <path d="M-80 760 Q 380 560 760 660 T 1520 440" />
              <path d="M-60 220 Q 420 340 820 190 T 1520 260" />
              <path d="M120 -40 Q 420 420 960 520 T 1480 860" strokeOpacity="0.55" />
              <circle cx="295" cy="285" r="4" fill="#45CC42" />
              <circle cx="760" cy="660" r="5" fill="#45CC42" />
              <circle cx="1140" cy="240" r="4.5" fill="#60A5FA" />
              <circle cx="520" cy="435" r="3.5" fill="#60A5FA" />
              <circle cx="960" cy="520" r="4.5" fill="#45CC42" />
              <line x1="295" y1="285" x2="520" y2="435" strokeDasharray="4 6" />
              <line x1="520" y1="435" x2="960" y2="520" strokeDasharray="4 6" />
              <line x1="960" y1="520" x2="1140" y2="240" strokeDasharray="4 6" />
            </g>

            {/* Primary luminous green flowing light trails */}
            <path
              d="M -120 690 C 220 510, 520 790, 860 540 C 1140 335, 1310 470, 1560 250"
              stroke="url(#estudyGreenTrailA)"
              strokeWidth="4.5"
              strokeLinecap="round"
              filter="url(#estudySoftGlow)"
              strokeDasharray="340 260"
              className={prefersReducedMotion ? '' : 'estudy-trail-flow'}
            />

            <path
              d="M -100 310 C 280 120, 560 440, 920 290 C 1180 180, 1340 320, 1540 160"
              stroke="url(#estudyGreenTrailA)"
              strokeWidth="3"
              strokeLinecap="round"
              filter="url(#estudySoftGlow)"
              strokeDasharray="240 240"
              className={prefersReducedMotion ? '' : 'estudy-trail-flow-slow'}
            />

            {/* Subtle electric-blue flowing waves */}
            <path
              d="M -140 500 C 260 660, 620 240, 1020 470 C 1260 610, 1380 420, 1560 540"
              stroke="url(#estudyBlueWaveA)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="300 240"
              className={prefersReducedMotion ? '' : 'estudy-trail-flow-slow'}
            />

            <path
              d="M -80 820 C 310 690, 680 860, 1040 650 C 1270 515, 1390 660, 1540 580"
              stroke="url(#estudyBlueWaveA)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="200 220"
              className={prefersReducedMotion ? '' : 'estudy-trail-flow'}
            />
          </svg>

          {/* Layer 4: Floating Digital Light Particles */}
          <div className="absolute inset-0">
            {DIGITAL_PARTICLES.map(p => (
              <span
                key={p.id}
                className={`absolute rounded-full ${prefersReducedMotion ? '' : 'estudy-particle'}`}
                style={
                  {
                    left: p.left,
                    top: p.top,
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    backgroundColor: p.tone === 'green' ? '#45CC42' : '#60A5FA',
                    boxShadow:
                      p.tone === 'green'
                        ? '0 0 14px 3px rgba(69, 204, 66, 0.7)'
                        : '0 0 12px 2px rgba(96, 165, 250, 0.65)',
                    '--particle-duration': p.dur,
                    '--particle-delay': p.delay,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* Foreground Authentication Interface */}
      <div className="relative z-10 w-full flex flex-col items-center justify-center p-4 sm:p-6 pb-20">
        {children}
      </div>

      {/* Discreet Bottom-Right Background Motion Intensity Control */}
      <div className="fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2">
        {settingsOpen && (
          <div
            role="dialog"
            aria-label="Background Motion Settings"
            className="w-72 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl p-4 space-y-3 text-slate-900"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#052B66]">
                Background Motion Intensity
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#052B66] bg-[#45CC42]/20 px-2 py-0.5 rounded tabular-nums">
                  {intensity}%
                </span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close background settings"
                  className="p-1 text-slate-400 hover:text-[#052B66] rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-motion-intensity-slider" className="sr-only">
                Background Motion Intensity ({intensity}%)
              </label>
              <input
                id="auth-motion-intensity-slider"
                type="range"
                min={MIN_MOTION_INTENSITY}
                max={MAX_MOTION_INTENSITY}
                step={MOTION_INTENSITY_STEP}
                value={intensity}
                onChange={e => onChangeIntensity(clampMotionIntensity(e.target.value))}
                aria-valuetext={`${intensity}%`}
                className="w-full accent-[#45CC42] cursor-pointer h-2 bg-slate-200 rounded-lg"
              />
              <div className="flex justify-between text-[10px] font-medium text-slate-500 tabular-nums">
                <span>10%</span>
                <span>25%</span>
                <span>40%</span>
                <span>55%</span>
              </div>
            </div>

            {prefersReducedMotion && (
              <p className="text-[11px] text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1.5 leading-snug">
                Reduced motion is active on your device; displaying static eStudy backdrop at {intensity}% intensity.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setSettingsOpen(v => !v)}
          aria-expanded={settingsOpen}
          aria-label="Adjust background motion intensity"
          className="px-3 py-2 rounded-xl bg-white/90 hover:bg-white backdrop-blur-md border border-white/60 shadow-lg text-xs font-semibold text-[#052B66] flex items-center gap-2 cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-[#45CC42]"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#1F7A1D]" />
          <span className="hidden sm:inline">Motion</span>
          <span className="font-mono font-bold tabular-nums text-[#052B66]">{intensity}%</span>
        </button>
      </div>
    </div>
  );
};
