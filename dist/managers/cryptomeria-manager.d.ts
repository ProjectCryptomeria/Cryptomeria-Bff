/**
 * CryptomeriaManager - Cryptomeria REST/RPC操作マネージャー
 *
 * 署名に必要な情報の取得、simulate、broadcast、観測機能を提供する
 */
import type { EnvConfig } from '../config/env.js';
import type { AccountInfo, SimulateResponse, BroadcastResponse, BroadcastMode, TxInfo, MempoolInfo, NodeStatus, BlockInfo } from '../types/api.js';
import { K8sManager } from './k8s-manager.js';
/**
 * CryptomeriaManager
 */
export declare class CryptomeriaManager {
    private readonly k8sManager;
    private readonly timeoutMs;
    constructor(config: EnvConfig, k8sManager: K8sManager);
    /**
     * アカウント情報を取得
     */
    getAccount(chainId: string, address: string): Promise<AccountInfo>;
    /**
     * Txをシミュレート
     */
    simulateTx(chainId: string, txBytesBase64: string): Promise<SimulateResponse>;
    /**
     * 署名済みTxをブロードキャスト
     */
    broadcastTx(chainId: string, txBytesBase64: string, mode?: BroadcastMode): Promise<BroadcastResponse>;
    /**
     * Tx情報を取得
     */
    getTx(chainId: string, txhash: string): Promise<TxInfo>;
    /**
     * Mempool情報を取得（RPC）
     */
    getMempool(chainId: string): Promise<MempoolInfo>;
    /**
     * ノードステータスを取得（RPC）
     */
    getStatus(chainId: string): Promise<NodeStatus>;
    /**
     * 最新ブロック情報を取得（RPC）
     */
    getLatestBlock(chainId: string): Promise<BlockInfo>;
    /**
     * 指定高さのブロック情報を取得（RPC）
     */
    getBlock(chainId: string, height: string): Promise<BlockInfo>;
    /**
     * ブロックレスポンスをパース
     */
    private parseBlockResponse;
    /**
     * Txのハッシュを計算（SHA256）
     */
    private computeTxHash;
    /**
     * タイムアウト付きfetch
     */
    private fetchWithTimeout;
    /**
     * Broadcast modeを Cosmos SDK形式に変換
     */
    private toBroadcastMode;
}
//# sourceMappingURL=cryptomeria-manager.d.ts.map