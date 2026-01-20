# Cryptomeria-Bff API テストスクリプト

BFFサーバーのAPIエンドポイントをテストするTypeScriptスクリプトです。

## 使用方法

### 前提条件
- BFFサーバーが起動していること（`yarn dev` または `just dev bff-dev`）
- Node.js 20+

### 実行

```bash
# 全テスト実行
npx tsx tests/run.ts

# 特定カテゴリのみ
npx tsx tests/run.ts health chains

# ヘルプ表示
npx tsx tests/run.ts --help
```

### テストカテゴリ

| カテゴリ | 説明 |
|---------|------|
| `health` | ヘルスチェック |
| `chains` | Discovery API (チェーン一覧・情報) |
| `accounts` | Account API |
| `tx` | Transaction API (simulate/broadcast/tx確認) |
| `observe` | Observation API (mempool/status/blocks) |
| `auth` | 認証テスト |
| `404` | 404エラー確認 |

## 設定

環境変数で設定を上書きできます:

```bash
# 異なるサーバーに対してテスト
BASE_URL=http://192.168.1.100:3000 npx tsx tests/run.ts

# 異なるチェーンIDでテスト
CHAIN_ID=mdsc npx tsx tests/run.ts

# 認証トークン指定
AUTH_TOKEN=your-secret-token npx tsx tests/run.ts
```

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `run.ts` | メインテストランナー |
| `config.ts` | 設定インターフェース |
| `utils.ts` | ユーティリティ関数 |

## テスト結果の見方

- ✓ **PASS**: テスト成功
- ✗ **FAIL**: テスト失敗
- ⊘ **SKIP**: スキップ（K8s環境依存などの理由）

> **Note**: K8s環境に接続できない場合、一部のテストは502/504エラーでスキップされます。
> これはBFFの動作確認としては正常です（バックエンドへの接続ができないため）。
