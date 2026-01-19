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
export declare function loadEnvConfig(): EnvConfig;
/**
 * 設定を取得（初回呼び出し時に初期化）
 */
export declare function getConfig(): EnvConfig;
/**
 * 設定を再初期化（テスト用）
 */
export declare function resetConfig(): void;
//# sourceMappingURL=env.d.ts.map