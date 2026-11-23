import type { CourseBrief, CourseCreationMode, CourseProject, CurriculumModulePlan } from '../types';
import { DEFAULT_QA_WEIGHTS } from './templates';

export interface BenchmarkBriefPreset {
  id: string;
  label: string;
  category: string;
  description: string;
  templateId: string;
  brief: Partial<CourseBrief>;
  suggestedTopics: string[];
}

export const BENCHMARK_PRESETS: BenchmarkBriefPreset[] = [
  {
    id: 'bench-chem-eng',
    label: '1. AI for Chemical Engineering',
    category: 'Technical Course',
    description:
      'Process modelling, mass/energy balance validation, predictive maintenance, and safety boundaries in chemical plants.',
    templateId: 'tpl-technical-engineering',
    brief: {
      title: 'AI for Chemical Engineering',
      code: 'EST-CHE-AI-201',
      industryDomain: 'Chemical & Process Engineering',
      purpose:
        'Equip chemical and process engineers to apply machine learning and physics-informed surrogate models to unit operations, process optimisation, and anomaly detection without compromising plant safety envelopes.',
      workplaceProblem:
        'Process engineers face multivariable non-linear plant data where manual spreadsheet tuning misses early fouling/catalyst degradation and unvalidated black-box AI recommendations create HAZOP safety risks.',
      targetAudience: 'Chemical Engineers, Process Control Engineers, Plant Operations Specialists',
      targetJobRoles: 'Process Engineer, Plant Optimization Lead, Control Systems Engineer',
      experienceLevel: 'Advanced',
      prerequisites:
        'BEng/BSc in Chemical Engineering or equivalent; familiarity with mass & energy balances, PID control, and Python/spreadsheet data analysis.',
      estimatedDuration: '16 Hours',
      language: 'English (South African Technical Context)',
      learningRequirements:
        'Must preserve chemical engineering thermodynamics, mass/energy balance conservation constraints, unit conversions, and HAZOP human sign-off protocols.',
      subjectTopicsInput: [
        'Mass and energy balance data reconciliation using ML',
        'Sensor drift, noise filtering, and soft sensors for distillation columns',
        'Physics-informed vs pure data-driven surrogate models',
        'Predictive maintenance for heat exchangers and centrifugal pumps',
        'Process control limits, HAZOP boundaries, and human-in-the-loop override',
      ].join('\n'),
      aiIntegrationMode: 'core',
      aiIntegrationRequirements:
        'Cover regression/time-series soft sensors, anomaly detection, and model validation limitations (extrapolation outside operating envelope).',
    },
    suggestedTopics: [
      'Mass and energy balance data reconciliation using ML',
      'Soft sensors for distillation columns',
      'Physics-informed vs pure data-driven surrogate models',
      'Predictive maintenance for heat exchangers and pumps',
      'HAZOP safety boundaries and human-in-the-loop override',
    ],
  },
  {
    id: 'bench-sales-rep',
    label: '2. Sales Representative',
    category: 'Sales & Customer Service',
    description:
      'Consultative B2B/B2C needs discovery, objection handling, ethical persuasion, and pipeline follow-through.',
    templateId: 'tpl-estudy-master-v9',
    brief: {
      title: 'Consultative Sales Representative Excellence',
      code: 'EST-SLS-104',
      industryDomain: 'Sales & Customer Service',
      purpose:
        'Develop confident, ethical sales representatives able to diagnose customer needs, articulate value propositions, resolve objections constructively, and close sustainable accounts.',
      workplaceProblem:
        'Representatives pitch product features prematurely instead of discovering client pain points, leading to price discounting, stalled pipelines, and high early-customer churn.',
      targetAudience: 'Field Sales Representatives, Inside Sales Consultants, Account Executives',
      targetJobRoles: 'Sales Representative, Business Development Consultant, Account Coordinator',
      experienceLevel: 'Intermediate',
      prerequisites: 'Basic customer interaction experience and familiarity with company product catalogue.',
      estimatedDuration: '8 Hours',
      language: 'English (South African Commercial Context)',
      learningRequirements:
        'Focus on practical dialogue role-plays, discovery questioning frameworks, objection resolution, and accurate CRM call logging. AI is optional productivity support only.',
      subjectTopicsInput: [
        'Consultative discovery and active listening techniques',
        'Translating product features into measurable client ROI',
        'Handling price, timing, and competitor objections without discounting',
        'Ethical closing commitments and transparent contract terms',
        'Post-sale handover, retention check-ins, and CRM discipline',
      ].join('\n'),
      aiIntegrationMode: 'none',
      aiIntegrationRequirements: 'Not required for core curriculum; keep focus strictly on human sales skills.',
    },
    suggestedTopics: [
      'Consultative discovery and active listening',
      'Translating features into client ROI',
      'Handling price and competitor objections',
      'Ethical closing and transparent terms',
      'Post-sale handover and CRM follow-through',
    ],
  },
  {
    id: 'bench-fin-consumer',
    label: '3. Financial Sector Consumer Education',
    category: 'Compliance Course',
    description:
      'South African financial consumer rights, credit literacy, fee transparency, scam prevention, and complaints escalation.',
    templateId: 'tpl-regulatory-compliance',
    brief: {
      title: 'Financial Sector Consumer Education & Protection',
      code: 'EST-FIN-CE-102',
      industryDomain: 'Financial Services & Consumer Protection',
      purpose:
        'Empower South African consumers and frontline financial educators to understand everyday financial products, credit costs, consumer rights, and formal dispute channels.',
      workplaceProblem:
        'Consumers enter high-cost credit or unsuitable insurance agreements without understanding total cost of credit, cooling-off periods, or ombud escalation rights.',
      targetAudience: 'South African Retail Financial Consumers, Community Educators, Frontline Bank Consultants',
      targetJobRoles: 'Consumer Education Facilitator, Branch Consultant, Financial Wellness Coach',
      experienceLevel: 'Entry / Foundational',
      prerequisites: 'Basic numeracy and everyday banking familiarity.',
      estimatedDuration: '6 Hours',
      language: 'English (Plain Language South African Context)',
      learningRequirements:
        'Use plain, accessible language. Never fabricate statutory threshold numbers or claim accreditation; mark any unverified statutory rates as Requires SME/Stakeholder Validation.',
      subjectTopicsInput: [
        'Household budgeting, emergency savings, and distinguishing needs vs wants',
        'Understanding total cost of credit, interest, initiation fees, and credit life insurance',
        'Comparing transactional bank accounts and spotting hidden fees',
        'Recognising advance-fee scams, phishing, and unauthorised debit orders',
        'Consumer rights and dispute escalation pathways (internal complaints, National Financial Ombud Scheme, NCR)',
      ].join('\n'),
      aiIntegrationMode: 'none',
      aiIntegrationRequirements: 'Not applicable to this consumer education programme.',
    },
    suggestedTopics: [
      'Household budgeting and emergency savings',
      'Total cost of credit and credit life insurance',
      'Comparing bank accounts and fee transparency',
      'Recognising financial scams and unauthorised debit orders',
      'Consumer rights and ombud escalation pathways',
    ],
  },
  {
    id: 'bench-icitp-plp',
    label: '4. ICITP PLP (Professional Learning Programme)',
    category: 'Professional Learning Programme',
    description:
      'Structured professional learning programme for IT/ICT practitioners covering governance, service delivery, ethics, and CPD reflection.',
    templateId: 'tpl-estudy-master-v9',
    brief: {
      title: 'ICITP Professional Learning Programme (PLP)',
      code: 'EST-ICT-PLP-301',
      industryDomain: 'Information & Communications Technology Governance',
      purpose:
        'Advance professional judgement, IT service governance, information security accountability, and reflective continuing professional development (CPD) for ICT practitioners.',
      workplaceProblem:
        'Technical ICT practitioners transition into senior operational or advisory roles without structured grounding in professional ethics, stakeholder risk communication, and POPIA-aligned service governance.',
      targetAudience: 'Practising ICT Professionals, Systems Analysts, IT Team Leads',
      targetJobRoles: 'ICT Practitioner, IT Service Manager, Systems Architect, Security Analyst',
      experienceLevel: 'Intermediate',
      prerequisites: 'Recognised ICT qualification or minimum 2 years ICT workplace experience.',
      estimatedDuration: '12 Hours',
      language: 'English (South African Corporate Context)',
      learningRequirements:
        'Must integrate professional ethical decision-making, stakeholder governance, service continuity, and reflective CPD portfolio tasks without fabricating CPD point allocations.',
      subjectTopicsInput: [
        'Professional conduct, accountability, and ethical codes in ICT',
        'IT governance frameworks, risk registers, and King IV Principle 12 alignment',
        'Data privacy by design under POPIA for enterprise systems',
        'Incident management, root-cause communication, and SLA governance',
        'Continuing Professional Development (CPD) planning and peer review',
      ].join('\n'),
      aiIntegrationMode: 'optional',
      aiIntegrationRequirements:
        'Address governance risks of shadow AI adoption in enterprise ICT environments.',
    },
    suggestedTopics: [
      'Professional conduct and ethical codes in ICT',
      'IT governance and King IV Principle 12 alignment',
      'POPIA privacy by design in enterprise systems',
      'Incident management and SLA governance',
      'CPD planning and reflective peer review',
    ],
  },
  {
    id: 'bench-practical-workplace',
    label: '5. Practical Workplace Skills Programme',
    category: 'Practical Workplace Skills',
    description:
      'Competency-based warehouse & dispatch operations requiring physical checklists, safe handling demonstration, and supervisor sign-off.',
    templateId: 'tpl-practical-workplace',
    brief: {
      title: 'Safe Warehouse Dispatch & Inventory Verification Skills Programme',
      code: 'EST-OPS-WHS-105',
      industryDomain: 'Logistics, Warehousing & Supply Chain Operations',
      purpose:
        'Verify that warehouse and dispatch operators can execute stock picking, load verification, manual handling safety, and dispatch discrepancy reporting accurately on the floor.',
      workplaceProblem:
        'Picking errors, undocumented damaged stock, and unsafe pallet stacking cause shipping rework, customer claims, and workplace injury near-misses.',
      targetAudience: 'Warehouse Operators, Dispatch Clerks, Receiving Assistants',
      targetJobRoles: 'Picker/Packer, Dispatch Clerk, Junior Warehouse Team Leader',
      experienceLevel: 'Entry / Foundational',
      prerequisites: 'Workplace induction and basic literacy/numeracy.',
      estimatedDuration: '10 Hours',
      language: 'English (Plain Operational Language)',
      learningRequirements:
        'Assessments must require observed practical demonstrations and workplace checklists, not purely multiple-choice recall.',
      subjectTopicsInput: [
        'Pre-shift workstation inspection, PPE compliance, and hazard identification',
        'Safe manual handling and pallet stability verification',
        'Barcode picking accuracy, batch/expiry checks, and FIFO rotation',
        'Handling short-picks, damaged goods quarantine, and discrepancy logs',
        'Final dispatch load check and driver handover sign-off',
      ].join('\n'),
      aiIntegrationMode: 'none',
      aiIntegrationRequirements: 'Not applicable — practical physical warehouse competence.',
    },
    suggestedTopics: [
      'Pre-shift inspection, PPE, and hazard identification',
      'Safe manual handling and pallet stability',
      'Barcode picking accuracy and FIFO rotation',
      'Damaged goods quarantine and discrepancy logs',
      'Final dispatch check and driver handover sign-off',
    ],
  },
];

