/**
 * Blocktimeキャッシュ
 * 
 * 仕様書に準拠したwindowキャッシュ機能を提供
 * 同一latestHeightなら cached=true を返す
 */

import { nowISO } from '../lib/time.js';

/**
 * Blocktime統計結果
 */
export interface BlocktimeResult {
    range: {
        startHeight: number;
        endHeight: number;
    };
    timeStart: string;
    timeEnd: string;
    durationSeconds: number;
    stats: {
        mean: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
    };
    cached: boolean;
    computedAt: string;
}

/**
 * キャッシュエントリ
 */
interface CacheEntry {
    latestHeightUsed: number;
    result: BlocktimeResult;
    expiresAt: number;
}

/**
 * キャッシュキー生成
 */
function makeCacheKey(chainId: string, window: number): string {
    return `${chainId}:${window}`;
}

/**
 * パーセンタイル計算
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

/**
 * BlocktimeCache
 */
export class BlocktimeCache {
    private readonly cache: Map<string, CacheEntry> = new Map();
    private readonly ttlMs: number;
    private readonly maxWindow: number;

    constructor(ttlMs: number = 10000, maxWindow: number = 2000) {
        this.ttlMs = ttlMs;
        this.maxWindow = maxWindow;
    }

    /**
     * Blocktimeを計算（キャッシュ付き）
     */
    async getBlocktime(
        chainId: string,
        window: number,
        latestHeight: number,
        fetchBlocks: (startHeight: number, endHeight: number) => Promise<{ height: number; time: string }[]>
    ): Promise<BlocktimeResult> {
        // Window validation
        if (window < 2) {
            throw new Error('window must be >= 2');
        }
        if (window > this.maxWindow) {
            throw new Error(`window must be <= ${this.maxWindow}`);
        }

        const cacheKey = makeCacheKey(chainId, window);
        const cached = this.cache.get(cacheKey);

        // キャッシュが有効かつ同じlatestHeightなら cached=true で返す
        if (cached && Date.now() < cached.expiresAt && cached.latestHeightUsed === latestHeight) {
            return {
                ...cached.result,
                cached: true,
            };
        }

        // 計算
        const startHeight = Math.max(1, latestHeight - window + 1);
        const endHeight = latestHeight;

        const blocks = await fetchBlocks(startHeight, endHeight);

        if (blocks.length < 2) {
            throw new Error('Not enough blocks to calculate blocktime');
        }

        // ソート（高さ順）
        blocks.sort((a, b) => a.height - b.height);

        // ブロック時間差を計算
        const intervals: number[] = [];
        for (let i = 1; i < blocks.length; i++) {
            const prevTime = new Date(blocks[i - 1].time).getTime();
            const currTime = new Date(blocks[i].time).getTime();
            const diffMs = currTime - prevTime;
            if (diffMs > 0) {
                intervals.push(diffMs / 1000); // 秒に変換
            }
        }

        if (intervals.length === 0) {
            throw new Error('No valid block intervals found');
        }

        // 統計計算
        intervals.sort((a, b) => a - b);
        const sum = intervals.reduce((acc, v) => acc + v, 0);
        const mean = sum / intervals.length;
        const min = intervals[0];
        const max = intervals[intervals.length - 1];
        const p50 = percentile(intervals, 50);
        const p95 = percentile(intervals, 95);
        const p99 = percentile(intervals, 99);

        // 期間計算
        const timeStart = blocks[0].time;
        const timeEnd = blocks[blocks.length - 1].time;
        const durationSeconds = (new Date(timeEnd).getTime() - new Date(timeStart).getTime()) / 1000;

        const result: BlocktimeResult = {
            range: {
                startHeight: blocks[0].height,
                endHeight: blocks[blocks.length - 1].height,
            },
            timeStart,
            timeEnd,
            durationSeconds,
            stats: {
                mean: Math.round(mean * 1000) / 1000,
                min: Math.round(min * 1000) / 1000,
                max: Math.round(max * 1000) / 1000,
                p50: Math.round(p50 * 1000) / 1000,
                p95: Math.round(p95 * 1000) / 1000,
                p99: Math.round(p99 * 1000) / 1000,
            },
            cached: false,
            computedAt: nowISO(),
        };

        // キャッシュ更新
        this.cache.set(cacheKey, {
            latestHeightUsed: latestHeight,
            result,
            expiresAt: Date.now() + this.ttlMs,
        });

        return result;
    }

    /**
     * キャッシュクリア
     */
    clear(): void {
        this.cache.clear();
    }
}
