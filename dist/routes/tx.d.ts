/**
 * Tx ルート - simulate / broadcast / tx確認
 */
import { Hono } from 'hono';
import type { CryptomeriaManager } from '../managers/cryptomeria-manager.js';
import type { EnvConfig } from '../config/env.js';
/**
 * Txルートを作成
 */
export declare function createTxRoutes(cryptomeriaManager: CryptomeriaManager, config: EnvConfig): Hono;
//# sourceMappingURL=tx.d.ts.map