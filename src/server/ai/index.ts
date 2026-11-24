export { aiRouter } from './aiRouter.js';
export { checkKeysConfigured, getRegisteredModels } from './modelRegistry.js';
export { extractUploadedDocumentText } from './documentParser.js';
export {
  analyseSourceDocumentWithAI,
  diagnoseExistingCourseWithAI,
  analyseCourseBriefWithAI,
  proposeCurriculumWithAI,
  auditCurriculumCoverageWithAI,
  generateOutcomesWithAI,
  designAssessmentsWithAI,
  generateModuleContentWithAI,
  generateModuleScaffoldWithAI,
  generateSingleLessonWithAI,
  regenerateComponentWithAI,
  processCopilotChatWithAI,
  draftCourseFromCopilotPromptWithAI,
  extractTemplateFromDocumentWithAI,
} from './stageTasks.js';
export {
  computeAssessmentAlignmentFlags,
  detectDeterministicCriticalFailures,
  evaluateCourseQAWithAI,
} from './qaEngineServer.js';
