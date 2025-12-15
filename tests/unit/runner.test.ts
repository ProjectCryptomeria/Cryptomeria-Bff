import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { experiments } from '../../src/db/schema';
import { ExperimentRunner } from '../../src/services/experimentRunner';
import { GwcClient } from '../../src/services/gwcClient'; // 型として利用

describe('ExperimentRunner Unit Test', () => {
	let runner: ExperimentRunner;
	let mockGwc: GwcClient;

	beforeEach(() => {
		vi.clearAllMocks();

		// 1. クラスのモックを「オブジェクト」として手動作成 (確実)
		mockGwc = {
			uploadFile: vi.fn().mockResolvedValue({ success: true, timeMs: 100 })
		} as unknown as GwcClient;

		// 2. Mockを注入してRunnerを初期化
		runner = new ExperimentRunner();
	});

	it('シナリオ実行成功時にステータスがCOMPLETEDになり、結果が保存される', async () => {
		const jobId = uuidv4();

		// 事前データ投入
		db.insert(experiments).values({
			id: jobId,
			status: 'PENDING',
			config: '{}'
		}).run();

		// 実行
		await runner.startJob(jobId, {
			scenarios: [{
				id: 1, uniqueId: 'scenario-1', userId: 'u1',
				dataSize: 10, chunkSize: 64, allocator: 'RoundRobin',
				transmitter: 'OneByOne', chains: 1, targetChains: ['c1'],
				cost: 0, status: 'READY'
			}]
		} as any);

		// 検証: 注入したMockオブジェクトが呼ばれたか確認
		expect(mockGwc.uploadFile).toHaveBeenCalledTimes(1);

		// DB検証
		const exp = db.select().from(experiments).where(eq(experiments.id, jobId)).get();
		expect(exp?.status).toBe('COMPLETED');
	});
});