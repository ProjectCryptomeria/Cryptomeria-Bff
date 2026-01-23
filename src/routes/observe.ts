/**
 * Observe ルート - 観測系API（mempool, status, blocks）
 * P0-1: lib/errors.ts統一
 * P0-5: blocks detail query, txCount field, /blocks/{height}/txs endpoint
 */

import { Hono } from 'hono';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import { isValidChainId } from '../types/chains.js';
import { invalidArgumentError } from '../lib/errors.js';

/**
 * Observeルートを作成
 */
export function createObserveRoutes(cryptomeriaManager: CryptomeriaManager): Hono {
	const app = new Hono();

	/**
	 * GET /api/v1/chains/:chainId/mempool
	 * Mempool情報を取得
	 */
	/**
	 * GET /api/v1/chains/:chainId/mempool
	 * Mempool情報を取得
	 * Limit対応
	 */
	app.get('/:chainId/mempool', async (c) => {
		const chainId = c.req.param('chainId');
		const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 100;

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		// Use getMempoolDetail for full details
		const result = await cryptomeriaManager.getMempoolDetail(chainId, limit);

		// Ensure maxTxBase64Chars check is done in getMempoolDetail or here if still needed?
		// cryptomeriaManager handles truncation/filtering logic requested.

		return c.json(result);
	});

	/**
	 * GET /api/v1/chains/:chainId/status
	 * ノードステータスを取得（フラット形式）
	 */
	app.get('/:chainId/status', async (c) => {
		const chainId = c.req.param('chainId');

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		const result = await cryptomeriaManager.getStatus(chainId);
		// Flatten response as per requirement
		return c.json({
			chainId,
			latestHeight: result.syncInfo.latestBlockHeight,
			latestTime: result.syncInfo.latestBlockTime,
			catchingUp: result.syncInfo.catchingUp
		});
	});

	/**
	 * GET /api/v1/chains/:chainId/blocks/latest
	 * 最新ブロック情報を取得
	 * Query: detail=true|false (default: false)
	 */
	app.get('/:chainId/blocks/latest', async (c) => {
		const chainId = c.req.param('chainId');
		const detail = c.req.query('detail') === 'true';

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		const result = await cryptomeriaManager.getLatestBlock(chainId);

		// P0-5: Add txCount and conditionally include txHashes
		const response: Record<string, unknown> = {
			height: result.height,
			time: result.time,
			hash: result.hash,
			txCount: result.numTxs,
			numTxs: result.numTxs, // Keep for backward compatibility
		};

		if (detail && result.txHashes) {
			response.txHashes = result.txHashes;
		}

		return c.json(response);
	});

	/**
	 * GET /api/v1/chains/:chainId/blocks/:height
	 * 指定高さのブロック情報を取得
	 * Query: detail=true|false (default: false)
	 */
	app.get('/:chainId/blocks/:height', async (c) => {
		const chainId = c.req.param('chainId');
		const height = c.req.param('height');
		const detail = c.req.query('detail') === 'true';

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		// heightが数値かどうか検証
		if (!/^\d+$/.test(height)) {
			throw invalidArgumentError('height must be a positive integer', { field: 'height', value: height });
		}

		const result = await cryptomeriaManager.getBlock(chainId, height);

		// P0-5: Add txCount and conditionally include txHashes
		const response: Record<string, unknown> = {
			height: result.height,
			time: result.time,
			hash: result.hash,
			txCount: result.numTxs,
			numTxs: result.numTxs, // Keep for backward compatibility
		};

		if (detail && result.txHashes) {
			response.txHashes = result.txHashes;
		}

		return c.json(response);
	});

	/**
	 * GET /api/v1/chains/:chainId/blocks/:height/txs
	 * 指定高さのブロックのトランザクション一覧を取得
	 * Query: format=hash|base64 (default: hash)
	 * P0-5: 新規追加
	 */
	app.get('/:chainId/blocks/:height/txs', async (c) => {
		const chainId = c.req.param('chainId');
		const height = c.req.param('height');
		const format = c.req.query('format') ?? 'hash';

		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		if (!/^\d+$/.test(height)) {
			throw invalidArgumentError('height must be a positive integer', { field: 'height', value: height });
		}

		if (format !== 'hash' && format !== 'base64') {
			throw invalidArgumentError('format must be hash or base64', { field: 'format', value: format });
		}

		const result = await cryptomeriaManager.getBlockTxs(chainId, height, format);
		return c.json(result);
	});

	return app;
}

