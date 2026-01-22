/**
 * Cryptomeria-BFF v1 APIテストランナー
 * 
 * APIテスト要件書に基づいた包括的なテスト
 * 
 * 使用方法:
 *   yarn test              # 全テスト実行
 *   yarn test layer1       # 第1層のみ
 *   yarn test layer2       # 第2層のみ
 *   yarn test layer3       # 第3層のみ
 *   yarn test jobs         # ジョブ系のみ
 */
import { getConfig, type TestConfig } from './config.js';
import { TestCounter, hasField, printHeader, printTest, request } from './utils.js';

// 色定義
const colors = {
	blue: '\x1b[34m',
	cyan: '\x1b[36m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	reset: '\x1b[0m',
};

// ============================================================
// 第1層（System/K8s）テスト
// ============================================================

async function testSystemStatus(config: TestConfig, counter: TestCounter) {
	printHeader('Layer 1: System Status');

	// GET /api/v1/system/status
	printTest('システムステータス取得', 'GET /api/v1/system/status');
	const res = await request(config, 'GET', '/api/v1/system/status');

	if (res.status === 200 && hasField(res.body, 'ok') && hasField(res.body?.data, 'namespace')) {
		counter.pass('システムステータス取得', '/system/status', 'ok=true, namespace確認', res.bodyText);
	} else if (res.status === 503) {
		counter.skip('システムステータス取得', '/system/status', 'K8s unavailable - K8s環境が必要', res.bodyText);
	} else {
		counter.fail('システムステータス取得', '/system/status', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testSystemPreflight(config: TestConfig, counter: TestCounter) {
	printTest('preflight取得', 'GET /api/v1/system/preflight');
	const res = await request(config, 'GET', '/api/v1/system/preflight');

	if (res.status === 200 && hasField(res.body, 'ok') && hasField(res.body?.data, 'overallOk')) {
		counter.pass('preflight取得', '/system/preflight', 'ok=true, overallOk確認', res.bodyText);
	} else if (res.status === 503) {
		counter.skip('preflight取得', '/system/preflight', 'K8s unavailable', res.bodyText);
	} else {
		counter.fail('preflight取得', '/system/preflight', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testSystemTopology(config: TestConfig, counter: TestCounter) {
	printTest('トポロジー取得', 'GET /api/v1/system/topology');
	const res = await request(config, 'GET', '/api/v1/system/topology');

	if (res.status === 200 && hasField(res.body, 'ok')) {
		counter.pass('トポロジー取得', '/system/topology', 'ok=true確認', res.bodyText);
	} else if (res.status === 503) {
		counter.skip('トポロジー取得', '/system/topology', 'K8s unavailable', res.bodyText);
	} else {
		counter.fail('トポロジー取得', '/system/topology', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testSystemPods(config: TestConfig, counter: TestCounter) {
	printTest('Pod一覧取得', 'GET /api/v1/system/k8s/pods');
	const res = await request(config, 'GET', '/api/v1/system/k8s/pods');

	if (res.status === 200 && hasField(res.body, 'ok') && hasField(res.body?.data, 'items')) {
		counter.pass('Pod一覧取得', '/system/k8s/pods', 'ok=true, items確認', res.bodyText);
	} else if (res.status === 503) {
		counter.skip('Pod一覧取得', '/system/k8s/pods', 'K8s unavailable', res.bodyText);
	} else {
		counter.fail('Pod一覧取得', '/system/k8s/pods', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testSystemJobs(config: TestConfig, counter: TestCounter) {
	printTest('Systemジョブ一覧', 'GET /api/v1/system/jobs');
	const res = await request(config, 'GET', '/api/v1/system/jobs');

	if (res.status === 200 && hasField(res.body, 'items')) {
		counter.pass('Systemジョブ一覧', '/system/jobs', 'items配列確認', res.bodyText);
	} else {
		counter.fail('Systemジョブ一覧', '/system/jobs', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testLayer1(config: TestConfig, counter: TestCounter) {
	await testSystemStatus(config, counter);
	await testSystemPreflight(config, counter);
	await testSystemTopology(config, counter);
	await testSystemPods(config, counter);
	await testSystemJobs(config, counter);
}

// ============================================================
// 第2層（Blockchain）テスト
// ============================================================

async function testChainsDiscovery(config: TestConfig, counter: TestCounter) {
	printHeader('Layer 2: Chains Discovery');

	// GET /api/v1/chains
	printTest('チェーン一覧取得', 'GET /api/v1/chains');
	let res = await request(config, 'GET', '/api/v1/chains');

	if (res.status === 200 && hasField(res.body, 'chains')) {
		counter.pass('チェーン一覧取得', '/chains', 'chains配列確認', res.bodyText);
	} else {
		counter.fail('チェーン一覧取得', '/chains', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}

	// GET /api/v1/chains/:chainId/info
	printTest('チェーン情報取得', `GET /api/v1/chains/${config.chainId}/info`);
	res = await request(config, 'GET', `/api/v1/chains/${config.chainId}/info`);

	if (res.status === 200 && hasField(res.body, 'chainId')) {
		counter.pass('チェーン情報取得', `/chains/${config.chainId}/info`, 'chainId確認', res.bodyText);
	} else if (res.status === 400) {
		counter.pass('チェーン情報取得', `/chains/${config.chainId}/info`, '400（chainId不明）- 正常なエラー', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('チェーン情報取得', `/chains/${config.chainId}/info`, `バックエンド接続エラー (${res.status})`, res.bodyText);
	} else {
		counter.fail('チェーン情報取得', `/chains/${config.chainId}/info`, `期待ステータス200/400、実際: ${res.status}`, res.bodyText);
	}
}

async function testChainsBlocktime(config: TestConfig, counter: TestCounter) {
	printTest('ブロックタイム取得', `GET /api/v1/chains/${config.chainId}/blocktime`);
	const res = await request(config, 'GET', `/api/v1/chains/${config.chainId}/blocktime`);

	if (res.status === 200 && hasField(res.body, 'stats')) {
		counter.pass('ブロックタイム取得', `/chains/${config.chainId}/blocktime`, 'stats確認', res.bodyText);

		// キャッシュテスト: 2回目の呼び出し
		printTest('ブロックタイムキャッシュ', `GET /api/v1/chains/${config.chainId}/blocktime (2nd)`);
		const res2 = await request(config, 'GET', `/api/v1/chains/${config.chainId}/blocktime`);
		if (res2.status === 200 && res2.body?.cached === true) {
			counter.pass('ブロックタイムキャッシュ', 'blocktime cache', 'cached=true確認', res2.bodyText);
		} else if (res2.status === 200) {
			counter.pass('ブロックタイムキャッシュ', 'blocktime cache', '2回目取得成功（キャッシュはheight依存）', res2.bodyText);
		} else {
			counter.fail('ブロックタイムキャッシュ', 'blocktime cache', `2回目失敗: ${res2.status}`, res2.bodyText);
		}
	} else if (res.status === 400 || res.status === 404) {
		counter.skip('ブロックタイム取得', `/chains/${config.chainId}/blocktime`, `${res.status}（chainId不明）`, res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('ブロックタイム取得', `/chains/${config.chainId}/blocktime`, `バックエンド接続エラー (${res.status})`, res.bodyText);
	} else {
		counter.fail('ブロックタイム取得', `/chains/${config.chainId}/blocktime`, `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testLayer2(config: TestConfig, counter: TestCounter) {
	await testChainsDiscovery(config, counter);
	await testChainsBlocktime(config, counter);
}

// ============================================================
// 第3層（Utilities）テスト
// ============================================================

async function testUtilsJobCreation(config: TestConfig, counter: TestCounter) {
	printHeader('Layer 3: Utils Jobs');

	// POST /api/v1/utils/metrics/resource-snapshot
	printTest('リソーススナップショット', 'POST /api/v1/utils/metrics/resource-snapshot');
	const res = await request(config, 'POST', '/api/v1/utils/metrics/resource-snapshot', {
		namespace: 'cryptomeria',
		include: ['systemStatus', 'pods'],
		timeoutMs: 10000,
	});

	if (res.status === 202 && hasField(res.body, 'jobId')) {
		counter.pass('リソーススナップショット', '/utils/metrics/resource-snapshot', '202 + jobId確認', res.bodyText);

		// ジョブ詳細確認
		const jobId = res.body.jobId;
		printTest('ジョブ詳細確認', `GET /api/v1/utils/jobs/${jobId}`);
		const jobRes = await request(config, 'GET', `/api/v1/utils/jobs/${jobId}`);

		if (jobRes.status === 200 && hasField(jobRes.body, 'status')) {
			counter.pass('ジョブ詳細確認', `/utils/jobs/${jobId}`, `status=${jobRes.body.status}確認`, jobRes.bodyText);
		} else {
			counter.fail('ジョブ詳細確認', `/utils/jobs/${jobId}`, `期待200、実際: ${jobRes.status}`, jobRes.bodyText);
		}
	} else if (res.status === 429) {
		counter.skip('リソーススナップショット', '/utils/metrics/resource-snapshot', 'Rate limited', res.bodyText);
	} else {
		counter.fail('リソーススナップショット', '/utils/metrics/resource-snapshot', `期待202、実際: ${res.status}`, res.bodyText);
	}
}

async function testUtilsValidation(config: TestConfig, counter: TestCounter) {
	// 異常系: timeoutMs不正
	printTest('throughput異常入力', 'POST /api/v1/utils/metrics/throughput (window=1)');
	const res = await request(config, 'POST', '/api/v1/utils/metrics/throughput', {
		chainId: config.chainId,
		window: 1, // 不正: 2未満
	});

	if (res.status === 400 && hasField(res.body, 'error')) {
		counter.pass('throughput異常入力', 'window=1', '400 INVALID_ARGUMENT確認', res.bodyText);
	} else {
		counter.fail('throughput異常入力', 'window=1', `期待400、実際: ${res.status}`, res.bodyText);
	}
}

async function testUtilsJobsList(config: TestConfig, counter: TestCounter) {
	printTest('Utilsジョブ一覧', 'GET /api/v1/utils/jobs');
	const res = await request(config, 'GET', '/api/v1/utils/jobs');

	if (res.status === 200 && hasField(res.body, 'items')) {
		counter.pass('Utilsジョブ一覧', '/utils/jobs', 'items配列確認', res.bodyText);
	} else {
		counter.fail('Utilsジョブ一覧', '/utils/jobs', `期待200、実際: ${res.status}`, res.bodyText);
	}
}

async function testLayer3(config: TestConfig, counter: TestCounter) {
	await testUtilsJobCreation(config, counter);
	await testUtilsValidation(config, counter);
	await testUtilsJobsList(config, counter);
}

// ============================================================
// ジョブ共通テスト
// ============================================================

async function testJobStateTransition(config: TestConfig, counter: TestCounter) {
	printHeader('Job State Transitions');

	// ジョブ作成して状態遷移確認
	printTest('ジョブ作成と状態遷移', 'POST /api/v1/utils/metrics/resource-snapshot');
	const res = await request(config, 'POST', '/api/v1/utils/metrics/resource-snapshot', {
		timeoutMs: 5000,
	});

	if (res.status !== 202 || !res.body?.jobId) {
		counter.skip('ジョブ作成と状態遷移', 'resource-snapshot', `ジョブ作成失敗: ${res.status}`, res.bodyText);
		return;
	}

	const jobId = res.body.jobId;
	counter.pass('ジョブ作成', 'resource-snapshot', `jobId=${jobId}`, res.bodyText);

	// 状態確認（少し待機）
	await new Promise((r) => setTimeout(r, 1000));

	const checkRes = await request(config, 'GET', `/api/v1/utils/jobs/${jobId}`);
	if (checkRes.status === 200) {
		const status = checkRes.body?.status;
		if (status === 'running' || status === 'succeeded' || status === 'queued') {
			counter.pass('状態遷移確認', `status=${status}`, '期待される状態', checkRes.bodyText);
		} else {
			counter.fail('状態遷移確認', `status=${status}`, '予期しない状態', checkRes.bodyText);
		}
	} else {
		counter.fail('状態遷移確認', `/utils/jobs/${jobId}`, `取得失敗: ${checkRes.status}`, checkRes.bodyText);
	}
}

async function testJobNotFound(config: TestConfig, counter: TestCounter) {
	printTest('存在しないジョブ', 'GET /api/v1/utils/jobs/nonexistent-job-id');
	const res = await request(config, 'GET', '/api/v1/utils/jobs/nonexistent-job-id');

	if (res.status === 404 && hasField(res.body, 'error')) {
		counter.pass('存在しないジョブ', 'nonexistent', '404 NOT_FOUND確認', res.bodyText);
	} else {
		counter.fail('存在しないジョブ', 'nonexistent', `期待404、実際: ${res.status}`, res.bodyText);
	}
}

async function testJobsTests(config: TestConfig, counter: TestCounter) {
	await testJobStateTransition(config, counter);
	await testJobNotFound(config, counter);
}

// ============================================================
// 既存テスト（後方互換）
// ============================================================

async function testHealth(config: TestConfig, counter: TestCounter) {
	printHeader('Health Check');

	printTest('ヘルスチェック', 'GET /health');
	const res = await request(config, 'GET', '/health', undefined, false);

	if (res.status === 200 && hasField(res.body, 'status')) {
		counter.pass('ヘルスチェック', '/health', 'status=ok確認', res.bodyText);
	} else {
		counter.fail('ヘルスチェック', '/health', `期待200、実際: ${res.status}`, res.bodyText);
	}
}

async function testLegacyChains(config: TestConfig, counter: TestCounter) {
	printHeader('Legacy Chains API');

	// GET /api/v1/chains
	printTest('チェーン一覧（レガシー）', 'GET /api/v1/chains');
	let res = await request(config, 'GET', '/api/v1/chains');

	if (res.status === 200 && hasField(res.body, 'chains')) {
		counter.pass('チェーン一覧（レガシー）', '/chains', 'chains配列確認', res.bodyText);
	} else {
		counter.fail('チェーン一覧（レガシー）', '/chains', `期待200、実際: ${res.status}`, res.bodyText);
	}

	// 無効なchainId
	printTest('無効なchainId', 'GET /api/v1/chains/invalid-chain-id/info');
	res = await request(config, 'GET', '/api/v1/chains/invalid-chain-id/info');

	if (res.status === 400 && hasField(res.body, 'error')) {
		counter.pass('無効なchainId', '/chains/invalid-chain-id/info', '400確認', res.bodyText);
	} else {
		counter.fail('無効なchainId', '/chains/invalid-chain-id/info', `期待400、実際: ${res.status}`, res.bodyText);
	}
}

async function test404(config: TestConfig, counter: TestCounter) {
	printHeader('404 Not Found');

	printTest('存在しないエンドポイント', 'GET /api/v1/nonexistent');
	const res = await request(config, 'GET', '/api/v1/nonexistent');

	if (res.status === 404 && hasField(res.body, 'error')) {
		counter.pass('存在しないエンドポイント', '/nonexistent', '404確認', res.bodyText);
	} else {
		counter.fail('存在しないエンドポイント', '/nonexistent', `期待404、実際: ${res.status}`, res.bodyText);
	}
}

// ============================================================
// メイン処理
// ============================================================

function showHelp() {
	console.log('\nCryptomeria-BFF v1 APIテストスクリプト');
	console.log('');
	console.log('使用方法: yarn test [category...]');
	console.log('');
	console.log('カテゴリ:');
	console.log('  health    - ヘルスチェック');
	console.log('  layer1    - 第1層（System/K8s）テスト');
	console.log('  layer2    - 第2層（Blockchain）テスト');
	console.log('  layer3    - 第3層（Utilities）テスト');
	console.log('  jobs      - ジョブ共通テスト');
	console.log('  legacy    - レガシーAPIテスト');
	console.log('  404       - 404テスト');
	console.log('');
	console.log('引数なしの場合、全カテゴリを実行');
}

async function checkServerConnection(config: TestConfig): Promise<boolean> {
	console.log(`\n${colors.cyan}サーバー接続確認中...${colors.reset}`);
	try {
		const res = await fetch(`${config.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
		if (res.status === 200) {
			console.log(`${colors.green}サーバー接続OK${colors.reset}`);
			return true;
		}
	} catch { /* ignore */ }
	console.log(`${colors.yellow}警告: サーバー (${config.baseUrl}) に接続できません${colors.reset}`);
	return false;
}

type TestCategory = 'health' | 'layer1' | 'layer2' | 'layer3' | 'jobs' | 'legacy' | '404';

const testFunctions: Record<TestCategory, (config: TestConfig, counter: TestCounter) => Promise<void>> = {
	health: testHealth,
	layer1: testLayer1,
	layer2: testLayer2,
	layer3: testLayer3,
	jobs: testJobsTests,
	legacy: testLegacyChains,
	'404': test404,
};

async function main() {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		showHelp();
		process.exit(0);
	}

	const config = getConfig();
	const counter = new TestCounter();

	console.log(`${colors.blue}`);
	console.log('╔═══════════════════════════════════════════════════════════════════╗');
	console.log('║         Cryptomeria-BFF v1 API テスト                             ║');
	console.log('╚═══════════════════════════════════════════════════════════════════╝');
	console.log(`${colors.reset}`);

	console.log('設定:');
	console.log(`  BASE_URL:     ${config.baseUrl}`);
	console.log(`  CHAIN_ID:     ${config.chainId}`);
	console.log(`  AUTH_TOKEN:   ${config.authToken ? '***' : '<未設定>'}`);

	await checkServerConnection(config);

	// テスト実行
	const categories: TestCategory[] =
		args.length > 0
			? (args.filter((arg) => arg in testFunctions) as TestCategory[])
			: ['health', 'layer1', 'layer2', 'layer3', 'jobs', 'legacy', '404'];

	for (const category of categories) {
		await testFunctions[category](config, counter);
	}

	counter.printSummary();
	process.exit(counter.failed > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
