import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import experimentRoute from './routes/experiment';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Routes
app.basePath('/api').route('/experiment', experimentRoute);

export default app;