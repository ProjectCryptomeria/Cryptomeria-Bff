/**
 * 第1層 System/K8s APIルート
 * 
 * API第一層仕様書に準拠
 */

import { Hono } from 'hono';
import type { K8sManager } from '../managers/k8s-manager.js';
import type { JobRunner } from '../jobs/job-runner.js';
import { okResponse, textResponse } from '../lib/http.js';
import { invalidArgumentError, notFoundError, conflictError } from '../lib/errors.js';
import { nowISO } from '../lib/time.js';

/**
 * System APIルートを作成
 */
export function createSystemRoutes(k8sManager: K8sManager, jobRunner: JobRunner): Hono {
    const app = new Hono();

    // ===== 状態・探索（同期） =====

    /**
     * GET /status - システム稼働状況の要約
     */
    app.get('/status', async (c) => {
        const verbose = c.req.query('verbose') === 'true';
        const namespace = k8sManager.getNamespace();

        const summary = await k8sManager.getSystemStatus();
        const relayer = await k8sManager.getRelayerStatus();
        const chains = await k8sManager.getChainStatuses();

        const data: Record<string, unknown> = {
            namespace,
            observedAt: nowISO(),
            summary,
            relayer,
            chains: verbose ? chains : chains.map((ch) => ({
                chainId: ch.chainId,
                podName: ch.podName,
                ready: ch.ready,
            })),
            notes: ['helm operations are out of scope in v1'],
        };

        return okResponse(c, data);
    });

    /**
     * GET /preflight - /start実行前の前提チェック
     */
    app.get('/preflight', async (c) => {
        const namespace = k8sManager.getNamespace();
        const checks = await k8sManager.runPreflightChecks();

        const overallOk = checks.every((ch) => ch.ok);

        return okResponse(c, {
            namespace,
            observedAt: nowISO(),
            checks,
            overallOk,
        });
    });

    /**
     * GET /topology - chain pod/service/port対応
     */
    app.get('/topology', async (c) => {
        const namespace = k8sManager.getNamespace();
        const topology = await k8sManager.getTopology();

        return okResponse(c, {
            namespace,
            observedAt: nowISO(),
            ...topology,
        });
    });

    /**
     * GET /ports - ポート一覧
     */
    app.get('/ports', async (c) => {
        const namespace = k8sManager.getNamespace();
        const nodeHost = k8sManager.getNodeHost();
        const chains = await k8sManager.getChainPorts();

        return okResponse(c, {
            namespace,
            nodeHost,
            chains,
        });
    });

    // ===== K8sリソース参照 =====

    /**
     * GET /k8s/pods - Pod一覧
     */
    app.get('/k8s/pods', async (c) => {
        const selector = c.req.query('selector');
        const name = c.req.query('name');
        const includeContainers = c.req.query('includeContainers') === 'true';

        const items = await k8sManager.listPods({ selector, name, includeContainers });

        return okResponse(c, { items });
    });

    /**
     * GET /k8s/services - Service一覧
     */
    app.get('/k8s/services', async (c) => {
        const selector = c.req.query('selector');
        const name = c.req.query('name');

        const items = await k8sManager.listServices({ selector, name });

        return okResponse(c, { items });
    });

    /**
     * GET /k8s/endpoints - Endpoints一覧
     */
    app.get('/k8s/endpoints', async (c) => {
        const selector = c.req.query('selector');
        const name = c.req.query('name');

        const items = await k8sManager.listEndpoints({ selector, name });

        return okResponse(c, { items });
    });

    /**
     * GET /k8s/configmaps - ConfigMap一覧
     */
    app.get('/k8s/configmaps', async (c) => {
        const name = c.req.query('name');
        const includeData = c.req.query('includeData') === 'true';

        const items = await k8sManager.listConfigMaps({ name, includeData });

        return okResponse(c, { items });
    });

    /**
     * GET /k8s/logs - Podログ取得
     */
    app.get('/k8s/logs', async (c) => {
        const podName = c.req.query('podName');
        const container = c.req.query('container');
        const tailLinesStr = c.req.query('tailLines');
        const sinceSecondsStr = c.req.query('sinceSeconds');

        if (!podName) {
            throw invalidArgumentError('podName is required', { field: 'podName' });
        }

        const tailLines = tailLinesStr ? parseInt(tailLinesStr, 10) : 200;
        const sinceSeconds = sinceSecondsStr ? parseInt(sinceSecondsStr, 10) : undefined;

        if (isNaN(tailLines) || tailLines < 0) {
            throw invalidArgumentError('tailLines must be a positive number', { field: 'tailLines' });
        }

        const logs = await k8sManager.getPodLogs({ podName, container, tailLines, sinceSeconds });

        return textResponse(c, logs);
    });

    // ===== System操作（ジョブ or dryRun） =====

    /**
     * POST /start - システム起動（relayer含む）
     * P0-3: dryRun=true → 200 + plan[], dryRun=false → 202 + jobId
     */
    app.post('/start', async (c) => {
        const body = await c.req.json() as {
            force?: boolean;
            timeoutMs?: number;
            dryRun?: boolean;
        };

        const force = body.force ?? false;
        const timeoutMs = body.timeoutMs ?? 600000;
        const dryRun = body.dryRun ?? false;

        // バリデーション
        if (timeoutMs < 0) {
            throw invalidArgumentError('timeoutMs must be >= 0', { field: 'timeoutMs' });
        }

        // dryRun=true: 実行計画を返す
        if (dryRun) {
            const plan = [
                { step: 'discover', action: 'run', reason: 'Always run to detect pods' },
                { step: 'initRelayer', action: force ? 'run' : 'run', reason: force ? 'force=true' : 'Idempotency check pending' },
                { step: 'connectAll', action: 'run', reason: 'Connect all discovered chains' },
                { step: 'startRelayer', action: 'run', reason: 'Start relayer process' },
                { step: 'waitReady', action: 'run', reason: 'Wait for IBC ready state' },
            ];
            return c.json({ plan });
        }

        // dryRun=false: ジョブ作成
        const job = await jobRunner.createAndRun('system', 'system.start', {
            force,
            timeoutMs,
        }, timeoutMs);

        return c.json({
            jobId: job.jobId,
            type: job.type,
            status: job.status,
            createdAt: job.createdAt,
        }, 202);
    });

    /**
     * POST /connect - チェーン接続
     * P0-3: target対応
     */
    app.post('/connect', async (c) => {
        const body = await c.req.json() as {
            force?: boolean;
            timeoutMs?: number;
            target?: string;
            dryRun?: boolean;
        };

        const force = body.force ?? false;
        const timeoutMs = body.timeoutMs ?? 600000;
        const target = body.target ?? 'all';
        const dryRun = body.dryRun ?? false;

        // バリデーション
        if (timeoutMs < 0) {
            throw invalidArgumentError('timeoutMs must be >= 0', { field: 'timeoutMs' });
        }

        // target形式チェック: "all" or "chain:<chainId>"
        if (target !== 'all' && !target.startsWith('chain:')) {
            throw invalidArgumentError('target must be "all" or "chain:<chainId>"', { field: 'target', value: target });
        }

        // dryRun=true: 実行計画を返す
        if (dryRun) {
            const plan = [
                { step: 'discover', action: 'run', reason: 'Always run to detect pods' },
                { step: 'connectAll', action: 'run', reason: `Connect target: ${target}` },
            ];
            return c.json({ plan });
        }

        // dryRun=false: ジョブ作成
        const job = await jobRunner.createAndRun('system', 'system.connect', {
            force,
            target,
            timeoutMs,
        }, timeoutMs);

        return c.json({
            jobId: job.jobId,
            type: job.type,
            status: job.status,
            createdAt: job.createdAt,
        }, 202);
    });

    /**
     * POST /relayer/restart - Relayer再起動
     * P0-3: 新規追加
     */
    app.post('/relayer/restart', async (c) => {
        const body = await c.req.json() as {
            timeoutMs?: number;
            dryRun?: boolean;
        };

        const timeoutMs = body.timeoutMs ?? 120000;
        const dryRun = body.dryRun ?? false;

        // バリデーション
        if (timeoutMs < 0) {
            throw invalidArgumentError('timeoutMs must be >= 0', { field: 'timeoutMs' });
        }

        // dryRun=true: 実行計画を返す
        if (dryRun) {
            const plan = [
                { step: 'discover', action: 'run', reason: 'Find relayer pod' },
                { step: 'restartRelayer', action: 'run', reason: 'Restart relayer process' },
            ];
            return c.json({ plan });
        }

        // dryRun=false: ジョブ作成
        // Conflict check: existing running job
        if (jobRunner.getStore().hasRunning('system')) {
            throw conflictError('A system job is already running');
        }

        const job = await jobRunner.createAndRun('system', 'system.relayer.restart', {
            timeoutMs,
            operation: 'restart',
        }, timeoutMs);

        return c.json({
            jobId: job.jobId,
            type: job.type,
            status: job.status,
            createdAt: job.createdAt,
        }, 202);
    });

    // ===== ジョブAPI（Systemスコープ） =====

    /**
     * GET /jobs - ジョブ一覧
     */
    app.get('/jobs', (c) => {
        const status = c.req.query('status') as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | undefined;
        const type = c.req.query('type');
        const limitStr = c.req.query('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 50;

        const items = jobRunner.getStore().list({ scope: 'system', status, type, limit });

        return c.json({ items });
    });

    /**
     * GET /jobs/:jobId - ジョブ詳細
     */
    app.get('/jobs/:jobId', (c) => {
        const jobId = c.req.param('jobId');
        const job = jobRunner.getStore().get(jobId);

        if (!job || job.scope !== 'system') {
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

        // Validate and clamp
        if (isNaN(tailLines) || tailLines < 0) {
            throw invalidArgumentError('tailLines must be >= 0', { field: 'tailLines' });
        }
        if (tailLines > 5000) tailLines = 5000;

        if (sinceSeconds !== undefined && (isNaN(sinceSeconds) || sinceSeconds < 0)) {
            throw invalidArgumentError('sinceSeconds must be >= 0', { field: 'sinceSeconds' });
        }

        const job = jobRunner.getStore().get(jobId);
        if (!job || job.scope !== 'system') {
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
        if (!job || job.scope !== 'system') {
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
