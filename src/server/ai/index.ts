export { aiRouter } from './aiRouter.js';
export {
  checkKeysConfigured,
  getBackupModelForProvider,
  getRegisteredModels,
} from './modelRegistry.js';
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
  generateOrRefineTemplateWithCopilotAI,
} from './stageTasks.js';
export {
  computeAssessmentAlignmentFlags,
  detectDeterministicCriticalFailures,
  evaluateCourseQAWithAI,
  remediateCourseQualityWithAI,
} from './qaEngineServer.js';
export {
  parseFilledTemplateTextDeterministically,
  parseFilledCourseBriefWithAI,
} from './templateRoundTrip.js';
