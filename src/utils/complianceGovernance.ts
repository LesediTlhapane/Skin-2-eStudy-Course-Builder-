import type { CourseProject, FieldStatus, QAIssueItem } from '../types.js';

export interface ComplianceRequirementCheck {
  key: string;
  label: string;
  stage: 1 | 4;
  status: FieldStatus;
  value: string;
  note: string;
  resolutionGuidance: string;
}

export const COMPLIANCE_FIELD_META: Array<{
  key: string;
  label: string;
  resolutionGuidance: string;
}> = [
  {
    key: 'nqfLevel',
    label: 'NQF Level & Accreditation',
    resolutionGuidance: 'Confirm with accreditation specialist or client.',
  },
  {
    key: 'setaSaqaQcto',
    label: 'SETA / SAQA / QCTO Alignment',
    resolutionGuidance: 'Confirm whether formal alignment or registration is required.',
  },
  {
    key: 'popiaGdpr',
    label: 'POPIA / GDPR Privacy Requirements',
    resolutionGuidance: 'Confirm applicable organisational data-privacy requirements.',
  },
  {
    key: 'industryLegislation',
    label: 'Industry Legislation & Technical Standards',
    resolutionGuidance: 'Obtain and verify client-specific statutory and regulatory requirements.',
  },
  {
    key: 'approvedAiTools',
    label: 'Approved Organisational AI Tools',
    resolutionGuidance: 'Confirm approved and permitted AI tools with the client.',
  },
  {
    key: 'aiEthicsFramework',
    label: 'AI Ethics & Governance Framework',
    resolutionGuidance: 'Confirm whether the organisation has adopted an AI ethics framework.',
  },
  {
    key: 'financialLiteracyBenchmark',
    label: 'Financial Literacy Benchmark Applicability',
    resolutionGuidance:
      'Mark Not Applicable when the course subject is outside financial literacy.',
  },
];

export const COMPLIANCE_ANTI_FABRICATION_PROMPT_BLOCK = `MANDATORY COMPLIANCE & ORGANISATIONAL GOVERNANCE ANTI-FABRICATION RULES:
1. NEVER invent, guess, or assume accreditation, NQF levels, SAQA unit standards, SETA/QCTO registration, legal obligations, organisational policies, approved AI tool lists, AI ethics frameworks, or assessment pass marks.
2. When compliance or organisational facts are missing from the brief or verified sources, mark them explicitly as "To Be Confirmed" or "Requires SME/Stakeholder Validation" and state what client/specialist confirmation is required.
3. Only mark a compliance field "Confirmed" when explicitly supplied by the user/client or verified in an uploaded source document; mark "Not Applicable" (with a brief reason) when the context establishes it does not apply (for example, the Financial Literacy reference benchmark does NOT apply to non-financial programmes, and AI tool/ethics policies do not apply when AI mode is "none").
4. Never fabricate client-specific policies or attribute real company case figures not present in verified sources. Keep Stage 4 assessment weights and pass marks clearly marked as AI-proposed recommendations until confirmed by an authorised human.`;

export function normalizeComplianceStatus(
  raw: unknown,
  fallback: FieldStatus = 'to_be_confirmed'
): FieldStatus {
  if (
    raw === 'confirmed' ||
    raw === 'to_be_confirmed' ||
    raw === 'requires_sme_validation' ||
    raw === 'not_applicable'
  ) {
    return raw;
  }
  return fallback;
}

export function formatFieldStatusLabel(status: FieldStatus): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'to_be_confirmed':
      return 'To Be Confirmed';
    case 'requires_sme_validation':
      return 'Requires SME/Stakeholder Validation';
    case 'not_applicable':
      return 'Not Applicable';
  }
}

export function isFinancialCourseContext(project: CourseProject): boolean {
  const haystack = `${project.brief?.title || ''} ${project.brief?.industryDomain || ''} ${project.brief?.purpose || ''}`.toLowerCase();
  return /\b(financial\s+literacy|personal\s+finance|banking|fsca|credit\s+scoring|wealth|accounting)\b/i.test(
    haystack
  );
}

