import 'dotenv/config';
import express from 'express';
import { createApiRouter } from '../src/server/apiRouter.js';

const app = express();
app.use(express.json({ limit: '6mb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'Request payload too large (6 MB limit).',
    });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON request payload.' });
  }
  return res.status(500).json({ success: false, error: 'Unexpected server error.' });
});

export default app;
