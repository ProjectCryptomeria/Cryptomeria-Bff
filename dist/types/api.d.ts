/**
 * API リクエスト/レスポンス型定義
 */
import { z } from 'zod';
/**
 * アカウント情報
 */
export interface AccountInfo {
    address: string;
    accountNumber: string;
    sequence: string;
}
/**
 * Simulate リクエスト
 */
export declare const SimulateRequestSchema: z.ZodObject<{
    txBytesBase64: z.ZodString;
}, "strip", z.ZodTypeAny, {
    txBytesBase64: string;
}, {
    txBytesBase64: string;
}>;
export type SimulateRequest = z.infer<typeof SimulateRequestSchema>;
/**
 * Simulate レスポンス
 */
export interface SimulateResponse {
    gasUsed: string;
    gasWanted: string;
    raw: unknown;
}
/**
 * Broadcast リクエスト
 */
export declare const BroadcastRequestSchema: z.ZodObject<{
    txBytesBase64: z.ZodString;
    mode: z.ZodDefault<z.ZodOptional<z.ZodEnum<["sync", "async", "commit"]>>>;
}, "strip", z.ZodTypeAny, {
    txBytesBase64: string;
    mode: "sync" | "async" | "commit";
}, {
    txBytesBase64: string;
    mode?: "sync" | "async" | "commit" | undefined;
}>;
export type BroadcastRequest = z.infer<typeof BroadcastRequestSchema>;
/**
 * Broadcast モード
 */
export type BroadcastMode = 'sync' | 'async' | 'commit';
/**
 * Broadcast レスポンス
 */
export interface BroadcastResponse {
    txhash: string;
    broadcastResult: unknown;
    observedAt: string;
}
/**
 * Tx情報
 */
export interface TxInfo {
    txhash: string;
    height: string;
    code: number;
    rawLog?: string;
    timestamp?: string;
}
/**
 * Mempool情報
 */
export interface MempoolInfo {
    numUnconfirmedTxs: number;
    totalBytes: number;
}
/**
 * ノードステータス
 */
export interface NodeStatus {
    nodeInfo: {
        network: string;
        moniker: string;
        version: string;
    };
    syncInfo: {
        latestBlockHeight: string;
        latestBlockTime: string;
        catchingUp: boolean;
    };
}
/**
 * ブロック情報
 */
export interface BlockInfo {
    height: string;
    time: string;
    hash: string;
    numTxs: number;
    txHashes?: string[];
}
/**
 * chainIdパスパラメータ検証
 */
export declare const ChainIdParamSchema: z.ZodObject<{
    chainId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    chainId: string;
}, {
    chainId: string;
}>;
/**
 * addressパスパラメータ検証
 */
export declare const AddressParamSchema: z.ZodObject<{
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
}, {
    address: string;
}>;
/**
 * txhashパスパラメータ検証
 */
export declare const TxHashParamSchema: z.ZodObject<{
    txhash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    txhash: string;
}, {
    txhash: string;
}>;
/**
 * heightパスパラメータ検証
 */
export declare const HeightParamSchema: z.ZodObject<{
    height: z.ZodString;
}, "strip", z.ZodTypeAny, {
    height: string;
}, {
    height: string;
}>;
//# sourceMappingURL=api.d.ts.map