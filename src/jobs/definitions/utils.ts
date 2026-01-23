/**
 * Utilities ジョブ定義
 * P0-2: 6つのUtilitiesジョブ実装
 * 修正: aggregateステップの型定義不足を解消 (txhash追加)
 */

import type { CryptomeriaManager } from '../../managers/cryptomeria-manager.js';
import type { K8sManager } from '../../managers/k8s-manager.js';
import type { JobDefinition } from '../types.js';
import { runPool, runPoolWithStopOnError, sleepWithSignal } from '../../lib/concurrency.js';
import { nowISO } from '../../lib/time.js';

// ===== Private Payload Storage =====
// job.request に機密情報を入れないため、別Mapに保持

const privatePayloads = new Map<string, unknown>();

export function setPrivatePayload(jobId: string, payload: unknown): void {
    privatePayloads.set(jobId, payload);
}

export function getPrivatePayload<T>(jobId: string): T | undefined {
    return privatePayloads.get(jobId) as T | undefined;
}

export function clearPrivatePayload(jobId: string): void {
    privatePayloads.delete(jobId);
}

// ===== Type Definitions =====

interface ThroughputPayload {
    chainId: string;
    window: number;
    concurrency?: number;
}

interface ResourceSnapshotPayload {
    namespace: string;
    include: string[];
}

interface TxConfirmationPayload {
    chainId: string;
    txhash: string;
    pollIntervalMs: number;
    timeoutMs: number;
}

interface TxConfirmationBatchPayload {
    chainId: string;
    txhashes: string[];
    pollIntervalMs: number;
    timeoutMs: number;
    maxConcurrency: number;
}

interface BroadcastBatchPayload {
    chainId: string;
    txBytesBase64List: string[];
    broadcastMode: string;
    maxConcurrency: number;
    stopOnFirstError: boolean;
}

interface BroadcastAndConfirmPayload extends BroadcastBatchPayload {
    pollIntervalMs: number;
}

// ===== Executor Helpers =====

async function pollForTxConfirmation(
    cryptomeriaManager: CryptomeriaManager,
    chainId: string,
    txhash: string,
    pollIntervalMs: number,
    signal: AbortSignal,
    startTime: number
): Promise<{ confirmed: boolean; height?: number; code?: number; latencyMs: number }> {
    while (!signal.aborted) {
        try {
            const tx = await cryptomeriaManager.getTx(chainId, txhash);
            const latencyMs = Date.now() - startTime;
            return {
                confirmed: true,
                height: parseInt(String(tx.height), 10),
                code: tx.code,
                latencyMs,
            };
        } catch (error) {
            // 404 or other error - tx not yet available
            if (signal.aborted) break;
            await sleepWithSignal(pollIntervalMs, signal).catch(() => { });
        }
    }

    return { confirmed: false, latencyMs: Date.now() - startTime };
}

// ===== Executor Factory =====

