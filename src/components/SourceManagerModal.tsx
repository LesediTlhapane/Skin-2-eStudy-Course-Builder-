import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AIProvider,
  CourseProject,
  SourceDocument,
  SourceVerificationStatus,
} from '../types';
import { apiFetch, compactSourcesForApi, parseApiJson } from '../utils/apiClient';

interface SourceManagerModalProps {
  isOpen: boolean;
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  onClose: () => void;
  onUpdateProject: (updater: (prev: CourseProject) => CourseProject) => void;
}

export const SourceManagerModal: React.FC<SourceManagerModalProps> = ({
  isOpen,
  project,
  selectedProvider,
  selectedModel,
  onClose,
  onUpdateProject,
}) => {
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualRef, setManualRef] = useState('');
  const [manualText, setManualText] = useState('');
  const [verifierPrompts, setVerifierPrompts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAnalysing(true);
    setErrorMsg(null);
    try {
      const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
      let rawText: string | undefined;
      let base64Data: string | undefined;
      if (isText) {
        rawText = await file.text();
      } else {
        base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const s = String(reader.result || '');
            resolve(s.includes(',') ? s.split(',')[1] : s);
          };
          reader.onerror = () => reject(new Error('Could not read file.'));
          reader.readAsDataURL(file);
        });
      }

      const res = await apiFetch('/api/v2/sources/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
          rawText,
          existingSources: compactSourcesForApi(project.sources),
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to analyse source.');
      }

      // Upload original file securely into private per-company Supabase Storage bucket
      let storagePath: string | undefined;
      let cloudDocumentId: string | undefined;
      try {
        const uploadRes = await apiFetch('/api/v2/sources/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || 'text/plain',
            base64Data,
            rawText,
            courseId: project.id,
            extractedText: data.extractedText || rawText || '',
            metadata: data.metadata || {},
          }),
        });
        const uploadData = await parseApiJson<any>(uploadRes);
        if (uploadRes.ok && uploadData.success) {
          storagePath = uploadData.storagePath;
          cloudDocumentId = uploadData.sourceId;
        }
      } catch {
        // Keep extracted analysis even if storage upload is unconfigured/unavailable
      }

      // All uploaded / AI-parsed sources MUST start as NEEDS REVIEW until human verification.
      const newSource: SourceDocument = {
        id: cloudDocumentId || `src-${Date.now()}`,
        title: data.metadata?.title || file.name,
        authorOrOrganisation: data.metadata?.authorOrOrganisation || 'To Be Confirmed',
        publicationDate: data.metadata?.publicationDate || 'To Be Confirmed',
        version: data.metadata?.version || 'To Be Confirmed',
        referenceOrUrl: data.metadata?.referenceOrUrl || file.name,
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        storagePath,
        cloudDocumentId,
        extractedText: data.extractedText || rawText || '',
        relevantSections: data.metadata?.relevantSections || [],
        verificationStatus: 'NEEDS REVIEW',
        summary: data.metadata?.summary,
        keyTopics: data.metadata?.keyTopics || [],
        addedAt: new Date().toISOString(),
      };

      const newConflicts = (data.detectedConflicts || []).map((c: any, idx: number) => ({
        id: `sconf-${Date.now()}-${idx}`,
        topic: c.topic,
        sourceAId: c.existingSourceId || '',
        sourceATitle: c.existingSourceTitle || 'Existing Source',
        claimA: c.existingClaim,
        sourceBId: newSource.id,
        sourceBTitle: newSource.title,
        claimB: c.newClaim,
        resolutionStatus: 'unresolved' as const,
      }));

      onUpdateProject(prev => ({
        ...prev,
        sources: [newSource, ...prev.sources],
        sourceConflicts: [...newConflicts, ...prev.sourceConflicts],
      }));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process source document.');
    } finally {
      setIsAnalysing(false);
      e.target.value = '';
    }
  };

  const handleAddManualSource = () => {
    if (!manualTitle.trim()) return;
    const src: SourceDocument = {
      id: `src-${Date.now()}`,
      title: manualTitle.trim(),
      authorOrOrganisation: 'To Be Confirmed',
      publicationDate: 'To Be Confirmed',
      version: 'To Be Confirmed',
      referenceOrUrl: manualRef.trim() || 'Manual entry',
      extractedText: manualText.trim(),
      relevantSections: [],
      verificationStatus: 'NEEDS REVIEW',
      addedAt: new Date().toISOString(),
    };
    onUpdateProject(prev => ({
      ...prev,
      sources: [src, ...prev.sources],
    }));
    setManualTitle('');
    setManualRef('');
    setManualText('');
  };

  const updateSource = (id: string, patch: Partial<SourceDocument>) => {
    onUpdateProject(prev => ({
      ...prev,
      sources: prev.sources.map(s => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const handleStatusChange = (src: SourceDocument, nextStatus: SourceVerificationStatus) => {
    setErrorMsg(null);
    if (nextStatus === 'VERIFIED') {
      const verifier = (src.verifiedBy || verifierPrompts[src.id] || '').trim();
      if (!verifier) {
        setErrorMsg(
          `Enter a human reviewer/verifier name on "${src.title}" before marking it VERIFIED.`
        );
        return;
      }
      updateSource(src.id, {
        verificationStatus: 'VERIFIED',
        verifiedBy: verifier,
        verifiedAt: new Date().toISOString(),
      });
      return;
    }

    updateSource(src.id, {
      verificationStatus: nextStatus,
      verifiedAt: undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#052B66]">Source Register & Document Analysis</h2>
            <p className="text-xs text-slate-500">
              All newly added sources default to NEEDS REVIEW until a human reviewer verifies authority and dates.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Upload Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#F5F7FA] border border-slate-200 rounded-lg">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.json"
              onChange={handleUploadFile}
              className="hidden"
            />
            <div className="text-xs text-slate-600">
              Upload technical manuals, legislation, policies, or approved reference materials (max 4 MB).
            </div>
            <button
              type="button"
              disabled={isAnalysing}
              onClick={() => fileRef.current?.click()}
              className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {isAnalysing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5 text-[#45CC42]" />}
              <span>{isAnalysing ? 'Analysing Document...' : 'Upload & Analyse Source'}</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Source Conflicts */}
          {project.sourceConflicts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                Flagged Contradictions Between Sources
              </h3>
              {project.sourceConflicts.map(conf => (
                <div key={conf.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-2">
                  <div className="font-bold text-amber-900">Topic: {conf.topic}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="p-2 bg-white rounded border border-amber-200">
                      <strong>{conf.sourceATitle}:</strong> {conf.claimA}
                    </div>
                    <div className="p-2 bg-white rounded border border-amber-200">
                      <strong>{conf.sourceBTitle}:</strong> {conf.claimB}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={conf.resolutionDecision || ''}
                      onChange={e =>
                        onUpdateProject(prev => ({
                          ...prev,
                          sourceConflicts: prev.sourceConflicts.map(c =>
                            c.id === conf.id ? { ...c, resolutionDecision: e.target.value } : c
                          ),
                        }))
                      }
                      placeholder="Record authoritative decision..."
                      className="flex-1 px-2.5 py-1 bg-white border border-amber-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProject(prev => ({
                          ...prev,
                          sourceConflicts: prev.sourceConflicts.map(c =>
                            c.id === conf.id
                              ? {
                                  ...c,
                                  resolutionStatus: c.resolutionStatus === 'resolved' ? 'unresolved' : 'resolved',
                                }
                              : c
                          ),
                        }))
                      }
                      className={`px-3 py-1 font-bold rounded cursor-pointer ${
                        conf.resolutionStatus === 'resolved'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white border border-amber-400 text-amber-900'
                      }`}
                    >
                      {conf.resolutionStatus === 'resolved' ? 'Resolved' : 'Mark Resolved'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Source Register List */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-[#052B66]">
              Registered Sources ({project.sources.length})
            </h3>
            {project.sources.map(src => {
              const verifierVal = src.verifiedBy ?? verifierPrompts[src.id] ?? '';
              return (
                <div key={src.id} className="border border-slate-200 rounded-lg p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={src.title}
                      onChange={e => updateSource(src.id, { title: e.target.value })}
                      className="flex-1 min-w-[200px] px-2.5 py-1 text-sm font-bold text-[#052B66] border border-slate-200 rounded"
                    />
                    <select
                      aria-label={`Verification status for ${src.title}`}
                      value={src.verificationStatus}
                      onChange={e =>
                        handleStatusChange(src, e.target.value as SourceVerificationStatus)
                      }
                      className={`px-2.5 py-1 text-xs font-bold border rounded ${
                        src.verificationStatus === 'VERIFIED'
                          ? 'text-emerald-700 border-emerald-300 bg-emerald-50'
                          : src.verificationStatus === 'NEEDS REVIEW'
                          ? 'text-amber-700 border-amber-300 bg-amber-50'
                          : 'text-red-700 border-red-300 bg-red-50'
                      }`}
                    >
                      <option value="NEEDS REVIEW">NEEDS REVIEW</option>
                      <option value="VERIFIED">VERIFIED</option>
                      <option value="UNSUPPORTED">UNSUPPORTED</option>
                    </select>
                    {src.cloudDocumentId && (
                      <button
                        type="button"
                        title="Download Private File via Short-Lived Signed URL"
                        onClick={async () => {
                          setErrorMsg(null);
                          try {
                            const res = await apiFetch(
                              `/api/v2/sources/${encodeURIComponent(src.cloudDocumentId!)}/signed-url`
                            );
                            const d = await parseApiJson<any>(res);
                            if (!res.ok || !d.signedUrl) {
                              throw new Error(d.error || 'Could not generate download link.');
                            }
                            const a = document.createElement('a');
                            a.href = d.signedUrl;
                            a.download = d.fileName || src.fileName || 'source-document';
                            a.rel = 'noopener noreferrer';
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                          } catch (err: any) {
                            setErrorMsg(err?.message || 'Failed to download private file.');
                          }
                        }}
                        className="px-2 py-1 text-[11px] font-semibold text-[#052B66] bg-[#F5F7FA] hover:bg-slate-200 border border-slate-200 rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (src.cloudDocumentId) {
                          void apiFetch(`/api/v2/sources/${encodeURIComponent(src.cloudDocumentId)}`, {
                            method: 'DELETE',
                          }).catch(() => {});
                        }
                        onUpdateProject(prev => ({
                          ...prev,
                          sources: prev.sources.filter(s => s.id !== src.id),
                        }));
                      }}
                      className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                    <input
                      type="text"
                      value={src.authorOrOrganisation}
                      onChange={e => updateSource(src.id, { authorOrOrganisation: e.target.value })}
                      placeholder="Author / Organisation"
                      className="px-2 py-1 border border-slate-200 rounded"
                    />
                    <input
                      type="text"
                      value={src.publicationDate}
                      onChange={e => updateSource(src.id, { publicationDate: e.target.value })}
                      placeholder="Publication Date"
                      className="px-2 py-1 border border-slate-200 rounded"
                    />
                    <input
                      type="text"
                      value={src.version}
                      onChange={e => updateSource(src.id, { version: e.target.value })}
                      placeholder="Version"
                      className="px-2 py-1 border border-slate-200 rounded"
                    />
                    <input
                      type="text"
                      value={src.referenceOrUrl}
                      onChange={e => updateSource(src.id, { referenceOrUrl: e.target.value })}
                      placeholder="URL / Document Reference"
                      className="px-2 py-1 border border-slate-200 rounded"
                    />
                  </div>

                  {/* Human Verifier Gate Row */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 bg-[#F5F7FA] px-2.5 py-2 rounded border border-slate-200 text-xs">
                    <input
                      type="text"
                      value={verifierVal}
                      onChange={e => {
                        const val = e.target.value;
                        setVerifierPrompts(prev => ({ ...prev, [src.id]: val }));
                        updateSource(src.id, { verifiedBy: val });
                      }}
                      placeholder="Human verifier full name (required for VERIFIED)..."
                      className="flex-1 min-w-[200px] px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                    />
                    {src.verificationStatus !== 'VERIFIED' ? (
                      <button
                        type="button"
                        disabled={!verifierVal.trim()}
                        onClick={() => handleStatusChange(src, 'VERIFIED')}
                        className="px-2.5 py-1 rounded bg-[#052B66] disabled:opacity-40 text-white font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#45CC42]" />
                        <span>Verify Source</span>
                      </button>
                    ) : (
                      <span className="text-[11px] font-semibold text-emerald-700">
                        Verified by {src.verifiedBy || 'Reviewer'}
                        {src.verifiedAt
                          ? ` on ${new Date(src.verifiedAt).toLocaleDateString('en-ZA')}`
                          : ''}
                      </span>
                    )}
                  </div>

                  {src.summary && <p className="text-xs text-slate-600">{src.summary}</p>}
                </div>
              );
            })}
          </div>

          {/* Add Manual Reference */}
          <div className="border-t border-slate-200 pt-4 space-y-2">
            <h4 className="text-xs font-bold text-[#052B66]">Add Reference Manually</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
                placeholder="Document title or statute..."
                className="px-3 py-1.5 text-xs border border-slate-200 rounded"
              />
              <input
                type="text"
                value={manualRef}
                onChange={e => setManualRef(e.target.value)}
                placeholder="Reference number or URL..."
                className="px-3 py-1.5 text-xs border border-slate-200 rounded"
              />
            </div>
            <textarea
              rows={2}
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              placeholder="Paste relevant excerpt (starts as NEEDS REVIEW until verified)..."
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded"
            />
            <button
              type="button"
              onClick={handleAddManualSource}
              className="px-3 py-1.5 text-xs font-bold bg-[#F5F7FA] border border-slate-200 rounded hover:border-[#052B66] flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Source Register</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
