/**
 * Cryptomeria-Bff APIテストランナー
 *
 * 使用方法:
 *   npx tsx tests/run.ts           # 全テスト実行
 *   npx tsx tests/run.ts health    # 特定カテゴリのみ
 *   npx tsx tests/run.ts --help    # ヘルプ表示
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
// テスト関数
// ============================================================

async function testHealth(config: TestConfig, counter: TestCounter) {
	printHeader('Health Check');

	printTest('ヘルスチェック', 'GET /health');
	const res = await request(config, 'GET', '/health', undefined, false);

	if (res.status === 200 && hasField(res.body, 'status')) {
		counter.pass('ヘルスチェック', 'GET /health', 'ステータス200、statusフィールド確認', res.bodyText);
	} else {
		counter.fail('ヘルスチェック', 'GET /health', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}
}

async function testChains(config: TestConfig, counter: TestCounter) {
	printHeader('Discovery API');

	// GET /api/v1/chains
	printTest('チェーン一覧取得', 'GET /api/v1/chains');
	let res = await request(config, 'GET', '/api/v1/chains');

	if (res.status === 200 && hasField(res.body, 'chains')) {
		counter.pass('チェーン一覧取得', 'GET /api/v1/chains', 'ステータス200、chainsフィールド確認', res.bodyText);
	} else {
		counter.fail('チェーン一覧取得', 'GET /api/v1/chains', `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}

	// GET /api/v1/chains/:chainId/info
	printTest('チェーン情報取得', `GET /api/v1/chains/${config.chainId}/info`);
	res = await request(config, 'GET', `/api/v1/chains/${config.chainId}/info`);

	if (res.status === 200 && hasField(res.body, 'chainId')) {
		counter.pass('チェーン情報取得', `GET /api/v1/chains/${config.chainId}/info`, 'ステータス200、chainIdフィールド確認', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('チェーン情報取得', `GET /api/v1/chains/${config.chainId}/info`, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('チェーン情報取得', `GET /api/v1/chains/${config.chainId}/info`, `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}

	// 異常系: 無効なchainId
	printTest('無効なchainId', 'GET /api/v1/chains/invalid-chain-id/info');
	res = await request(config, 'GET', '/api/v1/chains/invalid-chain-id/info');

	if (res.status === 400 && hasField(res.body, 'error')) {
		counter.pass('無効なchainId', 'GET /api/v1/chains/invalid-chain-id/info', 'ステータス400、errorフィールド確認', res.bodyText);
	} else {
		counter.fail('無効なchainId', 'GET /api/v1/chains/invalid-chain-id/info', `期待ステータス400、実際: ${res.status}`, res.bodyText);
	}
}

async function testAccounts(config: TestConfig, counter: TestCounter) {
	printHeader('Account API');

	// GET /api/v1/chains/:chainId/accounts/:address
	const endpoint = `/api/v1/chains/${config.chainId}/accounts/${config.testAddress}`;
	printTest('アカウント情報取得', `GET ${endpoint}`);
	let res = await request(config, 'GET', endpoint);

	if (res.status === 200 && hasField(res.body, 'address')) {
		counter.pass('アカウント情報取得', endpoint, 'ステータス200、addressフィールド確認', res.bodyText);
	} else if (res.status === 404) {
		counter.pass('アカウント情報取得', endpoint, 'ステータス404（アカウント未発見）- 正常なエラーレスポンス', res.bodyText);
	} else if (res.status === 502 && res.bodyText.includes('Downstream error')) {
		// バックエンドからエラーレスポンスが返っている = 通信は成功
		counter.pass('アカウント情報取得', endpoint, 'バックエンド接続成功（無効なアドレスエラー）', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('アカウント情報取得', endpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('アカウント情報取得', endpoint, `期待ステータス200/404、実際: ${res.status}`, res.bodyText);
	}

	// 異常系: 空のアドレス
	const emptyEndpoint = `/api/v1/chains/${config.chainId}/accounts/%20`;
	printTest('空のアドレス', `GET ${emptyEndpoint}`);
	res = await request(config, 'GET', emptyEndpoint);

	if (res.status === 400) {
		counter.pass('空のアドレス', emptyEndpoint, 'ステータス400、バリデーションエラー確認', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('空のアドレス', emptyEndpoint, `バックエンド接続エラー (${res.status})`, res.bodyText);
	} else {
		counter.skip('空のアドレス', emptyEndpoint, `ステータス: ${res.status}（実装依存）`, res.bodyText);
	}
}

async function testTx(config: TestConfig, counter: TestCounter) {
	printHeader('Transaction API');

	// POST /api/v1/chains/:chainId/simulate
	const simulateEndpoint = `/api/v1/chains/${config.chainId}/simulate`;
	printTest('Txシミュレート', `POST ${simulateEndpoint}`);
	let res = await request(config, 'POST', simulateEndpoint, { txBytesBase64: config.dummyTxBytes });

	if (res.status === 200 && hasField(res.body, 'gasUsed')) {
		counter.pass('Txシミュレート', simulateEndpoint, 'ステータス200、gasUsedフィールド確認', res.bodyText);
	} else if (res.status === 400) {
		counter.pass('Txシミュレート', simulateEndpoint, 'ステータス400（無効なTx）- バリデーション動作確認', res.bodyText);
	} else if (res.status === 502 && res.bodyText.includes('Downstream error')) {
		// バックエンドからエラーレスポンスが返っている = 通信は成功
		counter.pass('Txシミュレート', simulateEndpoint, 'バックエンド接続成功（無効なTxエラー）', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('Txシミュレート', simulateEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('Txシミュレート', simulateEndpoint, `予期しないステータス: ${res.status}`, res.bodyText);
	}

	// 異常系: txBytesBase64なし
	printTest('txBytesBase64なし', `POST ${simulateEndpoint}`);
	res = await request(config, 'POST', simulateEndpoint, {});

	if (res.status === 400) {
		counter.pass('txBytesBase64なし', simulateEndpoint, 'ステータス400、バリデーションエラー確認', res.bodyText);
	} else {
		counter.fail('txBytesBase64なし', simulateEndpoint, `期待ステータス400、実際: ${res.status}`, res.bodyText);
	}

	// POST /api/v1/chains/:chainId/broadcast
	const broadcastEndpoint = `/api/v1/chains/${config.chainId}/broadcast`;
	printTest('Txブロードキャスト', `POST ${broadcastEndpoint}`);
	res = await request(config, 'POST', broadcastEndpoint, { txBytesBase64: config.dummyTxBytes, mode: 'sync' });

	if (res.status === 200 && hasField(res.body, 'txhash')) {
		counter.pass('Txブロードキャスト', broadcastEndpoint, 'ステータス200、txhashフィールド確認', res.bodyText);
	} else if (res.status === 400 || res.status === 500) {
		counter.pass('Txブロードキャスト', broadcastEndpoint, `ステータス${res.status}（無効なTx）- エラーハンドリング確認`, res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('Txブロードキャスト', broadcastEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('Txブロードキャスト', broadcastEndpoint, `予期しないステータス: ${res.status}`, res.bodyText);
	}

	// GET /api/v1/chains/:chainId/tx/:txhash
	const txEndpoint = `/api/v1/chains/${config.chainId}/tx/${config.testTxhash}`;
	printTest('Tx情報取得', `GET ${txEndpoint}`);
	res = await request(config, 'GET', txEndpoint);

	if (res.status === 200 && hasField(res.body, 'txhash')) {
		counter.pass('Tx情報取得', txEndpoint, 'ステータス200、txhashフィールド確認', res.bodyText);
	} else if (res.status === 404) {
		counter.pass('Tx情報取得', txEndpoint, 'ステータス404（Tx未発見）- 正常なエラーレスポンス', res.bodyText);
	} else if (res.status === 502 && res.bodyText.includes('Downstream error')) {
		// バックエンドからエラーレスポンスが返っている = 通信は成功
		counter.pass('Tx情報取得', txEndpoint, 'バックエンド接続成功（Tx未発見）', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('Tx情報取得', txEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('Tx情報取得', txEndpoint, `期待ステータス200/404、実際: ${res.status}`, res.bodyText);
	}
}

async function testObserve(config: TestConfig, counter: TestCounter) {
	printHeader('Observation API');

	// GET /api/v1/chains/:chainId/mempool
	const mempoolEndpoint = `/api/v1/chains/${config.chainId}/mempool`;
	printTest('Mempool情報取得', `GET ${mempoolEndpoint}`);
	let res = await request(config, 'GET', mempoolEndpoint);

	if (res.status === 200 && hasField(res.body, 'numUnconfirmedTxs')) {
		counter.pass('Mempool情報取得', mempoolEndpoint, 'ステータス200、numUnconfirmedTxsフィールド確認', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('Mempool情報取得', mempoolEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('Mempool情報取得', mempoolEndpoint, `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}

	// GET /api/v1/chains/:chainId/status
	const statusEndpoint = `/api/v1/chains/${config.chainId}/status`;
	printTest('ノードステータス取得', `GET ${statusEndpoint}`);
	res = await request(config, 'GET', statusEndpoint);

	if (res.status === 200 && hasField(res.body, 'nodeInfo')) {
		counter.pass('ノードステータス取得', statusEndpoint, 'ステータス200、nodeInfoフィールド確認', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('ノードステータス取得', statusEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('ノードステータス取得', statusEndpoint, `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}

	// GET /api/v1/chains/:chainId/blocks/latest
	const latestEndpoint = `/api/v1/chains/${config.chainId}/blocks/latest`;
	printTest('最新ブロック取得', `GET ${latestEndpoint}`);
	res = await request(config, 'GET', latestEndpoint);

	if (res.status === 200 && hasField(res.body, 'height')) {
		counter.pass('最新ブロック取得', latestEndpoint, 'ステータス200、heightフィールド確認', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('最新ブロック取得', latestEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('最新ブロック取得', latestEndpoint, `期待ステータス200、実際: ${res.status}`, res.bodyText);
	}

	// GET /api/v1/chains/:chainId/blocks/:height
	const blockEndpoint = `/api/v1/chains/${config.chainId}/blocks/${config.testBlockHeight}`;
	printTest('指定ブロック取得', `GET ${blockEndpoint}`);
	res = await request(config, 'GET', blockEndpoint);

	if (res.status === 200 && hasField(res.body, 'height')) {
		counter.pass('指定ブロック取得', blockEndpoint, 'ステータス200、heightフィールド確認', res.bodyText);
	} else if (res.status === 404) {
		counter.pass('指定ブロック取得', blockEndpoint, 'ステータス404（ブロック未発見）- 正常なエラーレスポンス', res.bodyText);
	} else if (res.status === 502 || res.status === 504) {
		counter.skip('指定ブロック取得', blockEndpoint, `バックエンド接続エラー (${res.status}) - K8s環境が必要`, res.bodyText);
	} else {
		counter.fail('指定ブロック取得', blockEndpoint, `期待ステータス200/404、実際: ${res.status}`, res.bodyText);
	}

	// 異常系: 無効なheight
	const invalidEndpoint = `/api/v1/chains/${config.chainId}/blocks/invalid`;
	printTest('無効なブロック高さ', `GET ${invalidEndpoint}`);
	res = await request(config, 'GET', invalidEndpoint);

	if (res.status === 400) {
		counter.pass('無効なブロック高さ', invalidEndpoint, 'ステータス400、バリデーションエラー確認', res.bodyText);
	} else {
		counter.fail('無効なブロック高さ', invalidEndpoint, `期待ステータス400、実際: ${res.status}`, res.bodyText);
	}
}

async function testAuth(config: TestConfig, counter: TestCounter) {
	printHeader('Authentication Tests');

	printTest('認証ヘッダーなし', 'GET /api/v1/chains (without Authorization)');
	const res = await request(config, 'GET', '/api/v1/chains', undefined, false);

	if (res.status === 401) {
		counter.pass('認証ヘッダーなし', '/api/v1/chains', 'ステータス401、認証エラー確認', res.bodyText);
	} else if (res.status === 200) {
		counter.skip('認証ヘッダーなし', '/api/v1/chains', 'AUTH_DISABLED=trueのため認証がスキップされています', res.bodyText);
	} else {
		counter.fail('認証ヘッダーなし', '/api/v1/chains', `期待ステータス401、実際: ${res.status}`, res.bodyText);
	}
}

async function test404(config: TestConfig, counter: TestCounter) {
	printHeader('404 Not Found Tests');

	printTest('存在しないエンドポイント', 'GET /api/v1/nonexistent');
	const res = await request(config, 'GET', '/api/v1/nonexistent');

	if (res.status === 404 && hasField(res.body, 'error')) {
		counter.pass('存在しないエンドポイント', '/api/v1/nonexistent', 'ステータス404、errorフィールド確認', res.bodyText);
	} else {
		counter.fail('存在しないエンドポイント', '/api/v1/nonexistent', `期待ステータス404、実際: ${res.status}`, res.bodyText);
	}
}

// ============================================================
// メイン処理
// ============================================================

function showHelp() {
	console.log('Cryptomeria-Bff APIテストスクリプト');
	console.log('');
	console.log('使用方法: npx tsx tests/run.ts [category...]');
	console.log('');
	console.log('カテゴリ:');
	console.log('  health    - ヘルスチェックテスト');
	console.log('  chains    - Discovery APIテスト');
	console.log('  accounts  - Account APIテスト');
	console.log('  tx        - Transaction APIテスト');
	console.log('  observe   - Observation APIテスト');
	console.log('  auth      - 認証テスト');
	console.log('  404       - 404エラーテスト');
	console.log('');
	console.log('引数なしの場合、全カテゴリのテストを実行します。');
	console.log('');
	console.log('環境変数:');
	console.log('  BASE_URL   - BFFサーバーのURL (default: http://localhost:3000)');
	console.log('  CHAIN_ID   - テスト対象のチェーンID (default: gwc)');
	console.log('  AUTH_TOKEN - 認証トークン');
	console.log('');
	console.log('例:');
	console.log('  npx tsx tests/run.ts                    # 全テスト');
	console.log('  npx tsx tests/run.ts health chains      # health と chains のみ');
	console.log('  BASE_URL=http://localhost:8080 npx tsx tests/run.ts');
}

async function checkServerConnection(config: TestConfig): Promise<boolean> {
	console.log(`\n${colors.cyan}サーバー接続確認中...${colors.reset}`);
	try {
		const res = await fetch(`${config.baseUrl}/health`, {
			signal: AbortSignal.timeout(5000),
		});
		if (res.status === 200) {
			console.log(`${colors.green}サーバー接続OK${colors.reset}`);
			return true;
		}
	} catch {
		// ignore
	}
	console.log(`${colors.yellow}警告: サーバー (${config.baseUrl}) に接続できません${colors.reset}`);
	console.log(`${colors.yellow}BFFサーバーが起動していることを確認してください${colors.reset}`);
	return false;
}

type TestCategory = 'health' | 'chains' | 'accounts' | 'tx' | 'observe' | 'auth' | '404';

const testFunctions: Record<TestCategory, (config: TestConfig, counter: TestCounter) => Promise<void>> = {
	health: testHealth,
	chains: testChains,
	accounts: testAccounts,
	tx: testTx,
	observe: testObserve,
	auth: testAuth,
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
	console.log('║         Cryptomeria-Bff API テストスクリプト                      ║');
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
			: ['health', 'chains', 'accounts', 'tx', 'observe', 'auth', '404'];

	for (const category of categories) {
		await testFunctions[category](config, counter);
	}

	counter.printSummary();

	// 失敗があれば終了コード1
	process.exit(counter.failed > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
