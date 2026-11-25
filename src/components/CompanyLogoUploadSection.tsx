import React, { useRef, useState } from 'react';
import { AlertTriangle, ImageUp, RefreshCw, Trash2 } from 'lucide-react';
import { validateLogoFileClient, type ValidatedLogoFile } from '../utils/logoUpload';

interface CompanyLogoUploadSectionProps {
  previewUrl?: string | null;
  companyName?: string;
  disabled?: boolean;
  onSelectLogo: (validated: ValidatedLogoFile) => void;
  onRemoveLogo: () => void;
}

export const CompanyLogoUploadSection: React.FC<CompanyLogoUploadSectionProps> = ({
  previewUrl,
  companyName,
  disabled = false,
  onSelectLogo,
  onRemoveLogo,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setValidationError(null);
    setValidating(true);
    try {
      const result = await validateLogoFileClient(file);
      if (result.ok === false) {
        setValidationError(result.error);
        return;
      }
      onSelectLogo(result.logo);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Top-left Neutral Rounded Logo Preview Container */}
        <div className="w-24 h-24 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center p-2.5 shrink-0 overflow-hidden">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={companyName ? `${companyName} logo preview` : 'Company logo preview'}
              className="max-w-full max-h-full w-auto h-auto object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-400 gap-1 text-center">
              <ImageUp className="w-6 h-6" />
              <span className="text-[10px] font-medium">No Logo</span>
            </div>
          )}
        </div>

        {/* Upload / Replace / Remove Controls */}
        <div className="flex-1 space-y-2 min-w-0">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-slate-800">Company Logo</div>
            <p className="text-[11px] text-slate-500 leading-snug">
              PNG (transparent recommended), JPG, JPEG, or WebP · Max 2 MB
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            onChange={handleFileChange}
            disabled={disabled || validating}
            className="hidden"
          />

          {!disabled && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={validating}
                onClick={() => {
                  setValidationError(null);
                  inputRef.current?.click();
                }}
                className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors min-h-[38px]"
              >
                {previewUrl ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{validating ? 'Validating...' : 'Replace Logo'}</span>
                  </>
                ) : (
                  <>
                    <ImageUp className="w-3.5 h-3.5" />
                    <span>{validating ? 'Validating...' : 'Upload Company Logo'}</span>
                  </>
                )}
              </button>

              {previewUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setValidationError(null);
                    onRemoveLogo();
                  }}
                  className="px-3 py-2 rounded-lg bg-white hover:bg-red-50 text-red-600 border border-slate-200 hover:border-red-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors min-h-[38px]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {validationError && (
        <div
          role="alert"
          className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{validationError}</span>
        </div>
      )}
    </div>
  );
};
