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
	/** 認証を無効化（開発・ローカル専用） */
	authDisabled: boolean;
	/** Bearer token認証用トークン（AUTH_DISABLED=true の場合は空文字でも可） */
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
	// ===== Job System Settings =====
	/** System層の同時実行ジョブ数上限（排他=1） */
	maxRunningSystemJobs: number;
	/** Utils層の同時実行ジョブ数上限 */
	maxRunningUtilsJobs: number;
	/** バッチ処理の同時実行数上限 */
	maxConcurrency: number;
	/** バッチサイズ上限 */
	maxBatchSize: number;
	/** ジョブログの最大バイト数（5MB） */
	jobLogMaxBytes: number;
	// ===== Blocktime Cache Settings =====
	/** blocktimeキャッシュTTL（ms） */
	blocktimeCacheTtlMs: number;
	/** blocktimeウィンドウ最大値 */
	blocktimeMaxWindow: number;
}

/**
 * 環境変数を読み込んで設定オブジェクトを返す
 * 必須の環境変数が不足している場合はエラーをスロー
 */
export function loadEnvConfig(): EnvConfig {
	const authDisabled = process.env.AUTH_DISABLED === 'true';
	const apiToken = process.env.API_TOKEN;
	const nodeHost = process.env.NODE_HOST;

	const errors: string[] = [];

	if (!authDisabled && !apiToken) {
		errors.push('API_TOKEN is required (set AUTH_DISABLED=true to disable auth)');
	}
	if (!nodeHost) {
		errors.push('NODE_HOST is required');
	}

	if (errors.length > 0) {
		throw new Error(`Environment configuration error:\n  - ${errors.join('\n  - ')}`);
	}

	return {
		authDisabled,
		apiToken: apiToken ?? '',
		k8sNamespace: process.env.K8S_NAMESPACE ?? 'cryptomeria',
		nodeHost: nodeHost!,
		downstreamTimeoutMs: parseInt(process.env.DOWNSTREAM_TIMEOUT_MS ?? '10000', 10),
		maxTxBase64Chars: parseInt(process.env.MAX_TX_BASE64_CHARS ?? '5000000', 10),
		endpointCacheTtlMs: parseInt(process.env.ENDPOINT_CACHE_TTL_MS ?? '10000', 10),
		autoDetectNodeHost: process.env.AUTO_DETECT_NODE_HOST === 'true',
		port: parseInt(process.env.PORT ?? '3000', 10),
		// Job System Settings
		maxRunningSystemJobs: parseInt(process.env.MAX_RUNNING_SYSTEM_JOBS ?? '1', 10),
		maxRunningUtilsJobs: parseInt(process.env.MAX_RUNNING_UTILS_JOBS ?? '10', 10),
		maxConcurrency: parseInt(process.env.MAX_CONCURRENCY ?? '20', 10),
		maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE ?? '1000', 10),
		jobLogMaxBytes: parseInt(process.env.JOB_LOG_MAX_BYTES ?? '5242880', 10), // 5MB
		// Blocktime Cache Settings
		blocktimeCacheTtlMs: parseInt(process.env.BLOCKTIME_CACHE_TTL_MS ?? '10000', 10),
		blocktimeMaxWindow: parseInt(process.env.BLOCKTIME_MAX_WINDOW ?? '2000', 10),
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
