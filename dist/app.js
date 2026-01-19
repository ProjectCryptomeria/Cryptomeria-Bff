/**
 * Honoアプリケーション
 *
 * ルーティング、認証、エラーハンドリングを統合
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { K8sManager } from './managers/k8s-manager.js';
import { CryptomeriaManager } from './managers/cryptomeria-manager.js';
import { createChainsRoutes } from './routes/chains.js';
import { createAccountsRoutes } from './routes/accounts.js';
import { createTxRoutes } from './routes/tx.js';
import { createObserveRoutes } from './routes/observe.js';
import { ApiError, unauthorizedError, internalError } from './types/errors.js';
/**
 * Honoアプリケーションを作成
 */
export function createApp(config) {
    const app = new Hono();
    // マネージャーの初期化
    const k8sManager = new K8sManager(config);
    const cryptomeriaManager = new CryptomeriaManager(config, k8sManager);
    // ミドルウェア
    app.use('*', logger());
    app.use('*', prettyJSON());
    app.use('*', cors());
    // 認証ミドルウェア（/api/v1配下）
    app.use('/api/v1/*', async (c, next) => {
        const authHeader = c.req.header('Authorization');
        if (!authHeader) {
            throw unauthorizedError('Missing Authorization header');
        }
        const [scheme, token] = authHeader.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token) {
            throw unauthorizedError('Invalid Authorization format. Expected: Bearer <token>');
        }
        if (token !== config.apiToken) {
            throw unauthorizedError('Invalid bearer token');
        }
        await next();
    });
    // ヘルスチェック（認証不要）
    app.get('/health', (c) => {
        return c.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    // API v1 ルート
    const chainsRoutes = createChainsRoutes(k8sManager);
    const accountsRoutes = createAccountsRoutes(cryptomeriaManager);
    const txRoutes = createTxRoutes(cryptomeriaManager, config);
    const observeRoutes = createObserveRoutes(cryptomeriaManager);
    // ルートをマウント
    app.route('/api/v1/chains', chainsRoutes);
    app.route('/api/v1/chains', accountsRoutes);
    app.route('/api/v1/chains', txRoutes);
    app.route('/api/v1/chains', observeRoutes);
    // グローバルエラーハンドラー
    app.onError((err, c) => {
        console.error('[error]', err);
        if (err instanceof ApiError) {
            return c.json(err.toResponse(), err.statusCode);
        }
        // 予期しないエラー
        const apiError = internalError(process.env.NODE_ENV === 'development' ? err.message : 'Internal server error');
        return c.json(apiError.toResponse(), apiError.statusCode);
    });
    // 404ハンドラー
    app.notFound((c) => {
        return c.json({
            error: {
                code: 'NOT_FOUND',
                message: `Route not found: ${c.req.method} ${c.req.path}`,
            },
        }, 404);
    });
    return app;
}
//# sourceMappingURL=app.js.map