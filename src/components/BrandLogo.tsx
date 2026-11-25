import React, { useState } from 'react';

interface BrandLogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  companyName?: string | null;
  logoUrl?: string | null;
  primaryColour?: string;
  secondaryColour?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
  companyName,
  logoUrl,
  primaryColour = '#052B66',
  secondaryColour = '#45CC42',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const heightClasses = {
    sm: 'h-5',
    md: 'h-6',
    lg: 'h-8',
  };

  if (logoUrl && !imgFailed) {
    return (
      <div className={`inline-flex items-center gap-2 shrink-0 select-none ${className}`}>
        <img
          src={logoUrl}
          alt={companyName || 'Company Logo'}
          onError={() => setImgFailed(true)}
          className={`${heightClasses[size]} w-auto max-w-[140px] object-contain shrink-0 rounded`}
          referrerPolicy="no-referrer"
        />
        {variant === 'full' && companyName && (
          <span
            className="text-sm font-bold tracking-tight truncate max-w-[180px]"
            style={{ color: primaryColour }}
          >
            {companyName}
          </span>
        )}
      </div>
    );
  }

  if (companyName) {
    const initials = companyName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase() || '')
      .join('');

    return (
      <div className={`inline-flex items-center gap-2.5 shrink-0 select-none ${className}`}>
        <span
          className="relative w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0 shadow-xs"
          style={{
            backgroundColor: primaryColour,
            color: 'var(--brand-primary-contrast, #FFFFFF)',
            border: `2px solid ${secondaryColour}`,
          }}
        >
          <span>{initials || 'CS'}</span>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white"
            style={{ backgroundColor: secondaryColour }}
          />
        </span>
        {variant === 'full' && (
          <span
            className="text-sm font-bold tracking-tight truncate max-w-[190px]"
            style={{ color: primaryColour }}
          >
            {companyName}
          </span>
        )}
      </div>
    );
  }

  if (variant === 'icon') {
    return (
      <img
        src="/assets/eSTUDY Icon_Blue & Green (1).jpg"
        alt="eStudy South Africa"
        className={`w-8 h-8 object-contain rounded ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className={`inline-flex items-center shrink-0 select-none ${className}`}>
      <img
        src="/assets/New logo bright green (1).png"
        alt="eStudy South Africa"
        className={`${heightClasses[size]} w-auto object-contain shrink-0`}
        referrerPolicy="no-referrer"
      />
    </div>
  );
};