export function createEmptyCourseProject(options: {
  templateId: string;
  templateName: string;
  creationMode: CourseCreationMode;
  preset?: BenchmarkBriefPreset;
}): CourseProject {
  const now = new Date().toISOString();
  const id = `course-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const p = options.preset?.brief;

  const emptyModules: CurriculumModulePlan[] = [];

  return {
    id,
    templateId: options.templateId,
    templateName: options.templateName,
    creationMode: options.creationMode,
    lifecycleStatus: 'draft',
    currentStage: 1,
    createdAt: now,
    updatedAt: now,
    sources: [],
    sourceConflicts: [],
    brief: {
      title: p?.title || '',
      code: p?.code || '',
      industryDomain: p?.industryDomain || '',
      purpose: p?.purpose || '',
      workplaceProblem: p?.workplaceProblem || '',
      targetAudience: p?.targetAudience || '',
      targetJobRoles: p?.targetJobRoles || '',
      experienceLevel: p?.experienceLevel || 'Intermediate',
      prerequisites: p?.prerequisites || '',
      estimatedDuration: p?.estimatedDuration || '',
      language: p?.language || 'English (South African Context)',
      learningRequirements: p?.learningRequirements || '',
      subjectTopicsInput: p?.subjectTopicsInput || '',
      aiIntegrationMode: p?.aiIntegrationMode || 'none',
      aiIntegrationRequirements: p?.aiIntegrationRequirements || '',
      saCompliance: {
        enabled: false,
        nqfLevel: '',
        saqaRelevant: false,
        saqaNotes: '',
        qctoRelevant: false,
        qctoModulePattern: false,
        setaName: '',
        professionalBodyCpd: '',
        popiaRelevant: false,
        industryLegislation: '',
        technicalStandards: '',
        accreditationDisclaimerAccepted: false,
      },
      templateFieldValues: {},
      fieldStatuses: {
        title: p?.title ? 'confirmed' : 'to_be_confirmed',
        code: p?.code ? 'confirmed' : 'to_be_confirmed',
        estimatedDuration: p?.estimatedDuration ? 'confirmed' : 'to_be_confirmed',
      },
      metadataLocked: false,
      approval: { approved: false },
    },
    curriculum: {
      rationale: '',
      modules: emptyModules,
      coverageChecks: [],
      conflicts: [],
      approval: { approved: false },
    },
    outcomes: {
      courseOutcomes: [],
      moduleOutcomes: [],
      durationRealismNote: '',
      nqfSummaryNote: '',
      approval: { approved: false },
    },
    assessments: {
      strategySummary: '',
      passRequirementPercent: 70,
      knowledgeWeightPercent: 50,
      practicalWeightPercent: 50,
      items: [],
      alignmentFlags: [],
      approval: { approved: false },
    },
    content: {
      modules: [],
      generationHistory: [],
      approval: { approved: false },
    },
    qaHistory: [],
    versions: [],
  };
}
