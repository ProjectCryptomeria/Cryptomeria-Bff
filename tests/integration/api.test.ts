import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app';
import { runner } from '../../src/services/experimentRunner';

// Runnerのメソッドをスパイ
const startJobSpy = vi.spyOn(runner, 'startJob').mockImplementation(async () => { });

describe('Experiment API Integration', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('POST /run: 正しいリクエストで202を返し、バックグラウンド処理を開始する', async () => {
		const payload = {
			scenarios: [{
				id: 1, uniqueId: 's1', userId: 'u1', dataSize: 100, chunkSize: 64,
				allocator: 'RoundRobin', transmitter: 'OneByOne', chains: 1,
				targetChains: ['c1'], cost: 0, status: 'READY'
			}]
		};

		const res = await app.request('/api/experiment/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		// レスポンス確認
		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body.jobId).toBeDefined();

		// バックグラウンド処理が呼ばれたことを確認 (非同期のsetImmediateを待つために少し待機)
		await new Promise(resolve => setTimeout(resolve, 10));

		// 重要な検証ポイント: APIが適切にRunnerへ処理を委譲しているか
		expect(startJobSpy).toHaveBeenCalledTimes(1);
		expect(startJobSpy).toHaveBeenCalledWith(body.jobId, expect.objectContaining({
			scenarios: expect.any(Array)
		}));
	});
});