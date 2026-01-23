/**
 * CryptomeriaManager - Cryptomeria REST/RPC操作マネージャー
 * 
 * 署名に必要な情報の取得、simulate、broadcast、観測機能を提供する
 * P0-1: lib/errors.ts統一
 */

import type { EnvConfig } from '../config/env.js';
import type { ChainEndpoints } from '../types/chains.js';
import type {
	AccountInfo,
	SimulateResponse,
	BroadcastResponse,
	BroadcastMode,
	TxInfo,
	MempoolInfo,
	NodeStatus,
	BlockInfo,
} from '../types/api.js';
import { notFoundError, upstreamError, timeoutError } from '../lib/errors.js';
import { K8sManager } from './k8s-manager.js';
import { createHash } from 'crypto';

/**
 * CryptomeriaManager
 */
export class CryptomeriaManager {
	private readonly k8sManager: K8sManager;
	private readonly timeoutMs: number;

	constructor(config: EnvConfig, k8sManager: K8sManager) {
		this.k8sManager = k8sManager;
		this.timeoutMs = config.downstreamTimeoutMs;
	}

	/**
	 * アカウント情報を取得
	 */
	async getAccount(chainId: string, address: string): Promise<AccountInfo> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const url = `${endpoints.restBase}/cosmos/auth/v1beta1/accounts/${address}`;

		const response = await this.fetchWithTimeout(url);
		const data = await response.json() as {
			account?: {
				account_number?: string;
				sequence?: string;
				'@type'?: string;
				base_account?: {
					account_number?: string;
					sequence?: string;
				};
			};
		};

		// Cosmos SDK v0.46+ と互換性を持たせる
		const account = data.account;
		if (!account) {
			throw notFoundError('Account not found', { address });
		}

		// base_accountがある場合はそちらを参照（vesting accountなど）
		const baseAccount = account.base_account ?? account;

