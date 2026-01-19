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
export const SimulateRequestSchema = z.object({
	txBytesBase64: z.string().min(1, 'txBytesBase64 is required'),
});

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
export const BroadcastRequestSchema = z.object({
	txBytesBase64: z.string().min(1, 'txBytesBase64 is required'),
	mode: z.enum(['sync', 'async', 'commit']).optional().default('sync'),
});

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
export const ChainIdParamSchema = z.object({
	chainId: z.string().min(1).regex(/^(gwc|mdsc|fdsc-\d+)$/, 'Invalid chainId format'),
});

/**
 * addressパスパラメータ検証
 */
export const AddressParamSchema = z.object({
	address: z.string().min(1, 'address is required'),
});

/**
 * txhashパスパラメータ検証
 */
export const TxHashParamSchema = z.object({
	txhash: z.string().min(1, 'txhash is required'),
});

/**
 * heightパスパラメータ検証
 */
export const HeightParamSchema = z.object({
	height: z.string().regex(/^\d+$/, 'height must be a positive integer'),
});
