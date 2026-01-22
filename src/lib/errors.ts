/**
 * 統一エラー形式とエラーファクトリ関数
 * 
 * API仕様書に準拠したエラーレスポンス形式を提供
 */

/**
 * APIエラーコード（仕様書準拠）
 */
export type ErrorCode =
    // 共通
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'INTERNAL'
    // System層
    | 'K8S_UNAVAILABLE'
    | 'TIMEOUT'
    // Blockchain層
    | 'UPSTREAM_UNAVAILABLE'
    | 'UPSTREAM_ERROR'
    // Utilities層
    | 'RATE_LIMITED';

/**
 * エラー詳細
 */
export interface ErrorDetails {
    [key: string]: unknown;
}

/**
 * エラーレスポンス形式（仕様書準拠）
 */
export interface ErrorResponse {
    error: {
        code: ErrorCode;
        message: string;
        details?: ErrorDetails;
    };
}

/**
 * HTTP ステータスコードとエラーコードのマッピング
 */
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
    INVALID_ARGUMENT: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    INTERNAL: 500,
    UPSTREAM_ERROR: 502,
    K8S_UNAVAILABLE: 503,
    UPSTREAM_UNAVAILABLE: 503,
    TIMEOUT: 504,
};

/**
 * APIエラークラス
 */
export class ApiError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly details?: ErrorDetails;

    constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.statusCode = ERROR_STATUS_MAP[code];
        this.details = details;
    }

    /**
     * エラーレスポンス形式に変換
     */
    toResponse(): ErrorResponse {
        const response: ErrorResponse = {
            error: {
                code: this.code,
                message: this.message,
            },
        };
        if (this.details && Object.keys(this.details).length > 0) {
            response.error.details = this.details;
        }
        return response;
    }
}

// ============================================================
// エラーファクトリ関数
// ============================================================

/** 400 INVALID_ARGUMENT */
export function invalidArgumentError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('INVALID_ARGUMENT', message, details);
}

/** 404 NOT_FOUND */
export function notFoundError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('NOT_FOUND', message, details);
}

/** 409 CONFLICT */
export function conflictError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('CONFLICT', message, details);
}

/** 429 RATE_LIMITED */
export function rateLimitedError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('RATE_LIMITED', message, details);
}

/** 500 INTERNAL */
export function internalError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('INTERNAL', message, details);
}

/** 502 UPSTREAM_ERROR */
export function upstreamError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('UPSTREAM_ERROR', message, details);
}

/** 503 K8S_UNAVAILABLE */
export function k8sUnavailableError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('K8S_UNAVAILABLE', message, details);
}

/** 503 UPSTREAM_UNAVAILABLE */
export function upstreamUnavailableError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('UPSTREAM_UNAVAILABLE', message, details);
}

/** 504 TIMEOUT */
export function timeoutError(message: string, details?: ErrorDetails): ApiError {
    return new ApiError('TIMEOUT', message, details);
}
