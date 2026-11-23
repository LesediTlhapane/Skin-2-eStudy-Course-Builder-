import 'dotenv/config';
import express from 'express';
import { createApiRouter } from '../src/server/apiRouter.js';

const app = express();
app.use(express.json({ limit: '25mb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
