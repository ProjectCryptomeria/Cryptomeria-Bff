/**
 * インメモリジョブストア
 * 
 * APIJOB仕様書に準拠したジョブの永続化（揮発性）
 */

import type {
    Job,
    JobScope,
    JobStatus,
    JobStep,
    JobListItem,
    ListJobsQuery,
    CreateJobRequest,
} from './types.js';
import { nowISO } from '../lib/time.js';

/**
 * ULID風のジョブID生成
 */
function generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `job_${timestamp}_${random}`;
}

/**
 * ジョブログエントリ
 */
interface JobLog {
    jobId: string;
    logs: string[];
    totalBytes: number;
}

/**
 * InMemoryJobStore
 */
export class InMemoryJobStore {
    private jobs: Map<string, Job> = new Map();
    private logs: Map<string, JobLog> = new Map();
    private readonly maxLogBytes: number;

    constructor(maxLogBytes: number = 5 * 1024 * 1024) {
        this.maxLogBytes = maxLogBytes;
    }

    /**
     * ジョブを作成
     */
    create(request: CreateJobRequest): Job {
        const jobId = generateJobId();
        const now = nowISO();

        const steps: JobStep[] = request.steps.map((name) => ({
            name,
            status: 'pending',
            startedAt: null,
            finishedAt: null,
        }));

        const job: Job = {
            jobId,
            scope: request.scope,
            type: request.type,
            status: 'queued',
            createdAt: now,
            startedAt: null,
            finishedAt: null,
            request: request.request,
            progress: {
                currentStep: 0,
                totalSteps: steps.length,
                completedSteps: 0,
            },
            steps,
            result: null,
            error: null,
        };

        this.jobs.set(jobId, job);
        this.logs.set(jobId, { jobId, logs: [], totalBytes: 0 });

        return job;
    }

    /**
     * ジョブを取得
     */
    get(jobId: string): Job | undefined {
        return this.jobs.get(jobId);
    }

    /**
     * ジョブ一覧を取得
     */
    list(query: ListJobsQuery = {}): JobListItem[] {
        const { scope, status, type, limit = 50 } = query;

        const items: JobListItem[] = [];

        for (const job of this.jobs.values()) {
            if (scope && job.scope !== scope) continue;
            if (status && job.status !== status) continue;
            if (type && job.type !== type) continue;

            items.push({
                jobId: job.jobId,
                type: job.type,
                status: job.status,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                finishedAt: job.finishedAt,
            });
        }

        // 新しい順にソート
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return items.slice(0, Math.min(limit, 200));
    }

    /**
     * ジョブを更新
     */
    update(jobId: string, updates: Partial<Job>): Job | undefined {
        const job = this.jobs.get(jobId);
        if (!job) return undefined;

        Object.assign(job, updates);
        return job;
    }

    /**
     * ジョブステップを更新
     */
    updateStep(jobId: string, stepIndex: number, updates: Partial<JobStep>): Job | undefined {
        const job = this.jobs.get(jobId);
        if (!job || stepIndex < 0 || stepIndex >= job.steps.length) return undefined;

        Object.assign(job.steps[stepIndex], updates);

        // 進捗を再計算
        const completedSteps = job.steps.filter(
            (s) => s.status === 'succeeded' || s.status === 'skipped' || s.status === 'failed' || s.status === 'canceled'
        ).length;
        job.progress.completedSteps = completedSteps;
        job.progress.currentStep = stepIndex;

        return job;
    }

    /**
     * ログを追加
     */
    appendLog(jobId: string, message: string): void {
        const log = this.logs.get(jobId);
        if (!log) return;

        const timestamp = new Date().toISOString().substring(11, 23); // HH:mm:ss.sss
        const line = `[${timestamp}] ${message}`;
        const lineBytes = Buffer.byteLength(line, 'utf-8');

        // 上限チェック（古いログを削除）
        while (log.totalBytes + lineBytes > this.maxLogBytes && log.logs.length > 0) {
            const removed = log.logs.shift()!;
            log.totalBytes -= Buffer.byteLength(removed, 'utf-8');
        }

        log.logs.push(line);
        log.totalBytes += lineBytes;
    }

    /**
     * ログを取得
     */
    getLogs(jobId: string, tailLines: number = 200): string {
        const log = this.logs.get(jobId);
        if (!log) return '';

        const lines = tailLines > 0 ? log.logs.slice(-tailLines) : log.logs;
        return lines.join('\n');
    }

    /**
     * 実行中のジョブ数を取得
     */
    countRunning(scope: JobScope): number {
        let count = 0;
        for (const job of this.jobs.values()) {
            if (job.scope === scope && job.status === 'running') {
                count++;
            }
        }
        return count;
    }

    /**
     * 指定スコープ+状態のジョブが存在するか
     */
    hasRunning(scope: JobScope, typePrefix?: string): boolean {
        for (const job of this.jobs.values()) {
            if (job.scope === scope && job.status === 'running') {
                if (!typePrefix || job.type.startsWith(typePrefix)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * ジョブを削除（テスト用）
     */
    delete(jobId: string): boolean {
        this.logs.delete(jobId);
        return this.jobs.delete(jobId);
    }

    /**
     * 全ジョブをクリア（テスト用）
     */
    clear(): void {
        this.jobs.clear();
        this.logs.clear();
    }
}
