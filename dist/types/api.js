/**
 * API リクエスト/レスポンス型定義
 */
import { z } from 'zod';
/**
 * Simulate リクエスト
 */
export const SimulateRequestSchema = z.object({
    txBytesBase64: z.string().min(1, 'txBytesBase64 is required'),
});
/**
 * Broadcast リクエスト
 */
export const BroadcastRequestSchema = z.object({
    txBytesBase64: z.string().min(1, 'txBytesBase64 is required'),
    mode: z.enum(['sync', 'async', 'commit']).optional().default('sync'),
});
/**
 * chainIdパスパラメータ検証
 */
export const ChainIdParamSchema = z.object({
    chainId: z.string().min(1).regex(/^(gwc|mdsc|fdsc-\d+)$/, 'Invalid chainId format'),
});
/**
 * addressパスパラメータ検証
 */
export const AddressParamSchema = z.object({
    address: z.string().min(1, 'address is required'),
});
/**
 * txhashパスパラメータ検証
 */
export const TxHashParamSchema = z.object({
    txhash: z.string().min(1, 'txhash is required'),
});
/**
 * heightパスパラメータ検証
 */
export const HeightParamSchema = z.object({
    height: z.string().regex(/^\d+$/, 'height must be a positive integer'),
});
//# sourceMappingURL=api.js.map