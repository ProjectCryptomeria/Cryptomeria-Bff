import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { experiments } from '../db/schema';
import { runner } from '../services/experimentRunner';
import { RunExperimentRequestSchema } from '../types';

const app = new Hono();

app.post('/run', zValidator('json', RunExperimentRequestSchema), async (c) => {
	const req = c.req.valid('json');
	const jobId = uuidv4();

	// 1. DBにジョブレコードを作成 (PENDING)
	db.insert(experiments).values({
		id: jobId,
		status: 'PENDING',
		config: JSON.stringify(req),
	}).run();

	// 2. 非同期で実行開始 (Fire & Forget)
	// setImmediateを使うことでレスポンス返却後に処理を回す
	setImmediate(() => {
		runner.startJob(jobId, req);
	});

	return c.json({
		jobId,
		message: 'Experiment started',
		status: 'accepted'
	}, 202);
});

export default app;