/**
 * 並列実行ユーティリティ
 * P0-2: Utilities ジョブの並列処理用
 */

/**
 * ワーカー結果型
 */
export interface WorkerResult<T> {
    index: number;
    ok: boolean;
    value?: T;
    error?: string;
}

/**
 * Promise pool で並列実行
 * @param items - 処理対象のアイテム
 * @param concurrency - 同時実行数
 * @param worker - ワーカー関数
 * @param signal - AbortSignal (optional)
 * @returns 全アイテムの結果
 */
export async function runPool<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
    signal?: AbortSignal
): Promise<WorkerResult<R>[]> {
    const results: WorkerResult<R>[] = [];
    const internalController = new AbortController();
    const effectiveSignal = signal ?? internalController.signal;

    let currentIndex = 0;
    const total = items.length;

    const runWorker = async (): Promise<void> => {
        while (currentIndex < total) {
            if (effectiveSignal.aborted) {
                break;
            }

            const index = currentIndex++;
            const item = items[index];

            try {
                const value = await worker(item, index, effectiveSignal);
                results.push({ index, ok: true, value });
            } catch (error) {
                results.push({
                    index,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    };

    // 並列ワーカーを起動
    const workers = Array(Math.min(concurrency, total))
        .fill(null)
        .map(() => runWorker());

    await Promise.all(workers);

    // sort by index to maintain original order
    results.sort((a, b) => a.index - b.index);

    return results;
}

/**
 * stopOnFirstError付きpool実行
 */
export async function runPoolWithStopOnError<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
    signal?: AbortSignal
): Promise<WorkerResult<R>[]> {
    const results: WorkerResult<R>[] = [];
    const abortController = new AbortController();
    const effectiveSignal = signal ?? abortController.signal;

    let currentIndex = 0;
    let hasError = false;
    const total = items.length;

    const runWorker = async (): Promise<void> => {
        while (currentIndex < total && !hasError) {
            if (effectiveSignal.aborted) {
                break;
            }

            const index = currentIndex++;
            const item = items[index];

            try {
                const value = await worker(item, index, effectiveSignal);
                results.push({ index, ok: true, value });
            } catch (error) {
                hasError = true;
                abortController.abort();
                results.push({
                    index,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    };

    const workers = Array(Math.min(concurrency, total))
        .fill(null)
        .map(() => runWorker());

    await Promise.all(workers);

    results.sort((a, b) => a.index - b.index);

    return results;
}

/**
 * sleep ユーティリティ
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AbortSignal対応の待機
 */
export async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('Aborted'));
            return;
        }

        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
        };

        signal.addEventListener('abort', onAbort);
    });
}
