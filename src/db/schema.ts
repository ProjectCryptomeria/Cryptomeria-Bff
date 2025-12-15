import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// 実験ジョブ全体の管理
export const experiments = sqliteTable('experiments', {
	id: text('id').primaryKey(), // UUID
	status: text('status').notNull().default('PENDING'), // PENDING, RUNNING, COMPLETED, FAILED
	config: text('config').notNull(), // JSON string of RunExperimentRequest
	createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// 個別のシナリオ実行結果
export const results = sqliteTable('results', {
	id: text('id').primaryKey(),
	experimentId: text('experiment_id').notNull().references(() => experiments.id),
	scenarioId: text('scenario_id').notNull(), // WebUI側のユニークID

	// 計測データ
	status: text('status').notNull(), // SUCCESS, FAILED
	dataSizeMB: real('data_size_mb').notNull(),
	uploadTimeMs: integer('upload_time_ms'),
	throughputBps: real('throughput_bps'),

	// ログ (JSON配列)
	logs: text('logs').default('[]'),

	executedAt: text('executed_at').default(sql`CURRENT_TIMESTAMP`),
});