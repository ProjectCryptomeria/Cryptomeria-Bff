/**
 * エラー型定義
 */
/**
 * エラーコードとHTTPステータスのマッピング
 */
export const ERROR_STATUS_MAP = {
    INVALID_INPUT: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    PAYLOAD_TOO_LARGE: 413,
    BAD_GATEWAY: 502,
    GATEWAY_TIMEOUT: 504,
    INTERNAL_ERROR: 500,
};
/**
 * APIエラークラス
 */
export class ApiError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.statusCode = ERROR_STATUS_MAP[code];
        this.details = details;
    }
    /**
     * エラーレスポンス形式に変換
     */
    toResponse() {
        const response = {
            error: {
                code: this.code,
                message: this.message,
            },
        };
        if (this.details) {
            response.error.details = this.details;
        }
        return response;
    }
}
/**
 * 認証エラー
 */
export function unauthorizedError(message = 'Missing or invalid bearer token') {
    return new ApiError('UNAUTHORIZED', message);
}
/**
 * 入力不正エラー
 */
export function invalidInputError(message, details) {
    return new ApiError('INVALID_INPUT', message, details);
}
/**
 * 未発見エラー
 */
export function notFoundError(message, details) {
    return new ApiError('NOT_FOUND', message, details);
}
/**
 * ペイロード超過エラー
 */
export function payloadTooLargeError(message, details) {
    return new ApiError('PAYLOAD_TOO_LARGE', message, details);
}
/**
 * バッドゲートウェイエラー
 */
export function badGatewayError(message, details) {
    return new ApiError('BAD_GATEWAY', message, details);
}
/**
 * タイムアウトエラー
 */
export function gatewayTimeoutError(message, details) {
    return new ApiError('GATEWAY_TIMEOUT', message, details);
}
/**
 * 内部エラー
 */
export function internalError(message = 'Internal server error') {
    return new ApiError('INTERNAL_ERROR', message);
}
//# sourceMappingURL=errors.js.map