export function createUtilsJobDefinitions(
    cryptomeriaManager: CryptomeriaManager,
    k8sManager: K8sManager
): Record<string, JobDefinition> {
    return {
        // ===== utils.metrics.throughput =====
        'utils.metrics.throughput': {
            steps: ['validate', 'resolveHeights', 'fetchBlocks', 'compute', 'finish'],
            executors: {
                validate: async (job, _stepIndex, _signal, log) => {
                    log('Validating throughput request...');
                    const payload = getPrivatePayload<ThroughputPayload>(job.jobId);
                    if (!payload) throw new Error('Missing payload');
                    log(`chainId=${payload.chainId}, window=${payload.window}`);
                    return { validated: true };
                },

                resolveHeights: async (job, _stepIndex, _signal, log) => {
                    const payload = getPrivatePayload<ThroughputPayload>(job.jobId)!;
                    log(`Getting latest height for ${payload.chainId}...`);

                    const status = await cryptomeriaManager.getStatus(payload.chainId);
                    const latestHeight = parseInt(status.syncInfo.latestBlockHeight, 10);
                    const startHeight = Math.max(1, latestHeight - payload.window + 1);

                    log(`Range: ${startHeight} - ${latestHeight}`);
                    return { startHeight, endHeight: latestHeight };
                },

                fetchBlocks: async (job, stepIndex, signal, log) => {
                    const payload = getPrivatePayload<ThroughputPayload>(job.jobId)!;
                    const prev = job.steps[stepIndex - 1];
                    const { startHeight, endHeight } = prev.output as unknown as { startHeight: number; endHeight: number };

                    log(`Fetching blocks ${startHeight} to ${endHeight}...`);

                    const heights = Array.from({ length: endHeight - startHeight + 1 }, (_, i) => startHeight + i);
                    const concurrency = payload.concurrency ?? 5;

                    const results = await runPool(
                        heights,
                        concurrency,
                        async (h) => {
                            const block = await cryptomeriaManager.getBlock(payload.chainId, String(h));
                            return { height: h, time: block.time, numTxs: block.numTxs };
                        },
                        signal
                    );

                    const blocks = results.filter((r) => r.ok).map((r) => r.value!);
                    log(`Fetched ${blocks.length} blocks`);
                    return { blocks };
                },

                compute: async (job, stepIndex, _signal, log) => {
                    const prev = job.steps[stepIndex - 1];
                    const { blocks } = prev.output as unknown as { blocks: { height: number; time: string; numTxs: number }[] };

                    if (blocks.length < 2) {
                        throw new Error('Not enough blocks to compute throughput');
                    }

                    blocks.sort((a, b) => a.height - b.height);
                    const first = blocks[0];
                    const last = blocks[blocks.length - 1];

                    const timeStart = first.time;
                    const timeEnd = last.time;
                    const durationSeconds = (new Date(timeEnd).getTime() - new Date(timeStart).getTime()) / 1000;
                    const totalTx = blocks.reduce((sum, b) => sum + b.numTxs, 0);

                    const tps = durationSeconds > 0 ? totalTx / durationSeconds : 0;

                    log(`TPS: ${tps.toFixed(2)}, totalTx: ${totalTx}, duration: ${durationSeconds}s`);

                    return {
                        range: { startHeight: first.height, endHeight: last.height },
                        timeStart,
                        timeEnd,
                        durationSeconds,
                        totalTx,
                        tps: Math.round(tps * 100) / 100,
                        computedAt: nowISO(),
                    };
                },

                finish: async (job, _stepIndex, _signal, log) => {
                    clearPrivatePayload(job.jobId);
                    log('Throughput calculation complete');
                    const prev = job.steps[job.steps.length - 2]?.output ?? {};
                    return { result: prev };
                },
            },
        },

        // ===== utils.metrics.resource-snapshot =====
        'utils.metrics.resource-snapshot': {
            steps: ['validate', 'collectSystem', 'collectChains', 'finish'],
            executors: {
                validate: async (job, _stepIndex, _signal, log) => {
                    log('Validating resource-snapshot request...');
                    const payload = getPrivatePayload<ResourceSnapshotPayload>(job.jobId);
                    if (!payload) throw new Error('Missing payload');
                    log(`namespace=${payload.namespace}, include=[${payload.include.join(',')}]`);
                    return { validated: true };
                },

                collectSystem: async (job, _stepIndex, _signal, log) => {
                    const payload = getPrivatePayload<ResourceSnapshotPayload>(job.jobId)!;
                    const result: Record<string, unknown> = { observedAt: nowISO(), namespace: payload.namespace };

                    if (payload.include.includes('systemStatus')) {
                        log('Collecting systemStatus...');
                        result.systemStatus = await k8sManager.getSystemStatus();
                    }
                    if (payload.include.includes('pods')) {
                        log('Collecting pods...');
                        result.pods = { items: await k8sManager.listPods({}) };
                    }
                    if (payload.include.includes('services')) {
                        log('Collecting services...');
                        result.services = { items: await k8sManager.listServices({}) };
                    }

                    return result;
                },

                collectChains: async (job, stepIndex, _signal, log) => {
                    const payload = getPrivatePayload<ResourceSnapshotPayload>(job.jobId)!;
                    const prev = job.steps[stepIndex - 1];
                    const result = { ...(prev.output as unknown as Record<string, unknown>) };

                    if (payload.include.includes('chainsStatus')) {
                        log('Collecting chainsStatus...');
                        const chainStatuses = await k8sManager.getChainStatuses();
                        const chainsWithHeight = [];

                        for (const chain of chainStatuses) {
                            try {
                                const status = await cryptomeriaManager.getStatus(chain.chainId);
                                chainsWithHeight.push({
                                    chainId: chain.chainId,
                                    latestHeight: parseInt(status.syncInfo.latestBlockHeight, 10),
                                    catchingUp: status.syncInfo.catchingUp,
                                });
                            } catch {
                                chainsWithHeight.push({
                                    chainId: chain.chainId,
                                    error: 'Failed to get status',
                                });
                            }
                        }

                        result.chainsStatus = chainsWithHeight;
                    }

                    return result;
                },

                finish: async (job, _stepIndex, _signal, log) => {
                    clearPrivatePayload(job.jobId);
                    log('Resource snapshot complete');
                    const prev = job.steps[job.steps.length - 2]?.output ?? {};
                    return { result: prev };
                },
            },
        },

        // ===== utils.observe.tx-confirmation =====
        'utils.observe.tx-confirmation': {
            steps: ['validate', 'pollTx', 'finish'],
            executors: {
                validate: async (job, _stepIndex, _signal, log) => {
                    log('Validating tx-confirmation request...');
                    const payload = getPrivatePayload<TxConfirmationPayload>(job.jobId);
                    if (!payload) throw new Error('Missing payload');
                    log(`chainId=${payload.chainId}, txhash=${payload.txhash.substring(0, 16)}...`);
                    return { validated: true, firstSeenAt: nowISO() };
                },

                pollTx: async (job, _stepIndex, signal, log) => {
                    const payload = getPrivatePayload<TxConfirmationPayload>(job.jobId)!;
                    log(`Polling for tx ${payload.txhash.substring(0, 16)}...`);

                    const startTime = Date.now();
                    const result = await pollForTxConfirmation(
                        cryptomeriaManager,
                        payload.chainId,
                        payload.txhash,
                        payload.pollIntervalMs,
                        signal,
                        startTime
                    );

                    if (result.confirmed) {
                        log(`Tx confirmed at height ${result.height}`);
                    } else {
                        log('Tx not confirmed (timeout/cancel)');
                    }

                    return {
                        chainId: payload.chainId,
                        txhash: payload.txhash,
                        confirmed: result.confirmed,
                        height: result.height,
                        code: result.code,
                        latencyMs: result.latencyMs,
                        confirmedAt: result.confirmed ? nowISO() : null,
                    };
                },

                finish: async (job, _stepIndex, _signal, log) => {
                    clearPrivatePayload(job.jobId);
                    log('Tx confirmation complete');
                    const prev = job.steps[job.steps.length - 2]?.output ?? {};
                    return { result: prev };
                },
            },
        },

        // ===== utils.observe.tx-confirmation-batch =====
        'utils.observe.tx-confirmation-batch': {
            steps: ['validate', 'pollBatch', 'aggregate', 'finish'],
            executors: {
                validate: async (job, _stepIndex, _signal, log) => {
                    log('Validating tx-confirmation-batch request...');
                    const payload = getPrivatePayload<TxConfirmationBatchPayload>(job.jobId);
                    if (!payload) throw new Error('Missing payload');
                    log(`chainId=${payload.chainId}, txCount=${payload.txhashes.length}`);
                    return { validated: true };
                },

                pollBatch: async (job, _stepIndex, signal, log) => {
                    const payload = getPrivatePayload<TxConfirmationBatchPayload>(job.jobId)!;
                    log(`Polling ${payload.txhashes.length} txs...`);

                    const startTime = Date.now();
                    const results = await runPool(
                        payload.txhashes,
                        payload.maxConcurrency,
                        async (txhash, _index, sig) => {
                            return pollForTxConfirmation(
                                cryptomeriaManager,
                                payload.chainId,
                                txhash,
                                payload.pollIntervalMs,
                                sig,
                                Date.now()
                            ).then((r) => ({ txhash, ...r }));
                        },
                        signal
                    );

                    const items = results.map((r) => ({
                        txhash: r.ok ? r.value!.txhash : '',
                        confirmed: r.ok ? r.value!.confirmed : false,
                        height: r.ok ? r.value!.height : undefined,
                        latencyMs: r.ok ? r.value!.latencyMs : 0,
                        error: r.ok ? undefined : r.error,
                    }));

                    log(`Batch polling complete in ${Date.now() - startTime}ms`);
                    return { items, durationMs: Date.now() - startTime };
                },

                aggregate: async (job, stepIndex, _signal, log) => {
                    const prev = job.steps[stepIndex - 1];
                    const { items, durationMs } = prev.output as unknown as {
                        items: { confirmed: boolean; error?: string }[];
                        durationMs: number;
                    };

                    const total = items.length;
                    const succeeded = items.filter((i) => i.confirmed).length;
                    const failed = items.filter((i) => !i.confirmed && !i.error).length;
                    const errors = items.filter((i) => i.error).length;

                    log(`Summary: total=${total}, succeeded=${succeeded}, failed=${failed}, errors=${errors}`);

                    return {
                        summary: { total, succeeded, failed, timeout: failed, durationMs },
                        items,
                    };
                },

                finish: async (job, _stepIndex, _signal, log) => {
                    clearPrivatePayload(job.jobId);
                    log('Batch confirmation complete');
                    const prev = job.steps[job.steps.length - 2]?.output ?? {};
                    return { result: prev };
                },
            },
        },

        // ===== utils.load.broadcast-batch =====
        'utils.load.broadcast-batch': {
            steps: ['validate', 'broadcastBatch', 'aggregate', 'finish'],
            executors: {
                validate: async (job, _stepIndex, _signal, log) => {
                    log('Validating broadcast-batch request...');
                    const payload = getPrivatePayload<BroadcastBatchPayload>(job.jobId);
                    if (!payload) throw new Error('Missing payload');
                    log(`chainId=${payload.chainId}, txCount=${payload.txBytesBase64List.length}, mode=${payload.broadcastMode}`);
                    return { validated: true };
                },

                broadcastBatch: async (job, _stepIndex, signal, log) => {
                    const payload = getPrivatePayload<BroadcastBatchPayload>(job.jobId)!;
                    log(`Broadcasting ${payload.txBytesBase64List.length} txs...`);

                    const startTime = Date.now();
                    const poolFn = payload.stopOnFirstError ? runPoolWithStopOnError : runPool;

                    const results = await poolFn(
                        payload.txBytesBase64List,
                        payload.maxConcurrency,
                        async (txBytes, index, _sig) => {
                            const result = await cryptomeriaManager.broadcastTx(
                                payload.chainId,
                                txBytes,
                                payload.broadcastMode as 'sync' | 'async' | 'commit'
                            );
                            return {
                                index,
                                txhash: result.txhash,
                                code: result.code,
                                rawLog: result.rawLog
                            };
                        },
                        signal
                    );

                    const items = results.map((r) => {
                        if (r.ok) {
                            const val = r.value!;
                            return {
                                index: val.index,
                                txhash: val.txhash,
                                connect: true,
                                status: val.code === 0 ? 'success' : 'failed',
                                code: val.code,
                                log: val.rawLog,
                                error: undefined
                            };
                        } else {
                            return {
                                index: r.index,
                                txhash: '',
                                connect: false,
                                status: 'failed',
                                code: undefined,
                                log: undefined,
                                error: r.error
                            };
                        }
                    });

                    log(`Broadcast complete in ${Date.now() - startTime}ms`);
                    return { items, durationMs: Date.now() - startTime };
                },

                aggregate: async (job, stepIndex, _signal, log) => {
                    const prev = job.steps[stepIndex - 1];
                    // 型アサーションの修正
                    const { items, durationMs } = prev.output as unknown as {
                        items: {
                            index: number;
                            txhash: string; // <-- 追加
                            connect: boolean;
                            status: string;
                            code?: number;
                            log?: string;
                            error?: string
                        }[];
                        durationMs: number;
                    };

                    const total = items.length;
                    const succeeded = items.filter((i) => i.status === 'success').length;
                    const failed = total - succeeded;

                    const connectionErrors = items.filter(i => !i.connect).length;
                    const applicationErrors = items.filter(i => i.connect && i.status === 'failed').length;

                    log(`Summary: total=${total}, succeeded=${succeeded}, failed=${failed} (conn=${connectionErrors}, app=${applicationErrors})`);

                    return {
                        summary: {
                            total,
                            succeeded,
                            failed,
                            details: { connectionErrors, applicationErrors },
                            durationMs
                        },
                        items,
                    };
                },

                finish: async (job, _stepIndex, _signal, log) => {
                    clearPrivatePayload(job.jobId);
                    log('Broadcast batch complete');
                    const prev = job.steps[job.steps.length - 2]?.output ?? {};
                    return { result: prev };
                },
            },
        },

        // ===== utils.load.broadcast-and-confirm =====
        'utils.load.broadcast-and-confirm': {
            steps: ['validate', 'broadcastBatch', 'confirmBatch', 'aggregate', 'finish'],
            executors: {
                validate: async (job, _stepIndex, _signal, log) => {
                    log('Validating broadcast-and-confirm request...');
                    const payload = getPrivatePayload<BroadcastAndConfirmPayload>(job.jobId);
                    if (!payload) throw new Error('Missing payload');
                    log(`chainId=${payload.chainId}, txCount=${payload.txBytesBase64List.length}`);
                    return { validated: true };
                },

                broadcastBatch: async (job, _stepIndex, signal, log) => {
                    const payload = getPrivatePayload<BroadcastAndConfirmPayload>(job.jobId)!;
                    log(`Broadcasting ${payload.txBytesBase64List.length} txs...`);

                    const results = await runPool(
                        payload.txBytesBase64List,
                        payload.maxConcurrency,
                        async (txBytes, index, _sig) => {
                            const result = await cryptomeriaManager.broadcastTx(
                                payload.chainId,
                                txBytes,
                                payload.broadcastMode as 'sync' | 'async' | 'commit'
                            );
                            return {
                                index,
                                txhash: result.txhash,
                                code: result.code,
                                rawLog: result.rawLog,
                                broadcastTime: Date.now()
                            };
                        },
                        signal
                    );

                    const broadcastItems = results.map((r) => {
                        if (r.ok) {
                            const val = r.value!;
                            return {
                                index: val.index,
                                txhash: val.txhash,
                                connect: true,
                                status: val.code === 0 ? 'success' : 'failed',
                                code: val.code,
                                log: val.rawLog,
                                broadcastTime: val.broadcastTime,
                                error: undefined
                            };
                        } else {
                            return {
                                index: r.index,
                                txhash: '',
                                connect: false,
                                status: 'failed',
                                code: undefined,
                                log: undefined,
                                broadcastTime: 0,
                                error: r.error
                            };
                        }
                    });

                    const successCount = broadcastItems.filter((i) => i.status === 'success').length;
                    log(`Broadcast phase complete, ${successCount} succeeded`);
                    return { broadcastItems };
                },

                confirmBatch: async (job, stepIndex, signal, log) => {
                    const payload = getPrivatePayload<BroadcastAndConfirmPayload>(job.jobId)!;
                    const prev = job.steps[stepIndex - 1];
                    // 型アサーションの修正
                    const { broadcastItems } = prev.output as unknown as {
                        broadcastItems: {
                            index: number;
                            txhash: string; // <-- 追加
                            connect: boolean;
                            status: string;
                            broadcastTime: number
                        }[];
                    };

                    const successfulBroadcasts = broadcastItems.filter((i) => i.connect && i.status === 'success' && i.txhash);
                    log(`Confirming ${successfulBroadcasts.length} txs...`);

                    const confirmResults = await runPool(
                        successfulBroadcasts,
                        payload.maxConcurrency,
                        async (item, _idx, sig) => {
                            const result = await pollForTxConfirmation(
                                cryptomeriaManager,
                                payload.chainId,
                                item.txhash,
                                payload.pollIntervalMs,
                                sig,
                                item.broadcastTime
                            );
                            return { ...item, ...result };
                        },
                        signal
                    );

                    const items = confirmResults.map((r) => ({
                        index: r.ok ? r.value!.index : -1,
                        txhash: r.ok ? r.value!.txhash : '',
                        confirmed: r.ok ? r.value!.confirmed : false,
                        latencyMs: r.ok ? r.value!.latencyMs : 0,
                        error: r.ok ? undefined : r.error,
                    }));

                    log(`Confirmation phase complete`);
                    return { items };
                },

                aggregate: async (job, stepIndex, _signal, log) => {
                    const prev = job.steps[stepIndex - 1]; // confirmBatch output
                    const { items: confirmItems } = prev.output as unknown as {
                        items: { index: number; confirmed: boolean }[];
                    };

                    const bcStep = job.steps[stepIndex - 2]; // broadcastBatch output
                    // 型アサーションの修正: エラー原因だった箇所
                    const { broadcastItems } = bcStep.output as unknown as {
                        broadcastItems: {
                            index: number;
                            txhash: string; // <-- 必須: ここが漏れていたためエラーになっていました
                            connect: boolean;
                            status: string;
                            code?: number;
                            log?: string;
                            error?: string
                        }[]
                    };

                    const total = broadcastItems.length;

                    const finalItems = broadcastItems.map(bcItem => {
                        const cfItem = confirmItems.find(c => c.index === bcItem.index);

                        return {
                            index: bcItem.index,
                            txhash: bcItem.txhash,
                            // Broadcast結果
                            connect: bcItem.connect,
                            broadcastStatus: bcItem.status,
                            broadcastCode: bcItem.code,
                            broadcastLog: bcItem.log,
                            broadcastError: bcItem.error,
                            // Confirm結果
                            confirmed: cfItem ? cfItem.confirmed : false,
                        };
                    });

                    const finalSucceeded = finalItems.filter(i => i.broadcastStatus === 'success' && i.confirmed).length;
                    const failed = total - finalSucceeded;

                    log(`Summary: total=${total}, finalSucceeded=${finalSucceeded}, failed=${failed}`);

                    return {
                        summary: { total, succeeded: finalSucceeded, failed, durationMs: 0 },
                        items: finalItems,
                    };
                },

                finish: async (job, _stepIndex, _signal, log) => {
                    clearPrivatePayload(job.jobId);
                    log('Broadcast-and-confirm complete');
                    const prev = job.steps[job.steps.length - 2]?.output ?? {};
                    return { result: prev };
                },
            },
        },
    };
}