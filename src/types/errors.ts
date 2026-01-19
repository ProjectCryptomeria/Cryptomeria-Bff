/**
 * エラー型定義
 */

/**
 * エラーコード
 */
export type ErrorCode =
	| 'INVALID_INPUT'
	| 'UNAUTHORIZED'
	| 'NOT_FOUND'
	| 'PAYLOAD_TOO_LARGE'
	| 'BAD_GATEWAY'
	| 'GATEWAY_TIMEOUT'
	| 'INTERNAL_ERROR';

/**
 * エラーコードとHTTPステータスのマッピング
 */
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
	INVALID_INPUT: 400,
	UNAUTHORIZED: 401,
	NOT_FOUND: 404,
	PAYLOAD_TOO_LARGE: 413,
	BAD_GATEWAY: 502,
	GATEWAY_TIMEOUT: 504,
	INTERNAL_ERROR: 500,
};

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
export class ApiError extends Error {
	readonly code: ErrorCode;
	readonly statusCode: number;
	readonly details?: Record<string, unknown>;

	constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
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
		if (this.details) {
			response.error.details = this.details;
		}
		return response;
	}
}

/**
 * 認証エラー
 */
export function unauthorizedError(message = 'Missing or invalid bearer token'): ApiError {
	return new ApiError('UNAUTHORIZED', message);
}

/**
 * 入力不正エラー
 */
export function invalidInputError(message: string, details?: Record<string, unknown>): ApiError {
	return new ApiError('INVALID_INPUT', message, details);
}

/**
 * 未発見エラー
 */
export function notFoundError(message: string, details?: Record<string, unknown>): ApiError {
	return new ApiError('NOT_FOUND', message, details);
}

/**
 * ペイロード超過エラー
 */
export function payloadTooLargeError(message: string, details?: Record<string, unknown>): ApiError {
	return new ApiError('PAYLOAD_TOO_LARGE', message, details);
}

/**
 * バッドゲートウェイエラー
 */
export function badGatewayError(message: string, details?: Record<string, unknown>): ApiError {
	return new ApiError('BAD_GATEWAY', message, details);
}

/**
 * タイムアウトエラー
 */
export function gatewayTimeoutError(message: string, details?: Record<string, unknown>): ApiError {
	return new ApiError('GATEWAY_TIMEOUT', message, details);
}

/**
 * 内部エラー
 */
export function internalError(message = 'Internal server error'): ApiError {
	return new ApiError('INTERNAL_ERROR', message);
}
