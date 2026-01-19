import * as dotenv from 'dotenv';

/**
 * .envファイルから環境変数を読み込む
 * アプリケーションの起動時に即座に適用される
 */
dotenv.config();

/**
 * 環境変数設定
 * BFFサーバーの設定値を環境変数から読み込む
 */
export interface EnvConfig {
	/** Bearer token認証用トークン */
	apiToken: string;
	/** Kubernetes namespace */
	k8sNamespace: string;
	/** NodePortへ到達するホスト/IP */
	nodeHost: string;
	/** 下流呼び出しタイムアウト（ms） */
	downstreamTimeoutMs: number;
	/** txBytesBase64の最大文字数 */
	maxTxBase64Chars: number;
	/** endpoint解決キャッシュTTL（ms） */
	endpointCacheTtlMs: number;
	/** NodeHost自動推定を有効化 */
	autoDetectNodeHost: boolean;
	/** サーバーポート */
	port: number;
}

/**
 * 環境変数を読み込んで設定オブジェクトを返す
 * 必須の環境変数が不足している場合はエラーをスロー
 */
export function loadEnvConfig(): EnvConfig {
	// process.envから値を取得
	const apiToken = process.env.API_TOKEN;
	const nodeHost = process.env.NODE_HOST;

	const errors: string[] = [];

	// 必須項目のチェック
	if (!apiToken) {
		errors.push('API_TOKEN is required');
	}
	if (!nodeHost) {
		errors.push('NODE_HOST is required');
	}

	// エラーがある場合はまとめて通知
	if (errors.length > 0) {
		throw new Error(`Environment configuration error:\n  - ${errors.join('\n  - ')}`);
	}

	// 設定オブジェクトを生成して返す
	// ここに来る時点で必須項目はチェック済みのため、non-null assertion (!) を使用しても安全
	return {
		apiToken: apiToken!,
		k8sNamespace: process.env.K8S_NAMESPACE ?? 'cryptomeria',
		nodeHost: nodeHost!,
		downstreamTimeoutMs: parseInt(process.env.DOWNSTREAM_TIMEOUT_MS ?? '10000', 10),
		maxTxBase64Chars: parseInt(process.env.MAX_TX_BASE64_CHARS ?? '5000000', 10),
		endpointCacheTtlMs: parseInt(process.env.ENDPOINT_CACHE_TTL_MS ?? '10000', 10),
		autoDetectNodeHost: process.env.AUTO_DETECT_NODE_HOST === 'true',
		port: parseInt(process.env.PORT ?? '3000', 10),
	};
}

/** グローバル設定インスタンス（遅延初期化） */
let _config: EnvConfig | null = null;

/**
 * 設定を取得（初回呼び出し時に初期化）
 */
export function getConfig(): EnvConfig {
	if (!_config) {
		_config = loadEnvConfig();
	}
	return _config;
}

/**
 * 設定を再初期化（テスト用）
 */
export function resetConfig(): void {
	_config = null;
}