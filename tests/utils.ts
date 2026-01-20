/**
 * テストユーティリティ
 */
import type { TestConfig } from './config.js';

// 色定義（ANSI escape codes）
const colors = {
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	cyan: '\x1b[36m',
	reset: '\x1b[0m',
} as const;

export type TestResult = 'pass' | 'fail' | 'skip';

export interface TestCase {
	name: string;
	endpoint: string;
	result: TestResult;
	message: string;
	response?: string;
}

/**
 * テスト結果カウンタ
 */
export class TestCounter {
	passed = 0;
	failed = 0;
	skipped = 0;
	cases: TestCase[] = [];

	pass(name: string, endpoint: string, message: string, response?: string) {
		this.passed++;
		this.cases.push({ name, endpoint, result: 'pass', message, response });
		console.log(`${colors.green}  ✓ PASS: ${message}${colors.reset}`);
		if (response) {
			console.log(`  レスポンス: ${response}`);
		}
	}

	fail(name: string, endpoint: string, message: string, response?: string) {
		this.failed++;
		this.cases.push({ name, endpoint, result: 'fail', message, response });
		console.log(`${colors.red}  ✗ FAIL: ${message}${colors.reset}`);
		if (response) {
			console.log(`  レスポンス: ${response}`);
		}
	}

	skip(name: string, endpoint: string, message: string, response?: string) {
		this.skipped++;
		this.cases.push({ name, endpoint, result: 'skip', message, response });
		console.log(`${colors.yellow}  ⊘ SKIP: ${message}${colors.reset}`);
		if (response) {
			console.log(`  レスポンス: ${response}`);
		}
	}

	get total() {
		return this.passed + this.failed + this.skipped;
	}

	printSummary() {
		printHeader('テスト結果サマリー');
		console.log('');
		console.log(`  ${colors.green}✓ PASSED:  ${this.passed}${colors.reset}`);
		console.log(`  ${colors.red}✗ FAILED:  ${this.failed}${colors.reset}`);
		console.log(`  ${colors.yellow}⊘ SKIPPED: ${this.skipped}${colors.reset}`);
		console.log('  ─────────────────');
		console.log(`    TOTAL:   ${this.total}`);
		console.log('');

		if (this.failed === 0) {
			console.log(`${colors.green}🎉 全てのテストが成功しました！${colors.reset}`);
		} else {
			console.log(`${colors.red}⚠ ${this.failed}件のテストが失敗しました${colors.reset}`);
		}
		console.log('');
	}
}

/**
 * ヘッダー出力
 */
export function printHeader(title: string) {
	console.log('');
	console.log(
		`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
	);
	console.log(`${colors.blue}  ${title}${colors.reset}`);
	console.log(
		`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
	);
}

/**
 * テスト開始出力
 */
export function printTest(name: string, endpoint: string) {
	console.log('');
	console.log(`${colors.cyan}▶ テスト: ${name}${colors.reset}`);
	console.log(`${colors.cyan}  エンドポイント: ${endpoint}${colors.reset}`);
}

/**
 * HTTPリクエスト結果
 */
export interface RequestResult {
	status: number;
	body: unknown;
	bodyText: string;
	ok: boolean;
}

/**
 * HTTPリクエスト実行
 */
export async function request(
	config: TestConfig,
	method: 'GET' | 'POST',
	path: string,
	body?: unknown,
	includeAuth = true
): Promise<RequestResult> {
	const url = `${config.baseUrl}${path}`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	if (includeAuth && config.authToken) {
		headers['Authorization'] = `Bearer ${config.authToken}`;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});

		const bodyText = await response.text();
		let bodyJson: unknown;
		try {
			bodyJson = JSON.parse(bodyText);
		} catch {
			bodyJson = bodyText;
		}

		return {
			status: response.status,
			body: bodyJson,
			bodyText,
			ok: response.ok,
		};
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return {
				status: 0,
				body: { error: 'Request timeout' },
				bodyText: 'Request timeout',
				ok: false,
			};
		}
		return {
			status: 0,
			body: { error: String(error) },
			bodyText: String(error),
			ok: false,
		};
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * JSONにフィールドが存在するか確認
 */
export function hasField(obj: unknown, field: string): boolean {
	return typeof obj === 'object' && obj !== null && field in obj;
}
