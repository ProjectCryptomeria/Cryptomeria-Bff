/**
 * HTTPレスポンスヘルパー
 * 
 * 仕様書に準拠したレスポンス形式を提供
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Job } from '../jobs/types.js';

/**
 * 成功レスポンス形式（System層用）
 */
export interface OkResponse<T> {
    ok: true;
    data: T;
}

/**
 * リストレスポンス形式（Blockchain/Utilities層用）
 */
export interface ItemsResponse<T> {
    items: T[];
}

/**
 * ジョブ作成レスポンス形式（202 Accepted）
 */
export interface JobCreatedResponse {
    jobId: string;
    scope: string;
    type: string;
    status: string;
    createdAt: string;
}

// ============================================================
// レスポンスヘルパー関数
// ============================================================

/**
 * System層用成功レスポンス: { ok: true, data: ... }
 */
export function okResponse<T>(c: Context, data: T): Response {
    return c.json({ ok: true, data } as OkResponse<T>, 200);
}

/**
 * リスト形式レスポンス: { items: [...] }
 */
export function itemsResponse<T>(c: Context, items: T[]): Response {
    return c.json({ items } as ItemsResponse<T>, 200);
}

/**
 * ジョブ作成レスポンス（202 Accepted）
 */
export function jobCreatedResponse(c: Context, job: Job): Response {
    const response: JobCreatedResponse = {
        jobId: job.jobId,
        scope: job.scope,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
    };
    return c.json(response, 202 as ContentfulStatusCode);
}

/**
 * テキストレスポンス（ログ取得用）
 */
export function textResponse(c: Context, text: string): Response {
    return c.text(text, 200);
}

/**
 * エラーレスポンス
 */
export function errorResponse(
    c: Context,
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
): Response {
    const body: { error: { code: string; message: string; details?: Record<string, unknown> } } = {
        error: { code, message },
    };
    if (details && Object.keys(details).length > 0) {
        body.error.details = details;
    }
    return c.json(body, statusCode as ContentfulStatusCode);
}