		return {
			address,
			accountNumber: String(baseAccount.account_number ?? '0'),
			sequence: String(baseAccount.sequence ?? '0'),
		};
	}

	/**
	 * Txをシミュレート
	 */
	async simulateTx(chainId: string, txBytesBase64: string): Promise<SimulateResponse> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const url = `${endpoints.restBase}/cosmos/tx/v1beta1/simulate`;

		const response = await this.fetchWithTimeout(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tx_bytes: txBytesBase64 }),
		});

		const data = await response.json() as {
			gas_info?: {
				gas_used?: string;
				gas_wanted?: string;
			};
		};

		return {
			gasUsed: data.gas_info?.gas_used ?? '0',
			gasWanted: data.gas_info?.gas_wanted ?? '0',
			raw: data,
		};
	}

	/**
	 * 署名済みTxをブロードキャスト
	 * P0-4: tx_responseから必須フィールドをパース
	 */
	async broadcastTx(
		chainId: string,
		txBytesBase64: string,
		mode: BroadcastMode = 'sync'
	): Promise<BroadcastResponse> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const url = `${endpoints.restBase}/cosmos/tx/v1beta1/txs`;

		// modeをCosmos SDK形式に変換
		const broadcastMode = this.toBroadcastMode(mode);

		const response = await this.fetchWithTimeout(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tx_bytes: txBytesBase64,
				mode: broadcastMode,
			}),
		});

		const observedAt = new Date().toISOString();
		const data = await response.json() as {
			tx_response?: {
				txhash?: string;
				height?: string;
				code?: number;
				raw_log?: string;
				gas_wanted?: string;
				gas_used?: string;
			};
		};

		const txResponse = data.tx_response ?? {};

		return {
			txhash: txResponse.txhash ?? '',
			height: txResponse.height ? parseInt(txResponse.height, 10) : undefined,
			code: txResponse.code,
			rawLog: txResponse.raw_log,
			gasWanted: txResponse.gas_wanted,
			gasUsed: txResponse.gas_used,
			broadcastResult: data,
			observedAt,
		};
	}

	/**
	 * Tx情報を取得
	 */
	async getTx(chainId: string, txhash: string): Promise<TxInfo> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const url = `${endpoints.restBase}/cosmos/tx/v1beta1/txs/${txhash}`;

		const response = await this.fetchWithTimeout(url);
		const data = await response.json() as {
			tx_response?: {
				txhash?: string;
				height?: string;
				code?: number;
				raw_log?: string;
				timestamp?: string;
			};
		};

		const txResponse = data.tx_response;
		if (!txResponse) {
			throw notFoundError('Transaction not found', { txhash });
		}

		return {
			txhash: txResponse.txhash ?? txhash,
			height: txResponse.height ?? '0',
			code: txResponse.code ?? 0,
			rawLog: txResponse.raw_log,
			timestamp: txResponse.timestamp,
		};
	}

	/**
	 * Mempool情報を取得（RPC）
	 */
	/**
	 * Mempool詳細情報を取得（Rest API）
	 * P2-3: サイズ・Txリスト取得、制限対応
	 */
	async getMempoolDetail(chainId: string, limit: number = 100): Promise<{ size: number; totalBytes: number; txs: string[] }> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const restBase = endpoints.restBase;

		// 1. Get size (unconfirmed_txs count)
		// /cosmos/tx/v1beta1/txs doesn't give mempool txs usually.
		// Use RPC /num_unconfirmed_txs for count, /unconfirmed_txs for list
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase; // Fallback might not work for RPC if REST base is used, but types handle it.

		// Note: The prompt implied using "REST: /num_unconfirmed_txs"? No, standard is RPC for mempool usually.
		// "cryptomeria-manager.ts に getMempoolDetail を追加 or getMempool を拡張"

		// Using RPC for mempool is standard in Cosmos.
		// URL: /num_unconfirmed_txs
		const numRes = await this.fetchWithTimeout(`${rpcBase}/num_unconfirmed_txs`);
		const numData = await numRes.json() as { result: { n_txs: string; total_bytes: string } };
		const size = parseInt(numData.result.n_txs, 10);
		const totalBytes = parseInt(numData.result.total_bytes, 10);

		// 2. Get Txs
		// URL: /unconfirmed_txs?limit=N
		const txsRes = await this.fetchWithTimeout(`${rpcBase}/unconfirmed_txs?limit=${limit}`);
		const txsData = await txsRes.json() as { result: { txs: string[] } };
		let txs = txsData.result?.txs ?? [];

		// Truncate if too many (should be handled by limit param but just in case)
		if (txs.length > limit) {
			txs = txs.slice(0, limit);
		}

		// Truncate individual tx strings if too long (MAX_TX_BASE64_CHARS check done in validation usually, but display might need truncate)
		// The requirement was: "文字数制限 maxTxBase64Chars を超えないように 先頭から詰める（合計文字数でbreak）"
		// This likely means: response size limit for the API. 
		// "先頭から詰める" -> Keep adding txs until total length exceeds max?
		// "合計文字数でbreak" implies total response size control.

		const MAX_TOTAL_CHARS = 100000; // Example limit
		let currentChars = 0;
		const safeTxs: string[] = [];

		for (const tx of txs) {
			if (currentChars + tx.length > MAX_TOTAL_CHARS) break;
			safeTxs.push(tx);
			currentChars += tx.length;
		}

		return {
			size,
			totalBytes,
			txs: safeTxs
		};
	}

	/**
	 * Mempool情報を取得（Legacy wrapper）
	 */
	async getMempool(chainId: string): Promise<MempoolInfo> {
		const detail = await this.getMempoolDetail(chainId, 1);
		return {
			numUnconfirmedTxs: detail.size,
			totalBytes: detail.totalBytes
		};
	}

	/**
	 * Balancesを取得（Bank API）
	 */
	async getBalances(chainId: string, address: string): Promise<{ denom: string; amount: string }[]> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const url = `${endpoints.restBase}/cosmos/bank/v1beta1/balances/${address}`;

		const response = await this.fetchWithTimeout(url);
		const data = await response.json();

		// Zod validation (manual check here for brevity, or cleaner validation helper)
		// Expect: { balances: [{ denom, amount }], pagination: ... }
		if (!data || typeof data !== 'object' || !Array.isArray((data as any).balances)) {
			// fallback or empty
			return [];
		}

		const balances = (data as any).balances as Array<{ denom: string; amount: string }>;
		return balances.map(b => ({
			denom: String(b.denom),
			amount: String(b.amount)
		}));
	}


	/**
	 * ノードステータスを取得（RPC）
	 */
	async getStatus(chainId: string): Promise<NodeStatus> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase;
		const url = `${rpcBase}/status`;

		const response = await this.fetchWithTimeout(url);
		const data = await response.json() as {
			result?: {
				node_info?: {
					network?: string;
					moniker?: string;
					version?: string;
				};
				sync_info?: {
					latest_block_height?: string;
					latest_block_time?: string;
					catching_up?: boolean;
				};
			};
		};

		const result = data.result;
		return {
			nodeInfo: {
				network: result?.node_info?.network ?? '',
				moniker: result?.node_info?.moniker ?? '',
				version: result?.node_info?.version ?? '',
			},
			syncInfo: {
				latestBlockHeight: result?.sync_info?.latest_block_height ?? '0',
				latestBlockTime: result?.sync_info?.latest_block_time ?? '',
				catchingUp: result?.sync_info?.catching_up ?? false,
			},
		};
	}

	/**
	 * 最新ブロック情報を取得（RPC）
	 */
	async getLatestBlock(chainId: string): Promise<BlockInfo> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase;
		const url = `${rpcBase}/block`;

		return this.parseBlockResponse(url);
	}

	/**
	 * 指定高さのブロック情報を取得（RPC）
	 */
	async getBlock(chainId: string, height: string): Promise<BlockInfo> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase;
		const url = `${rpcBase}/block?height=${height}`;

		return this.parseBlockResponse(url);
	}

	/**
	 * 指定高さのブロックのトランザクション一覧を取得（RPC）
	 * P0-5: 新規追加
	 * @param format - 'hash' の場合はtx hashを返す、'base64' の場合はbase64エンコードのtxを返す
	 */
	async getBlockTxs(chainId: string, height: string, format: 'hash' | 'base64' = 'hash'): Promise<{ height: string; txs: string[] }> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase;
		const url = `${rpcBase}/block?height=${height}`;

		const response = await this.fetchWithTimeout(url);
		const data = await response.json() as {
			result?: {
				block?: {
					header?: { height?: string };
					data?: { txs?: string[] };
				};
			};
		};

		const blockHeight = data.result?.block?.header?.height ?? height;
		const txsBase64 = data.result?.block?.data?.txs ?? [];

		const txs = format === 'hash'
			? txsBase64.map(tx => this.computeTxHash(tx))
			: txsBase64;

		return { height: blockHeight, txs };
	}


	/**
	 * ブロックレスポンスをパース
	 */
	private async parseBlockResponse(url: string): Promise<BlockInfo> {
		const response = await this.fetchWithTimeout(url);
		const data = await response.json() as {
			result?: {
				block?: {
					header?: {
						height?: string;
						time?: string;
					};
					data?: {
						txs?: string[];
					};
				};
				block_id?: {
					hash?: string;
				};
			};
		};

		const block = data.result?.block;
		const txs = block?.data?.txs ?? [];

		// tx hashを計算（base64デコード後SHA256）
		const txHashes = txs.map(tx => this.computeTxHash(tx));

		return {
			height: block?.header?.height ?? '0',
			time: block?.header?.time ?? '',
			hash: data.result?.block_id?.hash ?? '',
			numTxs: txs.length,
			txHashes,
		};
	}

	/**
	 * Txのハッシュを計算（SHA256）
	 */
	private computeTxHash(txBase64: string): string {
		try {
			const txBytes = Buffer.from(txBase64, 'base64');
			const hash = createHash('sha256').update(txBytes).digest('hex');
			return hash.toUpperCase();
		} catch {
			// フォールバック: base64の先頭部分を返す
			return txBase64.substring(0, 64).toUpperCase();
		}
	}

	/**
	 * タイムアウト付きfetch
	 */
	private async fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw upstreamError(`Downstream error: ${response.status}`, {
					status: response.status,
					body: errorBody.substring(0, 500),
				});
			}

			return response;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw timeoutError('Downstream request timeout');
			}
			if (error instanceof Error && error.name === 'ApiError') {
				throw error;
			}
			throw upstreamError('Downstream request failed', {
				error: String(error),
			});
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Broadcast modeを Cosmos SDK形式に変換
	 */
	private toBroadcastMode(mode: BroadcastMode): string {
		switch (mode) {
			case 'sync':
				return 'BROADCAST_MODE_SYNC';
			case 'async':
				return 'BROADCAST_MODE_ASYNC';
			case 'commit':
				return 'BROADCAST_MODE_BLOCK';
			default:
				return 'BROADCAST_MODE_SYNC';
		}
	}
}
