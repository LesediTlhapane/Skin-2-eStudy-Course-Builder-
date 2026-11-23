import React from 'react';

interface BrandLogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
}) => {
  const heightClasses = {
    sm: 'h-5',
    md: 'h-6',
    lg: 'h-8',
  };

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
