/**
 * Chains ルート - Discovery API
 * 第2層 API仕様書準拠
 */

import { Hono } from 'hono';
import type { K8sManager } from '../managers/k8s-manager.js';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import { ChainIdParamSchema } from '../types/api.js';
import { isValidChainId } from '../types/chains.js';
import { invalidInputError } from '../types/errors.js';
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
	 */
	app.get('/', async (c) => {
		const chains = await k8sManager.listChainServices();
		return c.json({ chains });
	});

	/**
	 * GET /api/v1/chains/:chainId/info
	 * チェーン情報を取得
	 */
	app.get('/:chainId/info', async (c) => {
		const chainId = c.req.param('chainId');

		// バリデーション
		if (!isValidChainId(chainId)) {
			throw invalidInputError('Invalid chainId format', { chainId });
		}

		const endpoints = await k8sManager.resolveChainEndpoints(chainId);
		const info = k8sManager.endpointsToInfo(endpoints);

		return c.json(info);
	});

	/**
	 * GET /api/v1/chains/:chainId/blocktime
	 * ブロックタイム統計を取得（キャッシュ付き）
	 */
	app.get('/:chainId/blocktime', async (c) => {
		const chainId = c.req.param('chainId');

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		const windowStr = c.req.query('window');
		const window = windowStr ? parseInt(windowStr, 10) : 100;

		if (isNaN(window) || window < 2) {
			throw invalidArgumentError('window must be >= 2', { field: 'window' });
		}
		if (window > 2000) {
			throw invalidArgumentError('window must be <= 2000', { field: 'window' });
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

		const result = await blocktimeCache.getBlocktime(chainId, window, latestHeight, fetchBlocks);

		return c.json(result);
	});

	return app;
}

