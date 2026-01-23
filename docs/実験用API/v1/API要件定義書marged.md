# Cryptomeria-BFF v1 要件定義書（Utilities / Experiment Layer 完全版）
- 対象: Cryptomeria-BFF v1（第3層: Utilities / Experiment Layer）
- 版: 1.0.0
- 最終更新: 2026-01-23

## 1. 背景と目的
### 1.1 背景
卒研・実験・負荷試験・観測・データ取得では「測る・まとめる・流す・記録する」を短いスクリプトで繰り返し実行できることが重要である。

### 1.2 目的
- 実験・観測・データ取得・負荷試験などの“便利機能”をBFFで提供し、実験用クライアント/スクリプトを簡素化する。
- 長時間/高負荷になり得る処理は非同期ジョブとして実行し、再現性・運用性を高める。
- TPS/throughput の算出はブロックヘッダ時刻ベースに統一定義し、比較可能性を担保する。

## 2. スコープ
### 2.1 対象範囲（v1）
Base Path は `/api/v1/utils` とし、以下を提供する（すべて非同期ジョブ化）。
- 観測（Tx確定待ち）
- メトリクス（throughput、resource snapshot）
- 負荷（broadcast-batch、broadcast-and-confirm）
- Utilitiesスコープのジョブ管理（list/get/logs/cancel）

### 2.2 参照・依存（他層）
Utilities層は第2層（Blockchain API）および System API を“部品”として合成利用する。
- `/chains/*` 系（latestHeight/tx検索/block取得 等）
- `/system/status`、`/system/k8s/*` 等（resource-snapshot で利用）

※ これら部品APIの詳細仕様は本書の外（第2層/システム層の仕様）とし、Utilities側は「何を呼ぶか／どう集計するか／どうジョブ化するか」を規定する。

### 2.3 非対象（v1スコープ外）
- 認証・権限・ADMIN 等の概念（設計から撤廃）
- 署名生成（第2層同様、BFFは署名済みTxのみ受け取る）
- 永続ログの保存（ジョブログはインメモリ/揮発）
- WebSocket 等によるリアルタイム配信

## 3. 全体要件（共通）
### 3.1 API共通
- Content-Type: `application/json; charset=utf-8`
- エラー形式（共通）
```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "timeoutMs must be >= 1000",
    "details": { "field": "timeoutMs" }
  }
}
```

代表 code（HTTPとの対応）
- `INVALID_ARGUMENT` (400)
- `NOT_FOUND` (404)
- `CONFLICT` (409) : 排他
- `RATE_LIMITED` (429) : 並列/レート制限
- `UPSTREAM_UNAVAILABLE` (503)
- `UPSTREAM_ERROR` (502)
- `INTERNAL` (500)

### 3.2 非同期ジョブ要件
- Utilities層の長時間処理は **全てジョブ化**し、クライアントは jobId で進捗/結果を取得できる。
- ジョブモデル・共通ジョブAPI（list/get/logs/cancel）は **APIJOB仕様書**に準拠する。
- ジョブは v1 では **インメモリのみ**（BFF再起動で消える）。

### 3.3 タイムアウト・ポーリング・並列
- `timeoutMs` を（既定含め）持ち、無制限待ちを禁止する。
- ポーリング型は `pollIntervalMs` を持つ。
- バッチ処理は `maxConcurrency` を持ち、サーバ側で上限を強制する。

**サーバ側強制上限（代表）**
- `maxConcurrencyLimit`（broadcast等）: default 20（環境変数で変更可）
- `maxBatchSize`（tx list等）: default 1000（環境変数で変更可）
- `maxRunningJobs`（同時実行数）: 例 4（超過時 429）
- `utils.load.*` は system 影響が大きいため、別枠の同時実行上限（例 1〜2）を持つ。

**設計注意（要件化）**
- timeout は「失敗」ではなく「未確認」として別カウントできるようにする（観測系/負荷+観測系の集計要件）。
- throughput計算は大量ブロック取得になり得るため、window上限・キャッシュ・estimate/autoモード等で暴走を防ぐ。

## 4. 機能要件（エンドポイント）
> すべて `POST` は 202 を返し job を作成する（jobId は Jobオブジェクト内）。

### 4.1 ジョブ管理（Utilitiesスコープ）
- `GET /jobs`
- `GET /jobs/{jobId}`
- `GET /jobs/{jobId}/logs`
- `POST /jobs/{jobId}/cancel`

要件
- System層の `/api/v1/system/jobs/*` と同一モデル・同一セマンティクスであること。
- `/jobs` はフィルタ（type/status）とページング（limit/cursor）をサポートすること（※本書で共通要件として定義）。

### 4.2 観測ジョブ
#### 4.2.1 POST /observe/tx-confirmation
**目的**: txhash が確定（Tx検索で取得可能）するまで待機。

Request（必須）
```json
{
  "chainId": "gwc",
  "txhash": "ABCDEF...",
  "timeoutMs": 300000,
  "pollIntervalMs": 1000
}
```
制約
- `timeoutMs` >= 1000
- `pollIntervalMs` >= 200（推奨 500〜2000）

Job type: `utils.observe.tx-confirmation`

