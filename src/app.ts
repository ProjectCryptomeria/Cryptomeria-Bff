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
	const utilsRoutes = createUtilsRoutes(cryptomeriaManager, jobRunner);
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
 * ジョブ定義を登録（スタブ実装）
 * 実際のステップ実行ロジックは別途実装
 */
function registerJobDefinitions(
	jobRunner: JobRunner,
	_cryptomeriaManager: CryptomeriaManager,
	_k8sManager: K8sManager
): void {
	// System jobs
	jobRunner.registerDefinition('system.start', {
		steps: ['discover', 'initRelayer', 'connectAll', 'startRelayer', 'waitReady'],
		executors: {
			discover: async (_job, _stepIndex, _signal, log) => {
				log('Discovering namespace and pods...');
				return { message: 'Discovery complete' };
			},
			initRelayer: async (_job, _stepIndex, _signal, log) => {
				log('Initializing relayer config/chains/keys...');
				return { message: 'Relayer initialized' };
			},
			connectAll: async (_job, _stepIndex, _signal, log) => {
				log('Connecting all chains...');
				return { message: 'All chains connected' };
			},
			startRelayer: async (_job, _stepIndex, _signal, log) => {
				log('Starting relayer...');
				return { message: 'Relayer started' };
			},
			waitReady: async (_job, _stepIndex, _signal, log) => {
				log('Waiting for IBC ready...');
				return { message: 'IBC ready' };
			},
		},
	});

	jobRunner.registerDefinition('system.connect', {
		steps: ['discover', 'connectAll'],
		executors: {
			discover: async (_job, _stepIndex, _signal, log) => {
				log('Discovering namespace and pods...');
				return { message: 'Discovery complete' };
			},
			connectAll: async (_job, _stepIndex, _signal, log) => {
				log('Connecting chains...');
				return { message: 'Chains connected' };
			},
		},
	});

	// Utils jobs (stub implementations)
	jobRunner.registerDefinition('utils.observe.tx-confirmation', {
		steps: ['poll'],
		executors: {
			poll: async (_job, _stepIndex, _signal, log) => {
				log('Polling for tx confirmation...');
				return { message: 'Tx confirmed', result: { confirmed: true } };
			},
		},
	});

	jobRunner.registerDefinition('utils.observe.tx-confirmation-batch', {
		steps: ['pollBatch'],
		executors: {
			pollBatch: async (_job, _stepIndex, _signal, log) => {
				log('Polling for batch tx confirmations...');
				return { message: 'Batch complete', result: { total: 0, succeeded: 0, failed: 0 } };
			},
		},
	});

	jobRunner.registerDefinition('utils.metrics.throughput', {
		steps: ['calculate'],
		executors: {
			calculate: async (_job, _stepIndex, _signal, log) => {
				log('Calculating throughput...');
				return { message: 'Throughput calculated', result: { tps: 0 } };
			},
		},
	});

	jobRunner.registerDefinition('utils.metrics.resource-snapshot', {
		steps: ['collect'],
		executors: {
			collect: async (_job, _stepIndex, _signal, log) => {
				log('Collecting resource snapshot...');
				return { message: 'Snapshot collected', result: { observedAt: new Date().toISOString() } };
			},
		},
	});

	jobRunner.registerDefinition('utils.load.broadcast-batch', {
		steps: ['broadcast'],
		executors: {
			broadcast: async (_job, _stepIndex, _signal, log) => {
				log('Broadcasting batch...');
				return { message: 'Broadcast complete', result: { total: 0, succeeded: 0 } };
			},
		},
	});

	jobRunner.registerDefinition('utils.load.broadcast-and-confirm', {
		steps: ['broadcastAndConfirm'],
		executors: {
			broadcastAndConfirm: async (_job, _stepIndex, _signal, log) => {
				log('Broadcasting and confirming...');
				return { message: 'Complete', result: { total: 0, confirmed: 0 } };
			},
		},
	});
}

