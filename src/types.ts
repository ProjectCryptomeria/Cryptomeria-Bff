import { z } from 'zod';

// --- WebUIと共通のEnum定義 ---
export enum AllocatorStrategy {
	ROUND_ROBIN = 'RoundRobin',
	AVAILABLE = 'Available',
	RANDOM = 'Random',
	STATIC = 'Static',
}

export enum TransmitterStrategy {
	ONE_BY_ONE = 'OneByOne',
	MULTI_BURST = 'MultiBurst',
	PARALLEL = 'Parallel',
}

// --- Zod Schemas (WebUIから移植・適合) ---
export const AllocatorStrategySchema = z.nativeEnum(AllocatorStrategy);
export const TransmitterStrategySchema = z.nativeEnum(TransmitterStrategy);

// 個別のシナリオ設定スキーマ
export const RunScenarioSchema = z.object({
	id: z.number(),
	uniqueId: z.string(),
	userId: z.string(),
	dataSize: z.number(),
	chunkSize: z.number(),
	allocator: AllocatorStrategySchema,
	transmitter: TransmitterStrategySchema,
	chains: z.number(),
	targetChains: z.array(z.string()),
	cost: z.number(),
	status: z.enum(['PENDING', 'CALCULATING', 'READY', 'RUNNING', 'COMPLETE', 'FAIL']),
}).passthrough();

// POST /api/experiment/run のリクエストボディ
export const RunExperimentRequestSchema = z.object({
	scenarios: z.array(RunScenarioSchema).min(1, 'No scenarios provided'),
});

// 型推論用
export type RunExperimentRequest = z.infer<typeof RunExperimentRequestSchema>;
export type RunScenario = z.infer<typeof RunScenarioSchema>;