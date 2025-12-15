import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { RunExperimentRequestSchema } from '../types';

const app = new Hono();

// POST /api/experiment/run
app.post(
	'/run',
	zValidator('json', RunExperimentRequestSchema),
	async (c) => {
		const { scenarios } = c.req.valid('json');

		// TODO: ここで実際の負荷試験ジョブをバックグラウンドで開始する
		// Phase 1後半で実装: JobQueueへの追加とGWCへのアップロード処理

		const jobId = uuidv4();
		console.log(`[BFF] Experiment Job Started: ${jobId}, Scenarios: ${scenarios.length}`);

		return c.json({
			jobId,
			message: 'Experiment started',
			status: 'accepted'
		}, 202);
	}
);

export default app;