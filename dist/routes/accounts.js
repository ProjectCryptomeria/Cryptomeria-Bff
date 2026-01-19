/**
 * Accounts ルート - アカウント情報API
 */
import { Hono } from 'hono';
import { isValidChainId } from '../types/chains.js';
import { invalidInputError } from '../types/errors.js';
/**
 * Accountsルートを作成
 */
export function createAccountsRoutes(cryptomeriaManager) {
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
            throw invalidInputError('Invalid chainId format', { chainId });
        }
        if (!address || address.trim() === '') {
            throw invalidInputError('address is required');
        }
        const accountInfo = await cryptomeriaManager.getAccount(chainId, address);
        return c.json(accountInfo);
    });
    return app;
}
//# sourceMappingURL=accounts.js.map