export function getTrackedComplianceRequirements(
  project: CourseProject
): ComplianceRequirementCheck[] {
  const brief = project.brief;
  const statuses = brief?.fieldStatuses || {};
  const notes = brief?.fieldStatusNotes || {};
  const sa = brief?.saCompliance;
  const tplVals = brief?.templateFieldValues || {};
  const isFin = isFinancialCourseContext(project);
  const aiDisabled = brief?.aiIntegrationMode === 'none';

  const resolve = (
    key: string,
    rawVal: string,
    defaultUnfilled: FieldStatus,
    explicitDefault?: FieldStatus
  ): FieldStatus => {
    if (statuses[key]) return normalizeComplianceStatus(statuses[key], defaultUnfilled);
    if (explicitDefault) return explicitDefault;
    const trimmed = rawVal.trim().toLowerCase();
    if (!trimmed) return defaultUnfilled;
    if (trimmed === 'not applicable' || trimmed === 'n/a') return 'not_applicable';
    if (trimmed.includes('to be confirmed') || trimmed === 'tbc') return 'to_be_confirmed';
    if (trimmed.includes('requires sme') || trimmed.includes('validation')) {
      return 'requires_sme_validation';
    }
    return 'confirmed';
  };

  const nqfVal = sa?.nqfLevel || '';
  const setaSaqaVal = [
    sa?.setaName ? `SETA: ${sa.setaName}` : '',
    sa?.saqaRelevant ? `SAQA${sa.saqaNotes ? ` (${sa.saqaNotes})` : ''}` : '',
    sa?.qctoRelevant ? 'QCTO' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const popiaVal = sa?.popiaRelevant
    ? 'POPIA Applicable'
    : String(tplVals.dataPrivacyFramework || '');
  const legVal = sa?.industryLegislation || String(tplVals.evidenceStandard || '');
  const aiToolsVal =
    brief?.aiIntegrationRequirements || String(tplVals.aiToolsPlatforms || '');
  const aiEthicsVal = String(
    tplVals.aiEthicsFramework || tplVals.aiEthicsGovernance || ''
  );

  const stage1Items: ComplianceRequirementCheck[] = [
    {
      key: 'nqfLevel',
      label: 'NQF Level & Accreditation',
      stage: 1,
      status: resolve(
        'nqfLevel',
        nqfVal,
        sa?.enabled ? 'requires_sme_validation' : 'not_applicable'
      ),
      value: nqfVal || (sa?.enabled ? 'Not specified' : 'SA alignment disabled'),
      note: notes.nqfLevel || '',
      resolutionGuidance: 'Confirm with accreditation specialist or client.',
    },
    {
      key: 'setaSaqaQcto',
      label: 'SETA / SAQA / QCTO Alignment',
      stage: 1,
      status: resolve(
        'setaSaqaQcto',
        setaSaqaVal,
        sa?.enabled ? 'requires_sme_validation' : 'not_applicable'
      ),
      value: setaSaqaVal || (sa?.enabled ? 'Not specified' : 'SA alignment disabled'),
      note: notes.setaSaqaQcto || '',
      resolutionGuidance: 'Confirm whether formal alignment or registration is required.',
    },
    {
      key: 'popiaGdpr',
      label: 'POPIA / GDPR Privacy Requirements',
      stage: 1,
      status: resolve(
        'popiaGdpr',
        popiaVal,
        sa?.enabled ? 'requires_sme_validation' : 'to_be_confirmed'
      ),
      value: popiaVal || 'Not confirmed',
      note: notes.popiaGdpr || '',
      resolutionGuidance: 'Confirm applicable organisational data-privacy requirements.',
    },
    {
      key: 'industryLegislation',
      label: 'Industry Legislation & Standards',
      stage: 1,
      status: resolve('industryLegislation', legVal, 'requires_sme_validation'),
      value: legVal || 'Not confirmed',
      note: notes.industryLegislation || '',
      resolutionGuidance: 'Obtain and verify client-specific statutory requirements.',
    },
    {
      key: 'approvedAiTools',
      label: 'Approved Organisational AI Tools',
      stage: 1,
      status: resolve(
        'approvedAiTools',
        aiToolsVal,
        aiDisabled ? 'not_applicable' : 'to_be_confirmed',
        aiDisabled && !statuses.approvedAiTools ? 'not_applicable' : undefined
      ),
      value: aiDisabled
        ? 'AI integration disabled for this course'
        : aiToolsVal || 'Not confirmed with client',
      note:
        notes.approvedAiTools ||
        (aiDisabled && !notes.approvedAiTools ? 'AI integration mode is set to None.' : ''),
      resolutionGuidance: 'Confirm approved and permitted AI tools with the client.',
    },
    {
      key: 'aiEthicsFramework',
      label: 'AI Ethics Framework',
      stage: 1,
      status: resolve(
        'aiEthicsFramework',
        aiEthicsVal,
        aiDisabled ? 'not_applicable' : 'to_be_confirmed',
        aiDisabled && !statuses.aiEthicsFramework ? 'not_applicable' : undefined
      ),
      value: aiDisabled
        ? 'AI integration disabled for this course'
        : aiEthicsVal || 'Not confirmed',
      note:
        notes.aiEthicsFramework ||
        (aiDisabled && !notes.aiEthicsFramework ? 'AI integration mode is set to None.' : ''),
      resolutionGuidance: 'Confirm whether the organisation has adopted an AI ethics framework.',
    },
    {
      key: 'financialLiteracyBenchmark',
      label: 'Financial Literacy Benchmark Applicability',
      stage: 1,
      status: resolve(
        'financialLiteracyBenchmark',
        isFin ? 'Financial Literacy Domain' : '',
        isFin ? 'confirmed' : 'not_applicable',
        !statuses.financialLiteracyBenchmark
          ? isFin
            ? 'confirmed'
            : 'not_applicable'
          : undefined
      ),
      value: isFin
        ? 'Applicable reference benchmark'
        : 'Not Applicable (non-financial subject)',
      note:
        notes.financialLiteracyBenchmark ||
        (!isFin && !notes.financialLiteracyBenchmark
          ? 'Programme domain is not Financial Literacy.'
          : ''),
      resolutionGuidance:
        'Keep marked Not Applicable unless this course builds directly on Financial Literacy.',
    },
  ];

  // Include Stage 4 thresholds when assessments exist
  const assessments = project.assessments;
  if (assessments && (assessments.items?.length || 0) > 0) {
    const confirmed = assessments.thresholdsConfirmed === true;
    const weightsStatus = normalizeComplianceStatus(
      statuses.assessmentWeighting,
      confirmed ? 'confirmed' : 'requires_sme_validation'
    );
    const passStatus = normalizeComplianceStatus(
      statuses.finalPassMark,
      confirmed ? 'confirmed' : 'requires_sme_validation'
    );

    stage1Items.push(
      {
        key: 'assessmentWeighting',
        label: 'Assessment Weighting (Knowledge / Practical)',
        stage: 4,
        status: confirmed ? 'confirmed' : weightsStatus,
        value: `${assessments.knowledgeWeightPercent}% Knowledge / ${assessments.practicalWeightPercent}% Practical (${confirmed ? 'Confirmed' : 'Proposed'})`,
        note: notes.assessmentWeighting || '',
        resolutionGuidance: 'Agree on Knowledge vs Practical weighting in Stage 4.',
      },
      {
        key: 'finalPassMark',
        label: 'Final Assessment Pass Mark',
        stage: 4,
        status: confirmed ? 'confirmed' : passStatus,
        value: `${assessments.passRequirementPercent}% (${confirmed ? 'Confirmed' : 'Proposed'})`,
        note: notes.finalPassMark || '',
        resolutionGuidance: 'Obtain client / academic approval of the final pass mark in Stage 4.',
      }
    );
  }

  return stage1Items;
}

export function getUnresolvedComplianceRequirements(
  project: CourseProject
): ComplianceRequirementCheck[] {
  return getTrackedComplianceRequirements(project).filter(
    item =>
      item.status === 'to_be_confirmed' || item.status === 'requires_sme_validation'
  );
}

/**
 * Audits generated content for unverified or invented accreditation/regulatory/benchmark
 * assertions that lack Stage 1 confirmation or verified source support.
 */
export function detectUnsupportedComplianceClaims(project: CourseProject): QAIssueItem[] {
  const issues: QAIssueItem[] = [];
  const tracked = getTrackedComplianceRequirements(project);
  const byKey = new Map(tracked.map(item => [item.key, item]));
  const hasVerifiedSource = (project.sources || []).some(
    s => s.verificationStatus === 'VERIFIED'
  );

  const segments: Array<{ label: string; moduleNumber?: number; stage: 1 | 4 | 5; text: string }> = [];
  for (const mod of project.content?.modules || []) {
    for (const lesson of mod.lessons || []) {
      segments.push({
        label: `Module ${mod.moduleNumber} · Lesson "${lesson.title}"`,
        moduleNumber: mod.moduleNumber,
        stage: 5,
        text: `${lesson.explanation || ''}\n${(lesson.workedExamples || []).join('\n')}\n${lesson.practicalApplication || ''}`,
      });
    }
  }

  const combinedText = segments.map(s => s.text).join('\n');

  // 1. Unsupported formal accreditation / SAQA unit standard claims
  const accredClaimMatch = combinedText.match(
    /\b(?:is\s+(?:formally\s+)?accredited\s+by|accredited\s+under\s+(?:saqa|qcto|seta)|carries\s+\d+\s+(?:nqf|saqa)\s+credits|saqa\s+unit\s+standard\s+(?:id\s*)?#?\d{4,6}|qcto\s+qualification\s+(?:id\s*)?#?\d{4,6})\b/i
  );
  const accredStatus = byKey.get('setaSaqaQcto')?.status;
  if (accredClaimMatch && accredStatus !== 'confirmed' && !hasVerifiedSource) {
    issues.push({
      id: 'blk-unverified-accreditation-claim',
      severity: 'blocking',
      prioritySeverity: 'critical',
      verificationOrigin: 'automated',
      rule: 'Compliance Integrity: Unverified Accreditation / Qualification Claim',
      description: `Course content asserts formal accreditation or specific qualification/unit-standard credits ("${accredClaimMatch[0]}") even though SETA/SAQA/QCTO alignment is not confirmed and no verified source substantiates it.`,
      stage: 5,
      affectedSection: 'Stage 5 · Regulatory & Accreditation Claims',
      exampleExcerpt: accredClaimMatch[0],
      recommendedFix:
        'Remove unverified accreditation or qualification ID assertions, or mark Stage 1 accreditation fields as Requires SME/Stakeholder Validation and attach verified evidence.',
    });
  }

  // 2. Financial Literacy benchmark injected or mandated in unrelated courses when Not Applicable
  const benchmarkReq = byKey.get('financialLiteracyBenchmark');
  if (
    benchmarkReq?.status === 'not_applicable' &&
    /\bfinancial\s+literacy\s+(?:benchmark|standard|curriculum)\b/i.test(combinedText)
  ) {
    issues.push({
      id: 'warn-inapplicable-financial-benchmark',
      severity: 'warning',
      prioritySeverity: 'medium',
      verificationOrigin: 'automated',
      rule: 'Scope Accuracy: Non-Applicable Benchmark Referenced',
      description:
        'Stage 5 content references the Financial Literacy benchmark even though this programme is marked Not Applicable for that benchmark.',
      stage: 5,
      affectedSection: 'Stage 5 · Curriculum Scope',
      recommendedFix:
        'Remove unrelated Financial Literacy benchmark references so instructional examples remain specific to this client domain.',
    });
  }

  // 3. Unresolved Stage 1/Stage 4 compliance requirements warning
  const unresolved = getUnresolvedComplianceRequirements(project);
  if (unresolved.length > 0) {
    const stage4Unconfirmed = unresolved.filter(u => u.stage === 4);
    if (stage4Unconfirmed.length > 0) {
      issues.push({
        id: 'warn-unconfirmed-assessment-thresholds',
        severity: 'warning',
        prioritySeverity: 'high',
        verificationOrigin: 'expert_review_required',
        rule: 'Governance: Proposed Assessment Pass Mark / Weighting Unconfirmed',
        description: `Assessment weighting or pass mark (${project.assessments?.passRequirementPercent}% pass mark, ${project.assessments?.knowledgeWeightPercent}/${project.assessments?.practicalWeightPercent} split) remains AI-Proposed until confirmed by an authorised stakeholder.`,
        stage: 4,
        affectedSection: 'Stage 4 · Pass Thresholds & Weighting',
        recommendedFix:
          'Review and confirm the assessment weighting and final pass mark with the client/academic lead in Stage 4.',
      });
    }

    const stage1Unresolved = unresolved.filter(u => u.stage === 1);
    if (stage1Unresolved.length > 0) {
      issues.push({
        id: 'warn-unresolved-compliance-fields',
        severity: 'warning',
        prioritySeverity: 'high',
        verificationOrigin: 'expert_review_required',
        rule: 'Compliance Confirmation Required Before Release',
        description: `${stage1Unresolved.length} compliance/organisational item(s) remain unconfirmed (${stage1Unresolved.map(u => `${u.label}: ${formatFieldStatusLabel(u.status)}`).join('; ')}).`,
        stage: 1,
        affectedSection: 'Stage 1 · Compliance & Governance',
        recommendedFix:
          'Confirm or mark Not Applicable each flagged compliance field with the client or SME before final sign-off.',
      });
    }
  }

  return issues;
}
