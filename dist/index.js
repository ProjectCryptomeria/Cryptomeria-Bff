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
async function main() {
    console.log('Cryptomeria BFF Server starting...');
    // 環境変数読み込み
    let config;
    try {
        config = loadEnvConfig();
    }
    catch (error) {
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
    serve({
        fetch: app.fetch,
        port: config.port,
    }, (info) => {
        console.log(`Server is running on http://localhost:${info.port}`);
        console.log('');
        console.log('Available endpoints:');
        console.log('  GET  /health                              - Health check');
        console.log('  GET  /api/v1/chains                       - List chains');
        console.log('  GET  /api/v1/chains/:chainId/info         - Get chain info');
        console.log('  GET  /api/v1/chains/:chainId/accounts/:address - Get account info');
        console.log('  POST /api/v1/chains/:chainId/simulate     - Simulate tx');
        console.log('  POST /api/v1/chains/:chainId/broadcast    - Broadcast tx');
        console.log('  GET  /api/v1/chains/:chainId/tx/:txhash   - Get tx info');
        console.log('  GET  /api/v1/chains/:chainId/mempool      - Get mempool info');
        console.log('  GET  /api/v1/chains/:chainId/status       - Get node status');
        console.log('  GET  /api/v1/chains/:chainId/blocks/latest - Get latest block');
        console.log('  GET  /api/v1/chains/:chainId/blocks/:height - Get block by height');
        console.log('');
        console.log('Authentication: Authorization: Bearer <API_TOKEN>');
    });
}
// 実行
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map