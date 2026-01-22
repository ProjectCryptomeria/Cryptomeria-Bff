/**
 * 時刻ユーティリティ
 * 
 * ISO 8601 UTC形式の時刻処理を提供
 */

/**
 * 現在時刻をISO 8601 UTC形式で取得
 */
export function nowISO(): string {
    return new Date().toISOString();
}

/**
 * DateオブジェクトをISO 8601 UTC形式に変換
 */
export function toISO(date: Date): string {
    return date.toISOString();
}

/**
 * ISO 8601文字列をDateオブジェクトに変換
 */
export function fromISO(isoString: string): Date {
    return new Date(isoString);
}

/**
 * 2つの時刻の差分を秒で計算
 */
export function durationSeconds(start: Date | string, end: Date | string): number {
    const startDate = typeof start === 'string' ? fromISO(start) : start;
    const endDate = typeof end === 'string' ? fromISO(end) : end;
    return (endDate.getTime() - startDate.getTime()) / 1000;
}

/**
 * 2つの時刻の差分をミリ秒で計算
 */
export function durationMs(start: Date | string, end: Date | string): number {
    const startDate = typeof start === 'string' ? fromISO(start) : start;
    const endDate = typeof end === 'string' ? fromISO(end) : end;
    return endDate.getTime() - startDate.getTime();
}

/**
 * ミリ秒を秒に変換（小数点以下3桁）
 */
export function msToSeconds(ms: number): number {
    return Math.round(ms) / 1000;
}

/**
 * 指定ミリ秒後の時刻を取得
 */
export function addMs(date: Date | string, ms: number): Date {
    const baseDate = typeof date === 'string' ? fromISO(date) : date;
    return new Date(baseDate.getTime() + ms);
}

/**
 * タイムアウト判定（現在時刻が期限を過ぎているか）
 */
export function isExpired(deadline: Date | string): boolean {
    const deadlineDate = typeof deadline === 'string' ? fromISO(deadline) : deadline;
    return Date.now() > deadlineDate.getTime();
}
