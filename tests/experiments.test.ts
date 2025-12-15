import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { AllocatorStrategy, TransmitterStrategy } from '../src/types';

describe('Experiment API', () => {
	it('POST /api/experiment/run - 正常なシナリオを受け取り、Job IDを返す (202 Accepted)', async () => {
		// 1. テストデータ (WebUIが送信してくる形式)
		const payload = {
			scenarios: [
				{
					id: 1,
					uniqueId: 'test-scenario-001',
					userId: 'u1',
					dataSize: 100, // 100MB
					chunkSize: 64,
					allocator: AllocatorStrategy.ROUND_ROBIN,
					transmitter: TransmitterStrategy.ONE_BY_ONE,
					chains: 1,
					targetChains: ['datachain-0'],
					cost: 0,
					status: 'READY'
				}
			]
		};

		// 2. リクエスト実行
		const res = await app.request('/api/experiment/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		// 3. 検証
		expect(res.status).toBe(202);

		const body = await res.json();
		expect(body).toHaveProperty('jobId');
		expect(typeof body.jobId).toBe('string');
		expect(body.message).toBe('Experiment started');
	});

	it('POST /api/experiment/run - 不正なデータは拒否する (400 Bad Request)', async () => {
		const invalidPayload = { scenarios: [] }; // 空配列はNG

		const res = await app.request('/api/experiment/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(invalidPayload),
		});

		expect(res.status).toBe(400);
	});
});