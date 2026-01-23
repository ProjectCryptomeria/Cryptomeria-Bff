/**
 * Honoアプリケーション
 *
 * ルーティング、認証、エラーハンドリングを統合
 * 三層アーキテクチャ: System/Blockchain/Utilities
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

import type { EnvConfig } from './config/env.js';
import { K8sManager } from './managers/k8s-manager.js';
import { CryptomeriaManager } from './managers/cryptomeria-manager.js';
import { JobRunner } from './jobs/job-runner.js';

// Legacy routes
import { createChainsRoutes } from './routes/chains.js';
import { createAccountsRoutes } from './routes/accounts.js';
import { createTxRoutes } from './routes/tx.js';
import { createObserveRoutes } from './routes/observe.js';

// New v1 spec routes
import { createSystemRoutes } from './routes/system.js';
import { createUtilsRoutes } from './routes/utils.js';

// Job definitions
import { createUtilsJobDefinitions } from './jobs/definitions/utils.js';
import { createSystemJobDefinitions } from './jobs/definitions/system.js';

import { ApiError } from './lib/errors.js';
import { ApiError as LegacyApiError, unauthorizedError, internalError } from './types/errors.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Honoアプリケーションを作成
 */
export function createApp(config: EnvConfig): Hono {
	const app = new Hono();

	// マネージャーの初期化
	const k8sManager = new K8sManager(config);
	const cryptomeriaManager = new CryptomeriaManager(config, k8sManager);

	// ジョブシステム初期化
	const jobRunner = new JobRunner(config);
	// 起動時のクリーンアップ（非同期で実行）
	jobRunner.cleanupStaleJobs().catch(err => {
		console.error('[JobRunner] Failed to cleanup stale jobs:', err);
	});

	registerJobDefinitions(jobRunner, cryptomeriaManager, k8sManager);

	// ミドルウェア
	app.use('*', logger());
	app.use('*', prettyJSON());
	app.use('*', cors());

	// 認証ミドルウェア（/api/v1配下）
	app.use('/api/v1/*', async (c, next) => {
		// 開発・ローカル用途：認証を無効化
		if (config.authDisabled) {
			await next();
			return;
		}

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

	// === 第1層: System/K8s ルート ===
	const systemRoutes = createSystemRoutes(k8sManager, jobRunner);
	app.route('/api/v1/system', systemRoutes);

	// === 第2層: Blockchain ルート ===
	const chainsRoutes = createChainsRoutes(k8sManager);
	const accountsRoutes = createAccountsRoutes(cryptomeriaManager);
	const txRoutes = createTxRoutes(cryptomeriaManager, config);
	const observeRoutes = createObserveRoutes(cryptomeriaManager);

	app.route('/api/v1/chains', chainsRoutes);
	app.route('/api/v1/chains', accountsRoutes);
	app.route('/api/v1/chains', txRoutes);
	app.route('/api/v1/chains', observeRoutes);

	// === 第3層: Utilities ルート ===
	const utilsRoutes = createUtilsRoutes(cryptomeriaManager, jobRunner, config);
	app.route('/api/v1/utils', utilsRoutes);

	// グローバルエラーハンドラー
	app.onError((err, c) => {
		console.error('[error]', err);

		// 新しいApiError形式
		if (err instanceof ApiError) {
			return c.json(err.toResponse(), err.statusCode as ContentfulStatusCode);
		}

		// 旧ApiError形式（後方互換）
		if (err instanceof LegacyApiError) {
			return c.json(err.toResponse(), err.statusCode as ContentfulStatusCode);
		}

		// 予期しないエラー
		const apiError = internalError(
			process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
		);
		return c.json(apiError.toResponse(), apiError.statusCode as ContentfulStatusCode);
	});

	// 404ハンドラー
	app.notFound((c) => {
		return c.json(
			{
				error: {
					code: 'NOT_FOUND',
					message: `Route not found: ${c.req.method} ${c.req.path}`,
				},
			},
			404
		);
	});

	return app;
}

/**
 * ジョブ定義を登録
 * P0-2: 実際の実装を含むジョブ定義
 */
function registerJobDefinitions(
	jobRunner: JobRunner,
	cryptomeriaManager: CryptomeriaManager,
	k8sManager: K8sManager
): void {
	// System jobs
	const systemDefinitions = createSystemJobDefinitions(k8sManager);
	for (const [type, definition] of Object.entries(systemDefinitions)) {
		jobRunner.registerDefinition(type, definition);
	}

	// Utils jobs - use real implementations from definitions module
	const utilsDefinitions = createUtilsJobDefinitions(cryptomeriaManager, k8sManager);
	for (const [type, definition] of Object.entries(utilsDefinitions)) {
		jobRunner.registerDefinition(type, definition);
	}
}

