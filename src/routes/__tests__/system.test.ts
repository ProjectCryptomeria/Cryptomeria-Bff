
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSystemRoutes } from '../system';
import { JobRunner } from '../../jobs/job-runner';
import { K8sManager } from '../../managers/k8s-manager';
import type { EnvConfig } from '../../config/env';

// Mock dependencies
const mockEnv: EnvConfig = {
    k8sNamespace: 'test-ns',
    nodeHost: 'check',
    port: 3000,
    endpointCacheTtlMs: 1000,
    blocktimeCacheTtlMs: 1000,
    downstreamTimeoutMs: 1000,
    apiToken: 'test',
    jobLogMaxBytes: 1000,
    maxRunningUtilsJobs: 10,
    maxRunningSystemJobs: 5,
    maxConcurrency: 5,
    maxBatchSize: 100,
    blocktimeMaxWindow: 100,
    maxTxBase64Chars: 1000,
    autoDetectNodeHost: false,
    authDisabled: true
};

const mockK8sManager = {
    getNamespace: vi.fn(() => 'test-ns'),
    getSystemStatus: vi.fn(() => ({ podsTotal: 10, podsReady: 10 })),
    getRelayerStatus: vi.fn(() => ({ podName: 'rly-pod', ready: true })),
    getChainStatuses: vi.fn(() => []),
    runPreflightChecks: vi.fn(),
    getTopology: vi.fn(),
    getChainPorts: vi.fn(),
    // ...other methods if needed
} as unknown as K8sManager;

describe('System Routes', () => {
    let app: Hono;
    let jobRunner: JobRunner;

    beforeEach(() => {
        jobRunner = new JobRunner(mockEnv);
        app = new Hono();

        // Mock error handler to support the custom error object thrown by routes
        app.onError((err, c) => {
            if (typeof err === 'object' && err !== null && 'statusCode' in err && 'toResponse' in err) {
                const e = err as any;
                c.status(e.statusCode);
                return c.json(e.toResponse());
            }
            return c.json({ error: String(err) }, 500);
        });

        const routes = createSystemRoutes(mockK8sManager, jobRunner);
        app.route('/system', routes);
    });

    it('POST /system/start (dryRun) should return execution plan', async () => {
        const res = await app.request('/system/start', {
            method: 'POST',
            body: JSON.stringify({ dryRun: true }),
            headers: { 'Content-Type': 'application/json' }
        });

        expect(res.status).toBe(200);
        const data = await res.json() as { plan: unknown[] };
        expect(data).toHaveProperty('plan');
        expect(Array.isArray(data.plan)).toBe(true);
    });

    it('POST /system/relayer/restart should fail with 409 if system job running', async () => {
        // Manually inject a running job
        jobRunner.getStore().create({ scope: 'system', type: 'system.dummy', steps: ['step1'] });
        const runningJob = jobRunner.getStore().list({ scope: 'system' })[0];
        jobRunner.getStore().update(runningJob.jobId, { status: 'running' });

        const res = await app.request('/system/relayer/restart', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' }
        });

        expect(res.status).toBe(409);
        const data = await res.json() as { error: { code: string } };
        expect(data.error.code).toBe('CONFLICT');
    });

    it('POST /system/relayer/restart should create job if clean', async () => {
        // Register dummy definition for testing creation
        jobRunner.registerDefinition('system.relayer.restart', { steps: ['step1'], executors: {} });

        const res = await app.request('/system/relayer/restart', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' }
        });

        expect(res.status).toBe(202);
        const data = await res.json() as { type: string };
        expect(data.type).toBe('system.relayer.restart');
    });
});
