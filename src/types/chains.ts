/**
 * Chain関連の型定義
 */

/** 許可されるchainId形式 */
export type ChainIdType = 'gwc' | 'mdsc' | `fdsc-${number}`;

/** chainIdを検証 */
export function isValidChainId(chainId: string): chainId is ChainIdType {
	if (chainId === 'gwc' || chainId === 'mdsc') {
		return true;
	}
	return /^fdsc-\d+$/.test(chainId);
}

/** chainIdからservice名を生成 */
export function getServiceName(chainId: string): string {
	return `cryptomeria-${chainId}`;
}

/** service名からchainIdを抽出 */
export function extractChainId(serviceName: string): string | null {
	const match = serviceName.match(/^cryptomeria-(.+)$/);
	return match ? match[1] : null;
}

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
