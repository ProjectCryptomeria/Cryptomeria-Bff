/**
 * ジョブランナー
 * 
 * APIJOB仕様書に準拠したジョブ実行エンジン
 */

import type { EnvConfig } from '../config/env.js';
import type { Job, JobScope, StepExecutor, JobDefinition, JobError } from './types.js';
import { InMemoryJobStore } from './job-store.js';
import { nowISO, addMs, isExpired } from '../lib/time.js';
import { conflictError, rateLimitedError } from '../lib/errors.js';

/**
 * ジョブランナー
 */
export class JobRunner {
    private readonly store: InMemoryJobStore;
    private readonly config: EnvConfig;
    private readonly definitions: Map<string, JobDefinition> = new Map();
    private readonly abortControllers: Map<string, AbortController> = new Map();

    constructor(config: EnvConfig, store?: InMemoryJobStore) {
        this.config = config;
        this.store = store ?? new InMemoryJobStore(config.jobLogMaxBytes);
    }

    /**
     * ジョブストアを取得
     */
    getStore(): InMemoryJobStore {
        return this.store;
    }

    /**
     * ジョブ定義を登録
     */
    registerDefinition(type: string, definition: JobDefinition): void {
        this.definitions.set(type, definition);
    }

    /**
     * ジョブを作成・実行開始
     */
    async createAndRun(
        scope: JobScope,
        type: string,
        request?: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<Job> {
        // 排他チェック（System層）
        if (scope === 'system') {
            if (this.store.hasRunning('system', 'system.')) {
                throw conflictError('A system job is already running', {
                    hint: 'Wait for the current job to finish or cancel it',
                });
            }
        }

        // 上限チェック（Utils層）
        if (scope === 'utils') {
            const running = this.store.countRunning('utils');
            if (running >= this.config.maxRunningUtilsJobs) {
                throw rateLimitedError('Too many running utils jobs', {
                    maxRunningJobs: this.config.maxRunningUtilsJobs,
                    currentRunning: running,
                });
            }
        }

        // ジョブ定義を取得
        const definition = this.definitions.get(type);
        if (!definition) {
            throw new Error(`Job definition not found: ${type}`);
        }

        // ジョブ作成
        const job = this.store.create({
            scope,
            type,
            steps: definition.steps,
            request,
            timeoutMs,
        });

        // 非同期で実行開始
        this.runJob(job.jobId, definition, timeoutMs).catch((err) => {
            console.error(`[JobRunner] Job ${job.jobId} failed:`, err);
        });

        return job;
    }

    /**
     * ジョブを実行
     */
    private async runJob(jobId: string, definition: JobDefinition, timeoutMs?: number): Promise<void> {
        const job = this.store.get(jobId);
        if (!job) return;

        // AbortController作成
        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        // タイムアウト設定
        const deadline = timeoutMs ? addMs(new Date(), timeoutMs) : null;

        // ステータスをrunningに
        this.store.update(jobId, {
            status: 'running',
            startedAt: nowISO(),
        });
        this.store.appendLog(jobId, `Job started: type=${job.type}`);

        let lastError: JobError | null = null;
        let finalStatus: 'succeeded' | 'failed' | 'canceled' = 'succeeded';

        try {
            for (let i = 0; i < job.steps.length; i++) {
                const step = job.steps[i];

                // キャンセルチェック
                if (abortController.signal.aborted) {
                    this.store.updateStep(jobId, i, {
                        status: 'canceled',
                        finishedAt: nowISO(),
                        message: 'Canceled',
                    });
                    finalStatus = 'canceled';
                    break;
                }

                // タイムアウトチェック
                if (deadline && isExpired(deadline)) {
                    this.store.updateStep(jobId, i, {
                        status: 'failed',
                        finishedAt: nowISO(),
                        message: 'Timeout',
                    });
                    lastError = { code: 'TIMEOUT', message: 'Job timed out' };
                    finalStatus = 'failed';
                    break;
                }

                // ステップ開始
                this.store.updateStep(jobId, i, {
                    status: 'running',
                    startedAt: nowISO(),
                });
                this.store.appendLog(jobId, `Step ${step.name} started`);

                // ステップ実行
                const executor = definition.executors[step.name];
                if (!executor) {
                    this.store.updateStep(jobId, i, {
                        status: 'failed',
                        finishedAt: nowISO(),
                        message: `Executor not found: ${step.name}`,
                    });
                    lastError = { code: 'INTERNAL', message: `Executor not found: ${step.name}` };
                    finalStatus = 'failed';
                    break;
                }

                try {
                    const result = await executor(
                        job,
                        i,
                        abortController.signal,
                        (msg) => this.store.appendLog(jobId, `[${step.name}] ${msg}`)
                    );

                    if (result.skipped) {
                        this.store.updateStep(jobId, i, {
                            status: 'skipped',
                            finishedAt: nowISO(),
                            message: result.message ?? 'Skipped',
                        });
                        this.store.appendLog(jobId, `Step ${step.name} skipped: ${result.message ?? ''}`);
                    } else {
                        this.store.updateStep(jobId, i, {
                            status: 'succeeded',
                            finishedAt: nowISO(),
                            message: result.message ?? 'Completed',
                        });
                        this.store.appendLog(jobId, `Step ${step.name} succeeded`);
                    }

                    // 結果を蓄積（最終ステップの結果を使用）
                    if (result.result !== undefined) {
                        this.store.update(jobId, { result: result.result });
                    }
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    this.store.updateStep(jobId, i, {
                        status: 'failed',
                        finishedAt: nowISO(),
                        message: errorMessage,
                    });
                    this.store.appendLog(jobId, `Step ${step.name} failed: ${errorMessage}`);

                    lastError = {
                        code: 'INTERNAL',
                        message: errorMessage,
                        details: err instanceof Error ? { stack: err.stack?.substring(0, 500) } : undefined,
                    };
                    finalStatus = 'failed';
                    break;
                }
            }
        } finally {
            // 終了処理
            this.abortControllers.delete(jobId);

            this.store.update(jobId, {
                status: finalStatus,
                finishedAt: nowISO(),
                error: lastError,
            });
            this.store.appendLog(jobId, `Job finished: status=${finalStatus}`);
        }
    }

    /**
     * ジョブをキャンセル
     */
    cancel(jobId: string): Job | undefined {
        const job = this.store.get(jobId);
        if (!job) return undefined;

        if (job.status !== 'queued' && job.status !== 'running') {
            throw conflictError(`Job is already ${job.status}`, { jobId, status: job.status });
        }

        // AbortControllerでシグナル送信
        const controller = this.abortControllers.get(jobId);
        if (controller) {
            controller.abort();
        }

        // queuedの場合は即座にcanceled
        if (job.status === 'queued') {
            this.store.update(jobId, {
                status: 'canceled',
                finishedAt: nowISO(),
            });
            this.store.appendLog(jobId, 'Job canceled (was queued)');
        }

        return this.store.get(jobId);
    }
}
