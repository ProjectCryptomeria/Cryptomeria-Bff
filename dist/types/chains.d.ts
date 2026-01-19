/**
 * Chain関連の型定義
 */
/** 許可されるchainId形式 */
export type ChainIdType = 'gwc' | 'mdsc' | `fdsc-${number}`;
/** chainIdを検証 */
export declare function isValidChainId(chainId: string): chainId is ChainIdType;
/** chainIdからservice名を生成 */
export declare function getServiceName(chainId: string): string;
/** service名からchainIdを抽出 */
export declare function extractChainId(serviceName: string): string | null;
/**
 * Chain概要（一覧用）
 */
export interface ChainSummary {
    chainId: string;
    serviceName: string;
}
/**
 * Chain詳細情報（endpoint解決結果）
 */
export interface ChainInfo {
    chainId: string;
    serviceName: string;
    restBase: string;
    rpcBase: string;
    wsRpcUrl?: string;
    grpcAddr?: string;
}
/**
 * NodePort解決結果（内部用）
 */
export interface ChainEndpoints {
    chainId: string;
    serviceName: string;
    apiNodePort?: number;
    rpcNodePort?: number;
    grpcNodePort?: number;
    restBase?: string;
    rpcBase?: string;
    wsRpcUrl?: string;
    grpcAddr?: string;
    resolvedAt: Date;
}
/**
 * ポート種別
 */
export type PortType = 'api' | 'rpc' | 'grpc';
/**
 * Service port情報
 */
export interface ServicePort {
    name: string;
    port: number;
    nodePort?: number;
}
//# sourceMappingURL=chains.d.ts.map