Result（成功時）: `TxConfirmationResult`
```json
{
  "chainId": "gwc",
  "txhash": "ABCDEF...",
  "confirmed": true,
  "height": 12345,
  "firstSeenAt": "2026-01-23T09:00:00Z",
  "confirmedAt": "2026-01-23T09:00:05Z",
  "latencyMs": 5000
}
```
補足要件
- 取得可能なら `code` と `raw`（txレスポンス）を返してよい（後方互換）。
- `confirmed=false` の終了（timeout）を結果として表現できること（失敗扱いにしない運用を可能にする）。

推奨 steps
1. validate
2. pollTx
3. finish

#### 4.2.2 POST /observe/tx-confirmation-batch
**目的**: 複数 txhash の確定を待機し、統計を返す。

Request
```json
{
  "chainId": "gwc",
  "txhashes": ["A...", "B...", "C..."],
  "timeoutMs": 300000,
  "pollIntervalMs": 1000,
  "maxConcurrency": 20,
  "stopOnFirstError": false
}
```
制約
- `txhashes.length` <= `maxBatchSize`（default 1000）
- `maxConcurrency` <= `maxConcurrencyLimit`（default 20）

Job type: `utils.observe.tx-confirmation-batch`

Result
```json
{
  "summary": { "total": 3, "succeeded": 3, "failed": 0, "durationMs": 12000 },
  "items": [
    { "txhash": "A...", "confirmed": true, "latencyMs": 5000, "height": 12345 },
    { "txhash": "B...", "confirmed": true, "latencyMs": 7000, "height": 12346 }
  ]
}
```
補足要件（拡張可能）
- 旧仕様にある `timeout` 別カウント、percentile 等の集計を必要に応じて追加可能とする。
- timeout の扱いは「失敗」と区別できること。

推奨 steps
1. validate
2. pollBatch
3. aggregate
4. finish

### 4.3 メトリクスジョブ
#### 4.3.1 POST /metrics/throughput
**目的**: 指定 window の範囲で TPS/throughput 近似を算出。

Request
```json
{
  "chainId": "gwc",
  "window": 100,
  "mode": "auto",
  "timeoutMs": 120000
}
```
制約
- `window`: min=2, max=2000

**固定定義（必ずこの方式）**
- `endHeight = latestHeight`
- `startHeight = endHeight - window + 1`
- `totalTx = Σ txCount[h] for h in [startHeight..endHeight]`
- `durationSeconds = (headerTime[endHeight] - headerTime[startHeight]).seconds`
- `tps = totalTx / durationSeconds`
- 返却に `startHeight/endHeight/timeStart/timeEnd/totalTx/durationSeconds` を必ず含める
- ブロックヘッダ時刻ベース（wall-clock を使わない）

Job type: `utils.metrics.throughput`

Result（ThroughputResult）
```json
{
  "chainId": "gwc",
  "range": { "startHeight": 12246, "endHeight": 12345 },
  "timeStart": "2026-01-23T08:58:20Z",
  "timeEnd": "2026-01-23T09:00:00Z",
  "durationSeconds": 100,
  "totalTx": 1200,
  "tps": 12.0,
  "computedAt": "2026-01-23T09:00:01Z"
}
```

推奨 steps
1. validate
2. resolveHeights
3. fetchBlocks
4. compute
5. finish

#### 4.3.2 POST /metrics/resource-snapshot
**目的**: k8s + chain の状態をまとめて採取し、実験ログに添付しやすい形で返す。

Request
```json
{
  "namespace": "cryptomeria",
  "include": ["systemStatus", "pods", "services", "chainsStatus"],
  "timeoutMs": 60000
}
```
include（optional）
- `systemStatus`: `/system/status` 相当
- `pods`: `/system/k8s/pods` 相当
- `services`: `/system/k8s/services` 相当
- `chainsStatus`: `/chains/{chainId}/status` を全チェーン分

Job type: `utils.metrics.resource-snapshot`

Result（ResourceSnapshotResult）
```json
{
  "observedAt": "2026-01-23T09:00:00Z",
  "namespace": "cryptomeria",
  "systemStatus": { "...": "..." },
  "pods": { "items": [ "..." ] },
  "services": { "items": [ "..." ] },
  "chainsStatus": [
    { "chainId": "gwc", "latestHeight": 12345, "catchingUp": false }
  ]
}
```

推奨 steps
1. validate
2. collectSystem
3. collectChains
4. finish

### 4.4 負荷ジョブ
#### 4.4.1 POST /load/broadcast-batch
**目的**: 署名済みTxを並列 broadcast し、成功率とエラー分類を返す。

Request
```json
{
  "chainId": "gwc",
  "txBytesBase64List": ["....", "...."],
  "broadcastMode": "sync",
  "maxConcurrency": 20,
  "timeoutMs": 300000,
  "stopOnFirstError": false
}
```
制約
- `txBytesBase64List.length` <= `maxBatchSize`（default 1000）
- `maxConcurrency` <= `maxConcurrencyLimit`（default 20）

Job type: `utils.load.broadcast-batch`

