/**
 * CryptomeriaManager - Cryptomeria REST/RPC操作マネージャー
 * 
 * 署名に必要な情報の取得、simulate、broadcast、観測機能を提供する
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
import { badGatewayError, gatewayTimeoutError, notFoundError } from '../types/errors.js';
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
				code?: number;
				raw_log?: string;
			};
		};

		const txhash = data.tx_response?.txhash ?? '';

		return {
			txhash,
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
	async getMempool(chainId: string): Promise<MempoolInfo> {
		const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase;
		const url = `${rpcBase}/num_unconfirmed_txs`;

		const response = await this.fetchWithTimeout(url);
		const data = await response.json() as {
			result?: {
				n_txs?: string;
				total_bytes?: string;
			};
		};

		return {
			numUnconfirmedTxs: parseInt(data.result?.n_txs ?? '0', 10),
			totalBytes: parseInt(data.result?.total_bytes ?? '0', 10),
		};
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
				throw badGatewayError(`Downstream error: ${response.status}`, {
					status: response.status,
					body: errorBody.substring(0, 500),
				});
			}

			return response;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw gatewayTimeoutError('Downstream request timeout');
			}
			if (error instanceof Error && error.name === 'ApiError') {
				throw error;
			}
			throw badGatewayError('Downstream request failed', {
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
