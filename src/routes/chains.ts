/**
 * Chains ルート - Discovery API
 */

import { Hono } from 'hono';
import type { K8sManager } from '../managers/k8s-manager.js';
import { ChainIdParamSchema } from '../types/api.js';
import { isValidChainId } from '../types/chains.js';
import { invalidInputError } from '../types/errors.js';

/**
 * Chainsルートを作成
 */
export function createChainsRoutes(k8sManager: K8sManager): Hono {
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

	return app;
}
