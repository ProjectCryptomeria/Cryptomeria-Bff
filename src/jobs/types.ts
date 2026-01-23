/**
 * ジョブ関連の型定義
 * 
 * APIJOB仕様書に準拠
 */

/**
 * ジョブスコープ
 */
export type JobScope = 'system' | 'utils';

/**
 * ジョブ状態
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/**
 * ステップ状態
 */
export type StepStatus = 'pending' | 'running' | 'skipped' | 'succeeded' | 'failed' | 'canceled';

/**
 * ジョブエラー
 */
export interface JobError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * ジョブステップ
 */
export interface JobStep {
    name: string;
    status: StepStatus;
    startedAt: string | null;
    finishedAt: string | null;
    message?: string;
    output?: unknown;
}

/**
 * ジョブ進捗
 */
export interface JobProgress {
    currentStep: number;
    totalSteps: number;
    completedSteps: number;
}

/**
 * ジョブ（完全形）
 */
export interface Job {
    jobId: string;
    scope: JobScope;
    type: string;
    status: JobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    request?: Record<string, unknown>;
    progress: JobProgress;
    steps: JobStep[];
    result: unknown | null;
    error: JobError | null;
}

/**
 * ジョブ一覧アイテム（簡略形）
 */
export interface JobListItem {
    jobId: string;
    type: string;
    status: JobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
}

/**
 * ジョブ作成リクエスト
 */
export interface CreateJobRequest {
    scope: JobScope;
    type: string;
    steps: string[];
    request?: Record<string, unknown>;
    timeoutMs?: number;
}

/**
 * ジョブ一覧クエリ
 */
export interface ListJobsQuery {
    scope?: JobScope;
    status?: JobStatus;
    type?: string;
    limit?: number;
}

/**
 * ステップ実行関数の型
 * result フィールドに任意のデータを格納可能
 * 互換性のため、戻り値全体も任意フィールドを持てる
 */
export type StepExecutor = (
    job: Job,
    stepIndex: number,
    abortSignal: AbortSignal,
    appendLog: (message: string) => void
) => Promise<{ skipped?: boolean; message?: string; result?: unknown;[key: string]: unknown }>;

/**
 * ジョブ定義（ステップ実行関数のマップ）
 */
export interface JobDefinition {
    steps: string[];
    executors: Record<string, StepExecutor>;
}
