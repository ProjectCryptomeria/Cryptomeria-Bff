import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import app from '../src/app'; // src/index ではなく src/app
import { db } from '../src/db';
import { experiments } from '../src/db/schema';
import { AllocatorStrategy, TransmitterStrategy } from '../src/types';

// fetchをグローバルにモック化 (GWCがなくても成功させるため)
const fetchSpy = vi.spyOn(global, 'fetch');

describe('Experiment Integration Test', () => {
	it('POST /run 実行後、DBに保存され、GWCへの送信が試行される', async () => {
		// 1. fetchが成功レスポンスを返すように設定
		fetchSpy.mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => 'ok',
			json: async () => ({}),
		} as Response);

		const payload = {
			scenarios: [
				{
					id: 1, uniqueId: 'integration-test-01', userId: 'u1',
					dataSize: 1, chunkSize: 64,
					allocator: AllocatorStrategy.ROUND_ROBIN,
					transmitter: TransmitterStrategy.ONE_BY_ONE,
					chains: 1, targetChains: ['datachain-0'],
					cost: 0, status: 'READY'
				}
			]
		};

		const res = await app.request('/api/experiment/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		expect(res.status).toBe(202);
		const body = await res.json();
		const jobId = body.jobId;

		// 非同期処理を少し待つ
		await new Promise(r => setTimeout(r, 100));

		// 検証: fetchがGWCのエンドポイント(環境変数 or default)に呼ばれたか
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining('http://localhost:8080/upload'),
			expect.anything()
		);

		// DB検証: ステータスがCOMPLETEDになっているはず (fetchをmockで成功させたため)
		const record = db.select().from(experiments).where(eq(experiments.id, jobId)).get();
		expect(record?.status).toBe('COMPLETED');
	});
});