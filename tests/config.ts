/**
 * APIテスト設定
 */
export interface TestConfig {
	/** BFFサーバーのベースURL */
	baseUrl: string;
	/** テスト対象のチェーンID */
	chainId: string;
	/** テスト用アドレス */
	testAddress: string;
	/** 認証トークン */
	authToken: string;
	/** ダミーtxBytesBase64 */
	dummyTxBytes: string;
	/** テスト用ブロック高さ */
	testBlockHeight: string;
	/** テスト用txhash */
	testTxhash: string;
	/** リクエストタイムアウト (ms) */
	timeoutMs: number;
}

/**
 * デフォルト設定を取得
 */
export function getConfig(): TestConfig {
	return {
		baseUrl: process.env.BASE_URL || 'http://localhost:4000',
		chainId: process.env.CHAIN_ID || 'gwc',
		testAddress: process.env.TEST_ADDRESS || 'cosmos1test123456789abcdef',
		authToken: process.env.AUTH_TOKEN || 'your-secret-token',
		dummyTxBytes:
			process.env.DUMMY_TX_BYTES ||
			'CpABCo0BChwvY29zbW9zLmJhbmsudjFiZXRhMS5Nc2dTZW5kEm0KLWNvc21vczF0ZXN0MTIzNDU2Nzg5YWJjZGVmMTIzNDU2Nzg5YWJjZGVmMTIzEi1jb3Ntb3MxcmVjdnIxMjM0NTY3ODlhYmNkZWYxMjM0NTY3ODlhYmNkZWYxMhoNCgV1YXRvbRIEMTAwMA==',
		testBlockHeight: process.env.TEST_BLOCK_HEIGHT || '1',
		testTxhash:
			process.env.TEST_TXHASH ||
			'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
		timeoutMs: parseInt(process.env.TIMEOUT_MS || '5000', 10),
	};
}
