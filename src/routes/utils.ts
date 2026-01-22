/**
 * 第3層 Utilities APIルート
 * 
 * API第三層仕様書に準拠
 * すべての処理はジョブ化して202 Accepted返却
 */

import { Hono } from 'hono';
import type { JobRunner } from '../jobs/job-runner.js';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import { jobCreatedResponse, textResponse } from '../lib/http.js';
import { invalidArgumentError, notFoundError } from '../lib/errors.js';
import { nowISO } from '../lib/time.js';

/**
 * Utilities APIルートを作成
 */
export function createUtilsRoutes(cryptomeriaManager: CryptomeriaManager, jobRunner: JobRunner): Hono {
    const app = new Hono();

    // ===== /observe エンドポイント =====

    /**
     * POST /observe/tx-confirmation - Tx確定待ち（ジョブ）
     */
    app.post('/observe/tx-confirmation', async (c) => {
        const body = await c.req.json() as {
            chainId?: string;
            txhash?: string;
            timeoutMs?: number;
            pollIntervalMs?: number;
        };

        if (!body.chainId) {
            throw invalidArgumentError('chainId is required', { field: 'chainId' });
        }
        if (!body.txhash) {
            throw invalidArgumentError('txhash is required', { field: 'txhash' });
        }

        const timeoutMs = body.timeoutMs ?? 300000;
        const pollIntervalMs = body.pollIntervalMs ?? 1000;

        if (timeoutMs < 1000) {
            throw invalidArgumentError('timeoutMs must be >= 1000', { field: 'timeoutMs' });
        }
        if (pollIntervalMs < 200) {
            throw invalidArgumentError('pollIntervalMs must be >= 200', { field: 'pollIntervalMs' });
        }

        const job = await jobRunner.createAndRun('utils', 'utils.observe.tx-confirmation', {
            chainId: body.chainId,
            txhash: body.txhash,
            timeoutMs,
            pollIntervalMs,
        }, timeoutMs);

        return jobCreatedResponse(c, job);
    });

    /**
     * POST /observe/tx-confirmation-batch - 複数Tx確定待ち（ジョブ）
     */
    app.post('/observe/tx-confirmation-batch', async (c) => {
        const body = await c.req.json() as {
            chainId?: string;
            txhashes?: string[];
            timeoutMs?: number;
            pollIntervalMs?: number;
            maxConcurrency?: number;
            stopOnFirstError?: boolean;
        };

        if (!body.chainId) {
            throw invalidArgumentError('chainId is required', { field: 'chainId' });
        }
        if (!body.txhashes || body.txhashes.length === 0) {
            throw invalidArgumentError('txhashes is required and must not be empty', { field: 'txhashes' });
        }

        const timeoutMs = body.timeoutMs ?? 300000;
        const pollIntervalMs = body.pollIntervalMs ?? 1000;
        const maxConcurrency = body.maxConcurrency ?? 20;

        const job = await jobRunner.createAndRun('utils', 'utils.observe.tx-confirmation-batch', {
            chainId: body.chainId,
            txhashCount: body.txhashes.length, // Don't log actual txhashes
            timeoutMs,
            pollIntervalMs,
            maxConcurrency,
            stopOnFirstError: body.stopOnFirstError ?? false,
        }, timeoutMs);

        return jobCreatedResponse(c, job);
    });

    // ===== /metrics エンドポイント =====

    /**
     * POST /metrics/throughput - TPS算出（ジョブ）
     */
    app.post('/metrics/throughput', async (c) => {
        const body = await c.req.json() as {
            chainId?: string;
            window?: number;
            mode?: string;
            timeoutMs?: number;
        };

        if (!body.chainId) {
            throw invalidArgumentError('chainId is required', { field: 'chainId' });
        }

        const window = body.window ?? 100;
        const timeoutMs = body.timeoutMs ?? 120000;

        if (window < 2) {
            throw invalidArgumentError('window must be >= 2', { field: 'window' });
        }
        if (window > 2000) {
            throw invalidArgumentError('window must be <= 2000', { field: 'window' });
        }

        const job = await jobRunner.createAndRun('utils', 'utils.metrics.throughput', {
            chainId: body.chainId,
            window,
            mode: body.mode ?? 'auto',
        }, timeoutMs);

        return jobCreatedResponse(c, job);
    });

    /**
     * POST /metrics/resource-snapshot - リソーススナップショット（ジョブ）
     */
    app.post('/metrics/resource-snapshot', async (c) => {
        const body = await c.req.json() as {
            namespace?: string;
            include?: string[];
            timeoutMs?: number;
        };

        const timeoutMs = body.timeoutMs ?? 60000;

        const job = await jobRunner.createAndRun('utils', 'utils.metrics.resource-snapshot', {
            namespace: body.namespace ?? 'cryptomeria',
            include: body.include ?? ['systemStatus', 'pods', 'services', 'chainsStatus'],
        }, timeoutMs);

        return jobCreatedResponse(c, job);
    });

    // ===== /load エンドポイント =====

    /**
     * POST /load/broadcast-batch - 並列ブロードキャスト（ジョブ）
     */
    app.post('/load/broadcast-batch', async (c) => {
        const body = await c.req.json() as {
            chainId?: string;
            txBytesBase64List?: string[];
            broadcastMode?: string;
            maxConcurrency?: number;
            timeoutMs?: number;
            stopOnFirstError?: boolean;
        };

        if (!body.chainId) {
            throw invalidArgumentError('chainId is required', { field: 'chainId' });
        }
        if (!body.txBytesBase64List || body.txBytesBase64List.length === 0) {
            throw invalidArgumentError('txBytesBase64List is required and must not be empty', { field: 'txBytesBase64List' });
        }

        const timeoutMs = body.timeoutMs ?? 300000;
        const maxConcurrency = body.maxConcurrency ?? 20;

        const job = await jobRunner.createAndRun('utils', 'utils.load.broadcast-batch', {
            chainId: body.chainId,
            txCount: body.txBytesBase64List.length, // Don't log actual tx bytes
            broadcastMode: body.broadcastMode ?? 'sync',
            maxConcurrency,
            stopOnFirstError: body.stopOnFirstError ?? false,
        }, timeoutMs);

        return jobCreatedResponse(c, job);
    });

    /**
     * POST /load/broadcast-and-confirm - ブロードキャスト＋確定待ち（ジョブ）
     */
    app.post('/load/broadcast-and-confirm', async (c) => {
        const body = await c.req.json() as {
            chainId?: string;
            txBytesBase64List?: string[];
            broadcastMode?: string;
            maxConcurrency?: number;
            timeoutMs?: number;
            pollIntervalMs?: number;
        };

        if (!body.chainId) {
            throw invalidArgumentError('chainId is required', { field: 'chainId' });
        }
        if (!body.txBytesBase64List || body.txBytesBase64List.length === 0) {
            throw invalidArgumentError('txBytesBase64List is required and must not be empty', { field: 'txBytesBase64List' });
        }

        const timeoutMs = body.timeoutMs ?? 600000;
        const pollIntervalMs = body.pollIntervalMs ?? 1000;

        if (pollIntervalMs < 200) {
            throw invalidArgumentError('pollIntervalMs must be >= 200', { field: 'pollIntervalMs' });
        }

        const job = await jobRunner.createAndRun('utils', 'utils.load.broadcast-and-confirm', {
            chainId: body.chainId,
            txCount: body.txBytesBase64List.length,
            broadcastMode: body.broadcastMode ?? 'sync',
            maxConcurrency: body.maxConcurrency ?? 10,
            pollIntervalMs,
        }, timeoutMs);

        return jobCreatedResponse(c, job);
    });

    // ===== ジョブAPI（Utilsスコープ） =====

    /**
     * GET /jobs - ジョブ一覧
     */
    app.get('/jobs', (c) => {
        const status = c.req.query('status') as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | undefined;
        const type = c.req.query('type');
        const limitStr = c.req.query('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 50;

        const items = jobRunner.getStore().list({ scope: 'utils', status, type, limit });

        return c.json({ items });
    });

    /**
     * GET /jobs/:jobId - ジョブ詳細
     */
    app.get('/jobs/:jobId', (c) => {
        const jobId = c.req.param('jobId');
        const job = jobRunner.getStore().get(jobId);

        if (!job || job.scope !== 'utils') {
            throw notFoundError('Job not found', { jobId });
        }

        return c.json(job);
    });

    /**
     * GET /jobs/:jobId/logs - ジョブログ
     */
    app.get('/jobs/:jobId/logs', (c) => {
        const jobId = c.req.param('jobId');
        const tailLinesStr = c.req.query('tailLines');
        const tailLines = tailLinesStr ? parseInt(tailLinesStr, 10) : 200;

        const job = jobRunner.getStore().get(jobId);
        if (!job || job.scope !== 'utils') {
            throw notFoundError('Job not found', { jobId });
        }

        const logs = jobRunner.getStore().getLogs(jobId, tailLines);

        return textResponse(c, logs);
    });

    /**
     * POST /jobs/:jobId/cancel - ジョブキャンセル
     */
    app.post('/jobs/:jobId/cancel', (c) => {
        const jobId = c.req.param('jobId');

        const job = jobRunner.getStore().get(jobId);
        if (!job || job.scope !== 'utils') {
            throw notFoundError('Job not found', { jobId });
        }

        const updated = jobRunner.cancel(jobId);

        return c.json({
            jobId,
            status: updated?.status ?? 'canceled',
            canceledAt: nowISO(),
        });
    });

    return app;
}
