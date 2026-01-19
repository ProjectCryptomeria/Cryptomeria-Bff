/**
 * Tx ルート - simulate / broadcast / tx確認
 */

import { Hono } from 'hono';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import type { EnvConfig } from '../config/env.js';
import { SimulateRequestSchema, BroadcastRequestSchema } from '../types/api.js';
import { isValidChainId } from '../types/chains.js';
import { invalidInputError, payloadTooLargeError } from '../types/errors.js';

/**
 * Txルートを作成
 */
export function createTxRoutes(cryptomeriaManager: CryptomeriaManager, config: EnvConfig): Hono {
	const app = new Hono();

	/**
	 * POST /api/v1/chains/:chainId/simulate
	 * Txをシミュレート（ガス見積り）
	 */
	app.post('/:chainId/simulate', async (c) => {
		const chainId = c.req.param('chainId');

		// chainIdバリデーション
		if (!isValidChainId(chainId)) {
			throw invalidInputError('Invalid chainId format', { chainId });
		}

		// リクエストボディ取得
		const body = await c.req.json();
		const parseResult = SimulateRequestSchema.safeParse(body);

		if (!parseResult.success) {
			throw invalidInputError('Invalid request body', {
				errors: parseResult.error.errors,
			});
		}

		const { txBytesBase64 } = parseResult.data;

		// サイズ制限チェック
		if (txBytesBase64.length > config.maxTxBase64Chars) {
			throw payloadTooLargeError('txBytesBase64 exceeds limit', {
				maxChars: config.maxTxBase64Chars,
			});
		}

		const result = await cryptomeriaManager.simulateTx(chainId, txBytesBase64);
		return c.json(result);
	});

	/**
	 * POST /api/v1/chains/:chainId/broadcast
	 * 署名済みTxをブロードキャスト
	 */
	app.post('/:chainId/broadcast', async (c) => {
		const chainId = c.req.param('chainId');

		// chainIdバリデーション
		if (!isValidChainId(chainId)) {
			throw invalidInputError('Invalid chainId format', { chainId });
		}

		// リクエストボディ取得
		const body = await c.req.json();
		const parseResult = BroadcastRequestSchema.safeParse(body);

		if (!parseResult.success) {
			throw invalidInputError('Invalid request body', {
				errors: parseResult.error.errors,
			});
		}

		const { txBytesBase64, mode } = parseResult.data;

		// サイズ制限チェック
		if (txBytesBase64.length > config.maxTxBase64Chars) {
			throw payloadTooLargeError('txBytesBase64 exceeds limit', {
				maxChars: config.maxTxBase64Chars,
			});
		}

		// ログ（txBytesBase64全体は出さない）
		console.log(`[broadcast] chainId=${chainId}, mode=${mode}, payloadSize=${txBytesBase64.length}`);

		const result = await cryptomeriaManager.broadcastTx(chainId, txBytesBase64, mode);

		console.log(`[broadcast] chainId=${chainId}, txhash=${result.txhash}`);

		return c.json(result);
	});

	/**
	 * GET /api/v1/chains/:chainId/tx/:txhash
	 * Tx情報を取得
	 */
	app.get('/:chainId/tx/:txhash', async (c) => {
		const chainId = c.req.param('chainId');
		const txhash = c.req.param('txhash');

		// chainIdバリデーション
		if (!isValidChainId(chainId)) {
			throw invalidInputError('Invalid chainId format', { chainId });
		}

		if (!txhash || txhash.trim() === '') {
			throw invalidInputError('txhash is required');
		}

		const result = await cryptomeriaManager.getTx(chainId, txhash);
		return c.json(result);
	});

	return app;
}
