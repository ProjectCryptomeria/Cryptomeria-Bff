/**
 * Observe ルート - 観測系API（mempool, status, blocks）
 */
import { Hono } from 'hono';
import { isValidChainId } from '../types/chains.js';
import { invalidInputError } from '../types/errors.js';
/**
 * Observeルートを作成
 */
export function createObserveRoutes(cryptomeriaManager) {
    const app = new Hono();
    /**
     * GET /api/v1/chains/:chainId/mempool
     * Mempool情報を取得
     */
    app.get('/:chainId/mempool', async (c) => {
        const chainId = c.req.param('chainId');
        if (!isValidChainId(chainId)) {
            throw invalidInputError('Invalid chainId format', { chainId });
        }
        const result = await cryptomeriaManager.getMempool(chainId);
        return c.json(result);
    });
    /**
     * GET /api/v1/chains/:chainId/status
     * ノードステータスを取得
     */
    app.get('/:chainId/status', async (c) => {
        const chainId = c.req.param('chainId');
        if (!isValidChainId(chainId)) {
            throw invalidInputError('Invalid chainId format', { chainId });
        }
        const result = await cryptomeriaManager.getStatus(chainId);
        return c.json(result);
    });
    /**
     * GET /api/v1/chains/:chainId/blocks/latest
     * 最新ブロック情報を取得
     */
    app.get('/:chainId/blocks/latest', async (c) => {
        const chainId = c.req.param('chainId');
        if (!isValidChainId(chainId)) {
            throw invalidInputError('Invalid chainId format', { chainId });
        }
        const result = await cryptomeriaManager.getLatestBlock(chainId);
        return c.json(result);
    });
    /**
     * GET /api/v1/chains/:chainId/blocks/:height
     * 指定高さのブロック情報を取得
     */
    app.get('/:chainId/blocks/:height', async (c) => {
        const chainId = c.req.param('chainId');
        const height = c.req.param('height');
        if (!isValidChainId(chainId)) {
            throw invalidInputError('Invalid chainId format', { chainId });
        }
        // heightが数値かどうか検証
        if (!/^\d+$/.test(height)) {
            throw invalidInputError('height must be a positive integer', { height });
        }
        const result = await cryptomeriaManager.getBlock(chainId, height);
        return c.json(result);
    });
    return app;
}
//# sourceMappingURL=observe.js.map