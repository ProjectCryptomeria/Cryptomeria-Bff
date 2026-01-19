/**
 * 環境変数設定
 * BFFサーバーの設定値を環境変数から読み込む
 */
/**
 * 環境変数を読み込んで設定オブジェクトを返す
 * 必須の環境変数が不足している場合はエラーをスロー
 */
export function loadEnvConfig() {
    const apiToken = process.env.API_TOKEN;
    const nodeHost = process.env.NODE_HOST;
    const errors = [];
    if (!apiToken) {
        errors.push('API_TOKEN is required');
    }
    if (!nodeHost) {
        errors.push('NODE_HOST is required');
    }
    if (errors.length > 0) {
        throw new Error(`Environment configuration error:\n  - ${errors.join('\n  - ')}`);
    }
    return {
        apiToken: apiToken,
        k8sNamespace: process.env.K8S_NAMESPACE ?? 'cryptomeria',
        nodeHost: nodeHost,
        downstreamTimeoutMs: parseInt(process.env.DOWNSTREAM_TIMEOUT_MS ?? '10000', 10),
        maxTxBase64Chars: parseInt(process.env.MAX_TX_BASE64_CHARS ?? '5000000', 10),
        endpointCacheTtlMs: parseInt(process.env.ENDPOINT_CACHE_TTL_MS ?? '10000', 10),
        autoDetectNodeHost: process.env.AUTO_DETECT_NODE_HOST === 'true',
        port: parseInt(process.env.PORT ?? '3000', 10),
    };
}
/** グローバル設定インスタンス（遅延初期化） */
let _config = null;
/**
 * 設定を取得（初回呼び出し時に初期化）
 */
export function getConfig() {
    if (!_config) {
        _config = loadEnvConfig();
    }
    return _config;
}
/**
 * 設定を再初期化（テスト用）
 */
export function resetConfig() {
    _config = null;
}
//# sourceMappingURL=env.js.map