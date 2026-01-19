/**
 * Observe ルート - 観測系API（mempool, status, blocks）
 */
import { Hono } from 'hono';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
/**
 * Observeルートを作成
 */
export declare function createObserveRoutes(cryptomeriaManager: CryptomeriaManager): Hono;
//# sourceMappingURL=observe.d.ts.map