Result（最小）
```json
{
  "summary": { "total": 2, "succeeded": 2, "failed": 0, "durationMs": 1200 },
  "items": [
    { "index": 0, "txhash": "A...", "ok": true },
    { "index": 1, "txhash": "B...", "ok": true }
  ]
}
```
補足要件
- 旧仕様の `code`/`rawLog` 等が取得できる場合は items に含めてよい（エラー分類のため）。

推奨 steps
1. validate
2. broadcastBatch
3. aggregate
4. finish

#### 4.4.2 POST /load/broadcast-and-confirm
**目的**: 署名済みTxを broadcast し、確定まで追跡する（負荷＋観測の統合）。

Request
```json
{
  "chainId": "gwc",
  "txBytesBase64List": ["....", "...."],
  "broadcastMode": "sync",
  "maxConcurrency": 10,
  "timeoutMs": 600000,
  "pollIntervalMs": 1000
}
```
Job type: `utils.load.broadcast-and-confirm`

Result
```json
{
  "summary": { "total": 2, "succeeded": 2, "failed": 0, "durationMs": 20000 },
  "items": [
    { "index": 0, "txhash": "A...", "confirmed": true, "latencyMs": 8000 },
    { "index": 1, "txhash": "B...", "confirmed": true, "latencyMs": 9000 }
  ]
}
```
推奨 steps
1. validate
2. broadcastBatch
3. confirmBatch
4. aggregate
5. finish

## 5. データ要件（モデル）
### 5.1 TxConfirmationResult
- `chainId` (string)  
- `txhash` (string)  
- `confirmed` (boolean)  
- `height` (number)  
- `firstSeenAt` (RFC3339 string)  
- `confirmedAt` (RFC3339 string, nullable)  
- `latencyMs` (number, nullable)  
- 取得可能なら `code` (number) / `raw` (object) を付加可能（後方互換）

### 5.2 BatchSummary
最小
- `total` / `succeeded` / `failed` / `durationMs`

拡張（必要なら）
- `timeout`、`latencyMs`（mean/p50/p95/max等）、`errors`（分類集計）

### 5.3 ThroughputResult（固定）
- `range.startHeight/endHeight`
- `timeStart/timeEnd`（ブロックヘッダ時刻）
- `durationSeconds`
- `totalTx`
- `tps`
- `computedAt`

### 5.4 ResourceSnapshotResult
- `observedAt`（採取時刻）
- `namespace`
- `systemStatus`/`pods`/`services`/`chainsStatus`（includeに応じて best-effort）
- `notes`（任意）

## 6. 非機能要件
### 6.1 性能・負荷
- すべてのバッチ/負荷系処理はサーバ側上限でクランプされること（要求値 > 上限の場合は 400 か 429）。
- throughput は window max=2000 を超えないこと。
- ジョブ同時実行数は `maxRunningJobs` を超えないこと（超過時 429）。

### 6.2 可観測性
- job logs を取得できること（進捗・ステップ遷移・上流呼び出し結果のサマリ等）。
- resource-snapshot を実験ログに添付できる粒度で返すこと。

### 6.3 信頼性
- Upstream（チェーンRPC/K8s API）が不安定な場合、`UPSTREAM_UNAVAILABLE`/`UPSTREAM_ERROR` で識別可能な失敗を返す。
- 途中失敗時も job は `FAILED` 等の終端状態になり、エラー詳細が job に保存されること（インメモリ期間内）。

### 6.4 セキュリティ（v1）
- 認証・権限は扱わない（外部ネットワークからのアクセス制御はインフラ側で行う前提）。
- 入力はサニタイズし、base64等のデコード失敗は `INVALID_ARGUMENT`。

## 7. テスト要件（v1）
> 本書では、後続の「テスト要件書」作成のために、最低限の検証項目を要件として明文化する。

### 7.1 共通
- エラー形式が共通フォーマットで返ること。
- `timeoutMs`/`pollIntervalMs`/`window`/`maxConcurrency`/`batch size` のバリデーションが仕様どおり。
- 上限超過時のエラー（400/429）が仕様どおり。
- ジョブ管理API（list/get/logs/cancel）が APIJOB仕様書どおり。
- ジョブがインメモリであること（再起動で消える）。

### 7.2 観測
- tx-confirmation が timeout になった場合、ジョブは「失敗」ではなく「confirmed=false の結果」または「timeoutを区別できる状態」で完了できる（運用上必要）。
- batch で stopOnFirstError の挙動が一致する。

### 7.3 throughput（固定定義）
- 固定定義の数式どおり（ブロックヘッダ時刻差、latestHeight、window）。
- 返却フィールドが欠けない。

### 7.4 resource-snapshot
- include の組合せで必要なフィールドが返る。
- best-effort で部分失敗してもジョブが破綻しない（欠落情報は notes 等で説明可能）。

### 7.5 load
- broadcast-batch：maxConcurrency のクランプ、batch size 上限、stopOnFirstError。
- broadcast-and-confirm：confirmBatch のポーリング間隔と timeout の整合、confirmed/latency の算出。

## 8. 変更履歴
- 1.0.0: v1 初版（Utilities を全面ジョブ化、throughput 定義を固定）
