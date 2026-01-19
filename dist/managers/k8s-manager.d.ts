/**
 * K8sManager - Kubernetes操作マネージャー
 *
 * NodePort Serviceの動的解決を提供する
 */
import type { EnvConfig } from '../config/env.js';
import type { ChainSummary, ChainEndpoints, ChainInfo } from '../types/chains.js';
/**
 * K8sManager
 */
export declare class K8sManager {
    private readonly k8sApi;
    private readonly namespace;
    private readonly nodeHost;
    private readonly cacheTtlMs;
    private readonly timeoutMs;
    /** endpoint解決結果キャッシュ */
    private endpointCache;
    /** Service一覧キャッシュ */
    private servicesCache;
    constructor(config: EnvConfig);
    /**
     * Cryptomeria関連のServiceを列挙
     */
    listChainServices(): Promise<ChainSummary[]>;
    /**
     * 指定chainIdのendpointを解決
     */
    resolveChainEndpoints(chainId: string): Promise<ChainEndpoints>;
    /**
     * ChainEndpointsをChainInfoに変換
     */
    endpointsToInfo(endpoints: ChainEndpoints): ChainInfo;
    /**
     * 全チェーンのendpointを解決
     */
    resolveAllEndpoints(): Promise<Map<string, ChainEndpoints>>;
    /**
     * キャッシュをクリア
     */
    clearCache(): void;
    /**
     * タイムアウトエラー判定
     */
    private isTimeoutError;
    /**
     * Not Foundエラー判定
     */
    private isNotFoundError;
}
//# sourceMappingURL=k8s-manager.d.ts.map