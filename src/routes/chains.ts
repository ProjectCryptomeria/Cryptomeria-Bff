/**
 * Chains ルート - Discovery API
 * 第2層 API仕様書準拠
 * P0-1: lib/errors.ts統一
 */

import { Hono } from 'hono';
import type { K8sManager } from '../managers/k8s-manager.js';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import { ChainIdParamSchema } from '../types/api.js';
import { isValidChainId } from '../types/chains.js';
import { invalidArgumentError } from '../lib/errors.js';
import { BlocktimeCache } from '../cache/blocktime-cache.js';


// Blocktime cache instance
const blocktimeCache = new BlocktimeCache(10000, 2000);

/**
 * Chainsルートを作成
 */
export function createChainsRoutes(k8sManager: K8sManager, cryptomeriaManager?: CryptomeriaManager): Hono {
	const app = new Hono();

	/**
	 * GET /api/v1/chains
	 * チェーン一覧を取得
	 * P1-1: items形式 + include=endpoints + mode バリデーション
	 */
	app.get('/', async (c) => {
		const include = c.req.query('include');
		const mode = c.req.query('mode') ?? 'auto';

		// P1-1: mode バリデーション
		if (mode !== 'auto' && mode !== 'external' && mode !== 'internal') {
			throw invalidArgumentError('mode must be auto|external|internal', { field: 'mode', value: mode });
		}

		// Get chains from pod list (pod-based discovery per P1-1)
		const chainStatuses = await k8sManager.getChainStatuses();

		// Build items array
		const items = await Promise.all(chainStatuses.map(async (chain) => {
			const item: Record<string, unknown> = {
				chainId: chain.chainId,
				pod: {
					name: chain.podName,
					ready: chain.ready,
				},
			};

			// P1-1: include=endpoints の場合のみ endpoints を付与
			if (include === 'endpoints') {
				try {
					const endpoints = await k8sManager.resolveChainEndpoints(chain.chainId);
					item.endpoints = {
						rpc: endpoints.rpcBase,
						rest: endpoints.restBase,
						grpc: endpoints.grpcAddr,
					};
				} catch {
					// Endpoint resolution failed - still include the chain but without endpoints
				}
			}

			return item;
		}));

		// Return in items format, but also keep chains for backward compatibility
		return c.json({
			items,
			// Legacy format for backward compatibility
			chains: items.map(i => ({
				chainId: i.chainId,
				serviceName: `cryptomeria-${i.chainId}`,
			})),
		});
	});

	/**
	 * GET /api/v1/chains/:chainId/info
	 * チェーン情報を取得
	 */
	app.get('/:chainId/info', async (c) => {
		const chainId = c.req.param('chainId');

		// バリデーション
		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		const endpoints = await k8sManager.resolveChainEndpoints(chainId);
		const info = k8sManager.endpointsToInfo(endpoints);

		return c.json(info);
	});

	/**
	 * GET /api/v1/chains/:chainId/blocktime
	 * ブロックタイム統計を取得（キャッシュ付き）
	 * P1-2: useCache/ttlSeconds query params対応
	 */
	app.get('/:chainId/blocktime', async (c) => {
		const chainId = c.req.param('chainId');

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		// Parse window query
		const windowStr = c.req.query('window');
		const window = windowStr ? parseInt(windowStr, 10) : 100;

		if (isNaN(window) || window < 2) {
			throw invalidArgumentError('window must be >= 2', { field: 'window' });
		}
		if (window > 2000) {
			throw invalidArgumentError('window must be <= 2000', { field: 'window' });
		}

		// P1-2: Parse useCache query (default: true)
		const useCacheStr = c.req.query('useCache');
		const useCache = useCacheStr !== 'false'; // default true

		// P1-2: Parse ttlSeconds query (optional, range 1-600)
		const ttlSecondsStr = c.req.query('ttlSeconds');
		let ttlMsOverride: number | undefined;
		if (ttlSecondsStr) {
			const ttlSeconds = parseInt(ttlSecondsStr, 10);
			if (isNaN(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) {
				throw invalidArgumentError('ttlSeconds must be between 1 and 600', { field: 'ttlSeconds' });
			}
			ttlMsOverride = ttlSeconds * 1000;
		}

		// Resolve endpoints to get RPC base
		const endpoints = await k8sManager.resolveChainEndpoints(chainId);
		const rpcBase = endpoints.rpcBase ?? endpoints.restBase;

		if (!rpcBase) {
			throw invalidArgumentError('Chain RPC endpoint not available', { chainId });
		}

		// Get latest height
		const statusRes = await fetch(`${rpcBase}/status`);
		const statusData = await statusRes.json() as {
			result?: { sync_info?: { latest_block_height?: string } }
		};
		const latestHeight = parseInt(statusData?.result?.sync_info?.latest_block_height ?? '0', 10);

		if (latestHeight === 0) {
			throw invalidArgumentError('Could not determine chain latest height', { chainId });
		}

		// Fetch blocks function for cache
		const fetchBlocks = async (startHeight: number, endHeight: number) => {
			const blocks: { height: number; time: string }[] = [];

			for (let h = startHeight; h <= endHeight; h++) {
				try {
					const blockRes = await fetch(`${rpcBase}/block?height=${h}`);
					const blockData = await blockRes.json() as {
						result?: { block?: { header?: { height?: string; time?: string } } }
					};
					const height = parseInt(blockData?.result?.block?.header?.height ?? '0', 10);
					const time = blockData?.result?.block?.header?.time ?? '';
					if (height > 0 && time) {
						blocks.push({ height, time });
					}
				} catch {
					// Skip failed block fetches
				}
			}

			return blocks;
		};

		const result = await blocktimeCache.getBlocktime(chainId, window, latestHeight, fetchBlocks, {
			useCache,
			ttlMsOverride,
		});

		return c.json(result);
	});

	return app;
}

