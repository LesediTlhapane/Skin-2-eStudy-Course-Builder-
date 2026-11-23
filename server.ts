import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  checkKeysConfigured,
  getRegisteredModels,
  extractUploadedDocumentText,
  analyseSourceDocumentWithAI,
  diagnoseExistingCourseWithAI,
  analyseCourseBriefWithAI,
  proposeCurriculumWithAI,
  auditCurriculumCoverageWithAI,
  generateOutcomesWithAI,
  designAssessmentsWithAI,
  generateModuleContentWithAI,
  regenerateComponentWithAI,
  processCopilotChatWithAI,
  extractTemplateFromDocumentWithAI,
  evaluateCourseQAWithAI,
} from './src/server/ai/index.js';

function resolveErrorStatus(err: any): number {
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('missing') || msg.includes('invalid request')) return 400;
  if (msg.includes('401') || msg.includes('403') || msg.includes('authentication') || msg.includes('api key')) return 401;
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('tpm')) return 429;
  if (msg.includes('timed out') || msg.includes('timeout')) return 504;
  return 502;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    const keys = checkKeysConfigured();
    res.json({
      status: 'ok',
      service: 'eStudy Master Course Builder V2',
      version: '2.0',
      hasGroqKey: keys.groq,
      providers: ['groq'],
    });
  });

  app.get('/api/ai/models', (_req, res) => {
    const keys = checkKeysConfigured();
    res.json({
      providers: [
        { id: 'groq', name: 'Groq Cloud', isConfigured: keys.groq, keyCount: keys.groqKeyCount },
      ],
      models: getRegisteredModels('groq'),
      keysConfigured: keys,
      defaultProvider: 'groq',
    });
  });

  app.post('/api/v2/sources/analyse', async (req, res) => {
    try {
      const { fileName, mimeType, base64Data, rawText, existingSources, provider, model } = req.body || {};
      if (!fileName && !rawText) {
        return res.status(400).json({ success: false, error: 'Missing document file or text.' });
      }
      const extractedText = extractUploadedDocumentText({
        fileName: fileName || 'document.txt',
        mimeType,
        base64Data,
        rawText,
      });
      if (!extractedText || extractedText.length < 20) {
        return res.status(400).json({
          success: false,
          error: 'Could not extract readable text from this file. Try pasting text or uploading a text-based PDF/DOCX.',
        });
      }
      const analysis = await analyseSourceDocumentWithAI({
        fileName: fileName || 'Source Document',
        extractedText,
        existingSources,
        provider,
        model,
      });
      return res.json({ success: true, extractedText, ...analysis });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Source analysis failed.' });
    }
  });

  app.post('/api/v2/improve/diagnose', async (req, res) => {
    try {
      const { fileName, mimeType, base64Data, rawText, provider, model } = req.body || {};
      const extractedText = extractUploadedDocumentText({
        fileName: fileName || 'existing-course.txt',
        mimeType,
        base64Data,
        rawText,
      });
      if (!extractedText || extractedText.length < 30) {
        return res.status(400).json({
          success: false,
          error: 'Could not extract readable course content. Please upload a DOCX/PDF/TXT or paste the course text.',
        });
      }
      const result = await diagnoseExistingCourseWithAI({
        fileName: fileName || 'Existing Course',
        extractedText,
        provider,
        model,
      });
      return res.json({ success: true, extractedText, ...result });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Course diagnosis failed.' });
    }
  });

  app.post('/api/v2/templates/extract', async (req, res) => {
    try {
      const { fileName, mimeType, base64Data, rawText, provider, model } = req.body || {};
      const extractedText = extractUploadedDocumentText({
        fileName: fileName || 'template.txt',
        mimeType,
        base64Data,
        rawText,
      });
      if (!extractedText || extractedText.length < 20) {
        return res.status(400).json({ success: false, error: 'Could not extract text from uploaded template.' });
      }
      const template = await extractTemplateFromDocumentWithAI({
        fileName: fileName || 'Uploaded Template',
        extractedText,
        provider,
        model,
      });
      return res.json({ success: true, template });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Template extraction failed.' });
    }
  });

  app.post('/api/v2/brief/analyse', async (req, res) => {
    try {
      const { brief, sources, provider, model } = req.body || {};
      if (!brief) return res.status(400).json({ success: false, error: 'Missing course brief.' });
      const analysis = await analyseCourseBriefWithAI({ brief, sources: sources || [], provider, model });
      return res.json({ success: true, analysis });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Brief analysis failed.' });
    }
  });

  app.post('/api/v2/curriculum/propose', async (req, res) => {
    try {
      const { brief, sources, desiredModuleCount, existingModules, provider, model } = req.body || {};
      if (!brief) return res.status(400).json({ success: false, error: 'Missing course brief.' });
      const curriculum = await proposeCurriculumWithAI({
        brief,
        sources: sources || [],
        desiredModuleCount,
        existingModules,
        provider,
        model,
      });
      return res.json({ success: true, curriculum });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Curriculum proposal failed.' });
    }
  });

  app.post('/api/v2/curriculum/check-coverage', async (req, res) => {
    try {
      const { brief, sources, curriculum, provider, model } = req.body || {};
      if (!brief || !curriculum) return res.status(400).json({ success: false, error: 'Missing brief or curriculum.' });
      const result = await auditCurriculumCoverageWithAI({
        brief,
        sources: sources || [],
        curriculum,
        provider,
        model,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Coverage check failed.' });
    }
  });

  app.post('/api/v2/outcomes/generate', async (req, res) => {
    try {
      const { brief, curriculum, provider, model } = req.body || {};
      if (!brief || !curriculum) return res.status(400).json({ success: false, error: 'Missing brief or curriculum.' });
      const outcomes = await generateOutcomesWithAI({ brief, curriculum, provider, model });
      return res.json({ success: true, outcomes });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Outcome generation failed.' });
    }
  });

  app.post('/api/v2/assessments/design', async (req, res) => {
    try {
      const { brief, curriculum, outcomes, provider, model } = req.body || {};
      if (!brief || !curriculum || !outcomes) {
        return res.status(400).json({ success: false, error: 'Missing brief, curriculum, or outcomes.' });
      }
      const design = await designAssessmentsWithAI({ brief, curriculum, outcomes, provider, model });
      return res.json({ success: true, ...design });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Assessment design failed.' });
    }
  });

  app.post('/api/v2/content/generate-module', async (req, res) => {
    try {
      const { brief, modulePlan, allModules, outcomes, assessments, sources, provider, model } = req.body || {};
      if (!brief || !modulePlan) {
        return res.status(400).json({ success: false, error: 'Missing brief or module plan.' });
      }
      const moduleContent = await generateModuleContentWithAI({
        brief,
        modulePlan,
        allModules: allModules || [modulePlan],
        outcomes,
        assessments: assessments || [],
        sources: sources || [],
        provider,
        model,
      });
      return res.json({ success: true, moduleContent });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Module content generation failed.' });
    }
  });

  app.post('/api/v2/content/regenerate', async (req, res) => {
    try {
      const { project, targetType, moduleId, targetId, instruction, provider, model } = req.body || {};
      if (!project || !targetType || !moduleId) {
        return res.status(400).json({ success: false, error: 'Missing project, targetType, or moduleId.' });
      }
      const result = await regenerateComponentWithAI({
        project,
        targetType,
        moduleId,
        targetId,
        instruction,
        provider,
        model,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Selective regeneration failed.' });
    }
  });

  app.post('/api/v2/qa/evaluate', async (req, res) => {
    try {
      const { project, weights, provider, model } = req.body || {};
      if (!project || !weights) {
        return res.status(400).json({ success: false, error: 'Missing project or weights.' });
      }
      const report = await evaluateCourseQAWithAI({ project, weights, provider, model });
      return res.json({ success: true, report });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'QA evaluation failed.' });
    }
  });

  app.post('/api/v2/copilot/chat', async (req, res) => {
    try {
      const { project, messages, userMessage, provider, model } = req.body || {};
      if (!project || !userMessage) {
        return res.status(400).json({ success: false, error: 'Missing project or userMessage.' });
      }
      const result = await processCopilotChatWithAI({
        project,
        messages: messages || [],
        userMessage,
        provider,
        model,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(resolveErrorStatus(err)).json({ success: false, error: err?.message || 'Copilot chat failed.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`eStudy Master Course Builder V2 running on http://localhost:${PORT}`);
  });
}

startServer();
