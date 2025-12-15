import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { experiments, results } from '../db/schema';
import { RunExperimentRequest, RunScenario } from '../types';
import { GwcClient } from './gwcClient';

// ランダムなバッファを生成するヘルパー
const generateRandomBuffer = (sizeMB: number): Buffer => {
	const sizeBytes = sizeMB * 1024 * 1024;
	return Buffer.alloc(sizeBytes, 'x'); // 簡易的に埋める（本番は crypto.randomBytes 等を使用）
};

export class ExperimentRunner {
	private gwc: GwcClient;

	constructor() {
		this.gwc = new GwcClient();
	}

	// 非同期でジョブを開始
	async startJob(jobId: string, request: RunExperimentRequest) {
		console.log(`[Runner] Starting Job: ${jobId}`);

		// ステータス更新: RUNNING
		db.update(experiments)
			.set({ status: 'RUNNING' })
			.where(eq(experiments.id, jobId))
			.run();

		try {
			for (const scenario of request.scenarios) {
				await this.runScenario(jobId, scenario);
			}

			// ステータス更新: COMPLETED
			db.update(experiments)
				.set({ status: 'COMPLETED' })
				.where(eq(experiments.id, jobId))
				.run();

			console.log(`[Runner] Job Completed: ${jobId}`);

		} catch (e) {
			console.error(`[Runner] Job Failed:`, e);
			db.update(experiments)
				.set({ status: 'FAILED' })
				.where(eq(experiments.id, jobId))
				.run();
		}
	}

	private async runScenario(jobId: string, scenario: RunScenario) {
		const logs: string[] = [];
		logs.push(`[Start] Scenario: ${scenario.uniqueId}, Size: ${scenario.dataSize}MB`);

		let status = 'FAILED';
		let uploadTimeMs = 0;
		let throughputBps = 0;

		try {
			// 1. データ生成
			logs.push(`[Gen] Generating ${scenario.dataSize}MB random data...`);
			const data = generateRandomBuffer(scenario.dataSize);

			// 2. GWCへ送信
			logs.push(`[Upload] Uploading to GWC...`);
			// NOTE: 本来はここで「Allocater/Transmitter」戦略に応じたループ処理が入る
			// Phase 1では「シングルアップロード」として実装
			const result = await this.gwc.uploadFile(`test-${uuidv4()}.bin`, data);

			uploadTimeMs = result.timeMs;
			status = 'SUCCESS';

			// スループット計算 (Bytes / Sec)
			const seconds = uploadTimeMs / 1000;
			if (seconds > 0) {
				throughputBps = (scenario.dataSize * 1024 * 1024) / seconds;
			}

			logs.push(`[Done] Success! Time: ${uploadTimeMs.toFixed(2)}ms`);

		} catch (e: any) {
			logs.push(`[Error] ${e.message}`);
		}

		// 3. 結果保存
		db.insert(results).values({
			id: uuidv4(),
			experimentId: jobId,
			scenarioId: scenario.uniqueId,
			status,
			dataSizeMB: scenario.dataSize,
			uploadTimeMs: Math.floor(uploadTimeMs),
			throughputBps,
			logs: JSON.stringify(logs),
		}).run();
	}
}

export const runner = new ExperimentRunner();