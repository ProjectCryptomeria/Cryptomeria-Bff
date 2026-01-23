/**
 * エントリーポイント
 *
 * 環境変数を読み込み、サーバーを起動する
 */

import { serve } from '@hono/node-server';
import { loadEnvConfig } from './config/env.js';
import { createApp } from './app.js';

/**
 * サーバー起動
 */
async function main(): Promise<void> {
	console.log('Cryptomeria BFF Server starting...');

	// 環境変数読み込み
	let config;
	try {
		config = loadEnvConfig();
	} catch (error) {
		console.error('Configuration error:', error);
		process.exit(1);
	}

	console.log('Configuration loaded:');
	console.log(`  - K8S_NAMESPACE: ${config.k8sNamespace}`);
	console.log(`  - NODE_HOST: ${config.nodeHost}`);
	console.log(`  - PORT: ${config.port}`);

	console.log(`  - DOWNSTREAM_TIMEOUT_MS: ${config.downstreamTimeoutMs}`);
	console.log(`  - MAX_TX_BASE64_CHARS: ${config.maxTxBase64Chars}`);
	console.log(`  - ENDPOINT_CACHE_TTL_MS: ${config.endpointCacheTtlMs}`);

	// アプリケーション作成
	const app = createApp(config);

	// サーバー起動
	serve(
		{
			fetch: app.fetch,
			port: config.port,
		},
		(info) => {
			console.log(`Server is running on http://localhost:${info.port}`);
			console.log('');
			console.log('Available endpoints:');
			console.log('  -- System Layer --');
			console.log('  GET  /api/v1/system/status                - System status summary');
			console.log('  GET  /api/v1/system/preflight             - Preflight checks');
			console.log('  GET  /api/v1/system/topology              - Chain topology');
			console.log('  GET  /api/v1/system/jobs                  - List system jobs');
			console.log('  POST /api/v1/system/start                 - Start system (job)');
			console.log('  POST /api/v1/system/connect               - Connect chains (job)');
			console.log('');
			console.log('  -- Chains Layer (Discovery & Observation) --');
			console.log('  GET  /api/v1/chains                       - List chains');
			console.log('  GET  /api/v1/chains/:chainId/info         - Chain basic info');
			console.log('  GET  /api/v1/chains/:chainId/status       - Node status');
			console.log('  GET  /api/v1/chains/:chainId/mempool      - Mempool info');
			console.log('  GET  /api/v1/chains/:chainId/blocktime    - Blocktime stats');
			console.log('  GET  /api/v1/chains/:chainId/blocks/latest - Latest block');
			console.log('  GET  /api/v1/chains/:chainId/blocks/:height - Block by height');
			console.log('  GET  /api/v1/chains/:chainId/tx/:txhash   - Tx info');
			console.log('  GET  /api/v1/chains/:chainId/accounts/:addr - Account info');
			console.log('  POST /api/v1/chains/:chainId/simulate     - Simulate Tx');
			console.log('  POST /api/v1/chains/:chainId/broadcast    - Broadcast Tx');
			console.log('');
			console.log('  -- Utils Layer (Experiments & Load) --');
			console.log('  GET  /api/v1/utils/jobs                   - List utility jobs');
			console.log('  POST /api/v1/utils/metrics/resource-snapshot - Take snapshot');
			console.log('  POST /api/v1/utils/metrics/throughput     - Measure throughput');
			console.log('  POST /api/v1/utils/load/broadcast-batch   - Broadcast batch');
			console.log('');


		}
	);
}

// 実行
main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
