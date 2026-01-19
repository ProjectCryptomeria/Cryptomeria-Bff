# Cryptomeria-Bff

Cryptomeria 実験用BFFサーバー（Backend for Frontend）

## 概要

卒業研究の実験において、Cryptomeria-core（バックエンド）と簡易クライアント（フロント：wallet相当）の間に挟まるBFFとして機能します。

### 主な機能

- **Tx作成・署名に必要な情報の提供** - account_number, sequence, chain info
- **署名済みTxのブロードキャスト** - クライアントが作成した署名済みTxを中継
- **観測ユーティリティ** - mempool, ブロック, tx確認, ノードステータス

### 設計方針

1. **BFFは秘密鍵を持たない** - 署名はクライアント側で行う
2. **BFFはDBを持たない** - 永続化しない（短命キャッシュのみ）
3. **Tx中身の解釈は最小限** - 橋渡しに徹する

## セットアップ

```bash
# 依存関係インストール
yarn install

# 開発サーバー起動
yarn dev

# ビルド
yarn build

# 本番起動
yarn start
```

## 環境変数

| 変数 | 必須 | デフォルト | 説明 |
|------|------|-----------|------|
| `API_TOKEN` | ✅ | - | Bearer token認証用 |
| `NODE_HOST` | ✅ | - | NodePortへ到達するホスト/IP |
| `K8S_NAMESPACE` | | `cryptomeria` | Kubernetes namespace |
| `PORT` | | `3000` | サーバーポート |
| `DOWNSTREAM_TIMEOUT_MS` | | `10000` | 下流タイムアウト（ms） |
| `MAX_TX_BASE64_CHARS` | | `5000000` | txBytesBase64の最大文字数 |
| `ENDPOINT_CACHE_TTL_MS` | | `10000` | endpoint解決キャッシュTTL（ms） |

## API エンドポイント

すべてのAPIは `Authorization: Bearer <API_TOKEN>` を要求します。

### Discovery

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/v1/chains` | チェーン一覧 |
| GET | `/api/v1/chains/:chainId/info` | チェーン情報 |

### Account

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/v1/chains/:chainId/accounts/:address` | アカウント情報 |

### Transaction

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/v1/chains/:chainId/simulate` | Txシミュレート |
| POST | `/api/v1/chains/:chainId/broadcast` | Txブロードキャスト |
| GET | `/api/v1/chains/:chainId/tx/:txhash` | Tx情報取得 |

### Observation

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/v1/chains/:chainId/mempool` | Mempool情報 |
| GET | `/api/v1/chains/:chainId/status` | ノードステータス |
| GET | `/api/v1/chains/:chainId/blocks/latest` | 最新ブロック |
| GET | `/api/v1/chains/:chainId/blocks/:height` | 指定ブロック |

## 使用例

```bash
# チェーン一覧取得
curl -H "Authorization: Bearer your-token" http://localhost:3000/api/v1/chains

# アカウント情報取得
curl -H "Authorization: Bearer your-token" \
  http://localhost:3000/api/v1/chains/gwc/accounts/cosmos1xxx...

# Txブロードキャスト
curl -X POST -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"txBytesBase64": "...", "mode": "sync"}' \
  http://localhost:3000/api/v1/chains/gwc/broadcast
```

## 技術スタック

- **TypeScript** - 型安全な実装
- **Hono** - 軽量Webフレームワーク
- **zod** - 入力バリデーション
- **@kubernetes/client-node** - Kubernetes API クライアント
