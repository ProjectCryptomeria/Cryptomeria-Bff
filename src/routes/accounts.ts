/**
 * Accounts ルート - アカウント情報API
 * P0-1: lib/errors.ts統一
 */

import { Hono } from 'hono';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import { isValidChainId } from '../types/chains.js';
import { invalidArgumentError } from '../lib/errors.js';

/**
 * Accountsルートを作成
 */
export function createAccountsRoutes(cryptomeriaManager: CryptomeriaManager): Hono {
	const app = new Hono();

	/**
	 * GET /api/v1/chains/:chainId/accounts/:address
	 * アカウント情報（accountNumber, sequence）を取得
	 */
	app.get('/:chainId/accounts/:address', async (c) => {
		const chainId = c.req.param('chainId');
		const address = c.req.param('address');

		// バリデーション
		if (!isValidChainId(chainId)) {
			throw invalidArgumentError('Invalid chainId format', { chainId });
		}

		if (!address || address.trim() === '') {
			throw invalidArgumentError('address is required', { field: 'address' });
		}

		const accountInfo = await cryptomeriaManager.getAccount(chainId, address);
		return c.json(accountInfo);
	});

	return app;
}
