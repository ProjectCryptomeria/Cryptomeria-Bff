/**
 * エラー型定義
 */
/**
 * エラーコード
 */
export type ErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'PAYLOAD_TOO_LARGE' | 'BAD_GATEWAY' | 'GATEWAY_TIMEOUT' | 'INTERNAL_ERROR';
/**
 * エラーコードとHTTPステータスのマッピング
 */
export declare const ERROR_STATUS_MAP: Record<ErrorCode, number>;
/**
 * APIエラーレスポンス形式
 */
export interface ErrorResponse {
    error: {
        code: ErrorCode;
        message: string;
        details?: Record<string, unknown>;
    };
}
/**
 * APIエラークラス
 */
export declare class ApiError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
    constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
    /**
     * エラーレスポンス形式に変換
     */
    toResponse(): ErrorResponse;
}
/**
 * 認証エラー
 */
export declare function unauthorizedError(message?: string): ApiError;
/**
 * 入力不正エラー
 */
export declare function invalidInputError(message: string, details?: Record<string, unknown>): ApiError;
/**
 * 未発見エラー
 */
export declare function notFoundError(message: string, details?: Record<string, unknown>): ApiError;
/**
 * ペイロード超過エラー
 */
export declare function payloadTooLargeError(message: string, details?: Record<string, unknown>): ApiError;
/**
 * バッドゲートウェイエラー
 */
export declare function badGatewayError(message: string, details?: Record<string, unknown>): ApiError;
/**
 * タイムアウトエラー
 */
export declare function gatewayTimeoutError(message: string, details?: Record<string, unknown>): ApiError;
/**
 * 内部エラー
 */
export declare function internalError(message?: string): ApiError;
//# sourceMappingURL=errors.d.ts.map