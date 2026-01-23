/**
 * 第3層 Utilities APIルート
 * 
 * API第三層仕様書marged.md に準拠
 * すべての処理はジョブ化して202 Accepted返却
 * P0-2: setPrivatePayload 統合、入力検証強化
 */

import { Hono } from 'hono';
import type { JobRunner } from '../jobs/job-runner.js';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import type { EnvConfig } from '../config/env.js';
import { jobCreatedResponse, textResponse } from '../lib/http.js';
import { invalidArgumentError, notFoundError, rateLimitedError } from '../lib/errors.js';
import { nowISO } from '../lib/time.js';
import { setPrivatePayload } from '../jobs/definitions/utils.js';

/**
 * Utilities APIルートを作成
 */
export function createUtilsRoutes(
    cryptomeriaManager: CryptomeriaManager,
    jobRunner: JobRunner,
    config: EnvConfig
): Hono {
    const app = new Hono();

    // ===== Helper: Rate limit check =====
    const checkRateLimit = () => {
        const runningCount = jobRunner.getStore().getRunningCount('utils');
        if (runningCount >= config.maxRunningUtilsJobs) {
            throw rateLimitedError('Too many running jobs', {
                maxRunningJobs: config.maxRunningUtilsJobs,
                currentRunning: runningCount,
            });
        }
    };

    // ===== /observe エンドポイント =====

    /**
     * POST /observe/tx-confirmation - Tx確定待ち（ジョブ）
     */
    app.post('/observe/tx-confirmation', async (c) => {
        checkRateLimit();

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

        // Prepare private payload
        const privatePayload = {
            chainId: body.chainId,
            txhash: body.txhash,
            timeoutMs,
            pollIntervalMs,
        };

        // Create job with onBeforeRun callback to set payload before job starts
        const job = await jobRunner.createAndRun('utils', 'utils.observe.tx-confirmation', {
            chainId: body.chainId,
            txhash: body.txhash.substring(0, 16) + '...', // Truncated for display
            timeoutMs,
            pollIntervalMs,
        }, timeoutMs, (jobId) => setPrivatePayload(jobId, privatePayload));

        return jobCreatedResponse(c, job);
    });

    /**
     * POST /observe/tx-confirmation-batch - 複数Tx確定待ち（ジョブ）
     */
    app.post('/observe/tx-confirmation-batch', async (c) => {
        checkRateLimit();

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
        if (body.txhashes.length > config.maxBatchSize) {
            throw invalidArgumentError(`txhashes.length must be <= ${config.maxBatchSize}`, {
                field: 'txhashes',
                max: config.maxBatchSize,
                actual: body.txhashes.length,
            });
        }

        const timeoutMs = body.timeoutMs ?? 300000;
        const pollIntervalMs = body.pollIntervalMs ?? 1000;
        let maxConcurrency = body.maxConcurrency ?? config.maxConcurrency;

        if (maxConcurrency > config.maxConcurrency) {
            maxConcurrency = config.maxConcurrency; // clamp
        }
        if (timeoutMs < 1000) {
            throw invalidArgumentError('timeoutMs must be >= 1000', { field: 'timeoutMs' });
        }
        if (pollIntervalMs < 200) {
            throw invalidArgumentError('pollIntervalMs must be >= 200', { field: 'pollIntervalMs' });
        }

        const job = await jobRunner.createAndRun('utils', 'utils.observe.tx-confirmation-batch', {
            chainId: body.chainId,
            txhashCount: body.txhashes.length,
            timeoutMs,
            pollIntervalMs,
            maxConcurrency,
            stopOnFirstError: body.stopOnFirstError ?? false,
        }, timeoutMs, (jobId) => setPrivatePayload(jobId, {
            chainId: body.chainId,
            txhashes: body.txhashes,
            timeoutMs,
            pollIntervalMs,
            maxConcurrency,
        }));

        return jobCreatedResponse(c, job);
    });

    // ===== /metrics エンドポイント =====

    /**
     * POST /metrics/throughput - TPS算出（ジョブ）
     */
    app.post('/metrics/throughput', async (c) => {
        checkRateLimit();

        const body = await c.req.json() as {
            chainId?: string;
            window?: number;
            mode?: string;
            timeoutMs?: number;
            concurrency?: number;
        };

        if (!body.chainId) {
            throw invalidArgumentError('chainId is required', { field: 'chainId' });
        }

        const window = body.window ?? 100;
        const timeoutMs = body.timeoutMs ?? 120000;
        const concurrency = body.concurrency ?? 5;

        if (window < 2) {
            throw invalidArgumentError('window must be >= 2', { field: 'window' });
        }
        if (window > config.blocktimeMaxWindow) {
            throw invalidArgumentError(`window must be <= ${config.blocktimeMaxWindow}`, { field: 'window' });
        }

        const job = await jobRunner.createAndRun('utils', 'utils.metrics.throughput', {
            chainId: body.chainId,
            window,
            mode: body.mode ?? 'auto',
        }, timeoutMs, (jobId) => setPrivatePayload(jobId, {
            chainId: body.chainId,
            window,
            concurrency,
        }));

        return jobCreatedResponse(c, job);
    });

    /**
     * POST /metrics/resource-snapshot - リソーススナップショット（ジョブ）
     */
    app.post('/metrics/resource-snapshot', async (c) => {
        checkRateLimit();

        const body = await c.req.json() as {
            namespace?: string;
            include?: string[];
            timeoutMs?: number;
        };

        const namespace = body.namespace ?? config.k8sNamespace;
        const include = body.include ?? ['systemStatus', 'pods', 'services', 'chainsStatus'];
        const timeoutMs = body.timeoutMs ?? 60000;

        const job = await jobRunner.createAndRun('utils', 'utils.metrics.resource-snapshot', {
            namespace,
            include,
        }, timeoutMs, (jobId) => setPrivatePayload(jobId, {
            namespace,
            include,
        }));

        return jobCreatedResponse(c, job);
    });

    // ===== /load エンドポイント =====

    // Helper for Base64 validation
    const isValidBase64 = (str: string): boolean => {
        try {
            return btoa(atob(str)) === str;
        } catch {
            return false;
        }
    };

    const MAX_TX_BASE64_CHARS = 100000;

    // ... (in createUtilsRoutes)

    /**
     * POST /load/broadcast-batch - 並列ブロードキャスト（ジョブ）
     */
    app.post('/load/broadcast-batch', async (c) => {
        checkRateLimit();

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
        if (body.txBytesBase64List.length > config.maxBatchSize) {
            throw invalidArgumentError(`txBytesBase64List.length must be <= ${config.maxBatchSize}`, {
                field: 'txBytesBase64List',
                max: config.maxBatchSize,
                actual: body.txBytesBase64List.length,
            });
        }

        // Strict Validation
        for (let i = 0; i < body.txBytesBase64List.length; i++) {
            const tx = body.txBytesBase64List[i];
            if (tx.length > MAX_TX_BASE64_CHARS) {
                throw invalidArgumentError(`txBytesBase64 at index ${i} exceeds max length ${MAX_TX_BASE64_CHARS}`, { index: i });
            }
            if (!isValidBase64(tx)) {
                throw invalidArgumentError(`txBytesBase64 at index ${i} is not valid Base64`, { index: i });
            }
        }

        const broadcastMode = body.broadcastMode ?? 'sync';
        if (!['sync', 'async', 'commit'].includes(broadcastMode)) {
            throw invalidArgumentError('broadcastMode must be sync|async|commit', { field: 'broadcastMode' });
        }

        const timeoutMs = body.timeoutMs ?? 300000;
        let maxConcurrency = body.maxConcurrency ?? config.maxConcurrency;
        if (maxConcurrency > config.maxConcurrency) {
            maxConcurrency = config.maxConcurrency;
        }

        const job = await jobRunner.createAndRun('utils', 'utils.load.broadcast-batch', {
            chainId: body.chainId,
            txCount: body.txBytesBase64List.length,
            broadcastMode,
            maxConcurrency,
            stopOnFirstError: body.stopOnFirstError ?? false,
        }, timeoutMs, (jobId) => setPrivatePayload(jobId, {
            chainId: body.chainId,
            txBytesBase64List: body.txBytesBase64List,
            broadcastMode,
            maxConcurrency,
            stopOnFirstError: body.stopOnFirstError ?? false,
        }));

        return jobCreatedResponse(c, job);
    });

    /**
     * POST /load/broadcast-and-confirm - ブロードキャスト＋確定待ち（ジョブ）
     */
    app.post('/load/broadcast-and-confirm', async (c) => {
        checkRateLimit();

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
        if (body.txBytesBase64List.length > config.maxBatchSize) {
            throw invalidArgumentError(`txBytesBase64List.length must be <= ${config.maxBatchSize}`, {
                field: 'txBytesBase64List',
                max: config.maxBatchSize,
                actual: body.txBytesBase64List.length,
            });
        }

        const broadcastMode = body.broadcastMode ?? 'sync';
        if (!['sync', 'async', 'commit'].includes(broadcastMode)) {
            throw invalidArgumentError('broadcastMode must be sync|async|commit', { field: 'broadcastMode' });
        }

        const timeoutMs = body.timeoutMs ?? 600000;
        const pollIntervalMs = body.pollIntervalMs ?? 1000;
        let maxConcurrency = body.maxConcurrency ?? 10;

        if (maxConcurrency > config.maxConcurrency) {
            maxConcurrency = config.maxConcurrency;
        }
        if (pollIntervalMs < 200) {
            throw invalidArgumentError('pollIntervalMs must be >= 200', { field: 'pollIntervalMs' });
        }

        const job = await jobRunner.createAndRun('utils', 'utils.load.broadcast-and-confirm', {
            chainId: body.chainId,
            txCount: body.txBytesBase64List.length,
            broadcastMode,
            maxConcurrency,
            pollIntervalMs,
        }, timeoutMs, (jobId) => setPrivatePayload(jobId, {
            chainId: body.chainId,
            txBytesBase64List: body.txBytesBase64List,
            broadcastMode,
            maxConcurrency,
            pollIntervalMs,
            stopOnFirstError: false,
        }));

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
        let limit = limitStr ? parseInt(limitStr, 10) : 50;

        // Clamp to max 200
        if (limit > 200) limit = 200;
        if (limit < 1) limit = 1;

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
     * P2-1: sinceSeconds 対応
     */
    app.get('/jobs/:jobId/logs', (c) => {
        const jobId = c.req.param('jobId');
        const tailLinesStr = c.req.query('tailLines');
        const sinceSecondsStr = c.req.query('sinceSeconds');
        let tailLines = tailLinesStr ? parseInt(tailLinesStr, 10) : 200;
        const sinceSeconds = sinceSecondsStr ? parseInt(sinceSecondsStr, 10) : undefined;

        // Clamp and validate
        if (tailLines < 0) {
            throw invalidArgumentError('tailLines must be >= 0', { field: 'tailLines' });
        }
        if (tailLines > 5000) tailLines = 5000;

        if (sinceSeconds !== undefined && (isNaN(sinceSeconds) || sinceSeconds < 0)) {
            throw invalidArgumentError('sinceSeconds must be >= 0', { field: 'sinceSeconds' });
        }

        const job = jobRunner.getStore().get(jobId);
        if (!job || job.scope !== 'utils') {
            throw notFoundError('Job not found', { jobId });
        }

        const logs = jobRunner.getStore().getLogs(jobId, tailLines, sinceSeconds);

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

