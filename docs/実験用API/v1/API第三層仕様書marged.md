# API第三層仕様書（Utilities / Experiment Layer）統合版

- 対象: Cryptomeria-BFF v1
- 版: 1.0.0
- 最終更新: 2026-01-23
- Base Path: `/api/v1/utils`

この層の目的:
- 実験・観測・データ取得・負荷試験など「便利機能」を提供する
- 長時間/高負荷になり得る処理は **非同期ジョブ化**し、実験の再現性・運用性を上げる
- TPS/throughput は **ブロックヘッダ時刻ベース**で統一定義し、比較可能性を担保する

> 本仕様書は **第3層（Utilities）** のみを対象とする。  
> 目的は、卒研・実験・負荷試験・データ取得で頻出する「測る・まとめる・流す・記録する」をBFF側でユーティリティとして提供し、実験用スクリプト/クライアントを簡単にすること。  
> 第2層（Blockchain）を “部品API” として組み合わせ、統計・バッチ処理・スナップショット化・観測補助を行う。  
> 認証・権限・ADMIN等の概念は本要件から撤廃し、仕様書でも扱わない。

> 第3層のジョブモデルは **APIJOB仕様書.md** に準拠する。  
> 本仕様書では Utilities スコープの job type / step / リクエスト仕様を規定する。

---

## 0. パス表記のメモ（旧仕様との対応）
- **新（本仕様）**: Base Path は `/api/v1/utils`
- **旧仕様（Draft）**: BasePath `/api/v1` + Prefix `/utils`（= `/api/v1/utils` 相当）

---

## 1. 共通仕様

### 1.1 Content-Type
- Request/Response は基本 `application/json; charset=utf-8`

### 1.2 エラー形式（共通）
```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "timeoutMs must be >= 1000",
    "details": { "field": "timeoutMs" }
  }
}
```

代表 code:
- `INVALID_ARGUMENT` (400)
- `NOT_FOUND` (404)
- `CONFLICT` (409) : 排他
- `RATE_LIMITED` (429) : 並列/レート制限
- `UPSTREAM_UNAVAILABLE` (503)
- `UPSTREAM_ERROR` (502)
- `INTERNAL` (500)

### 1.3 並列上限（サーバ側強制）
- Utilities 層は負荷をかけるAPIを含むため、サーバ側で必ず上限を持つ。
- 代表:
  - `maxConcurrency`（broadcast等）: default 20（環境変数で変更可）
  - `maxBatchSize`（txs等）: default 1000（環境変数で変更可）
- 上限超過時は 400（サイズ）または 429（並列）を返す。

### 1.4 タイムアウトの扱い（旧仕様の方針を踏襲）
Utilitiesは「待つ」「たくさん叩く」系が多いので、各APIは次の方針を持つ。
- `timeoutMs`（既定）を持つ：省略時でも安全に終了できる
- `pollIntervalMs` を持つ（ポーリング型の場合）
- バッチ処理は `concurrency` を持つ（上限を設ける）

> 補足（旧仕様の実装上の注意）  
> - 重い処理を作りやすい（throughput計算で大量ブロック取得）→ window上限、キャッシュ、estimateモードを用意する。  
> - 並列処理の暴走（broadcast/confirm）→ concurrency 上限必須、BFF側で最大値を固定しclampする。  
> - タイムアウトと“未確認”の扱い → timeoutは “失敗” ではなく “未確認” として別カウントするのが実験に有用。  
> - 結果の再現性 → snapshotを添付することで、後から “その時のシステム状態” を説明できる。

---

## 2. エンドポイント一覧

### 2.1 Utilities ジョブ（Utilsスコープ）
- `GET /jobs`
- `GET /jobs/{jobId}`
- `GET /jobs/{jobId}/logs`
- `POST /jobs/{jobId}/cancel`

> System層の `/api/v1/system/jobs/*` と同一モデル。  
> 共通仕様は APIJOB仕様書.md に従う。

### 2.2 観測・統計（ジョブ）
- `POST /observe/tx-confirmation`（txが確定するまで待機）
- `POST /observe/tx-confirmation-batch`（複数txhashの確定待ち）
- `POST /metrics/throughput`（TPS/throughput近似）
- `POST /metrics/resource-snapshot`（k8s+chainのスナップショット）

### 2.3 負荷（ジョブ）
- `POST /load/broadcast-batch`（署名済みTxを並列broadcast）
- `POST /load/broadcast-and-confirm`（broadcastし、確定まで追跡）

---

## 3. ジョブ永続化
- v1では **インメモリのみ**。BFF再起動でジョブは消える。
- 冪等性:
  - Utilities は「計測/負荷」の性質上、原則として冪等判定は限定的。
  - ただし `resource-snapshot` は “現在の状態を取るだけ” なので、force=falseでも冪等性問題は小さい。
  - batch観測/負荷は “再実行＝別実験” とみなしやすいため、冪等skipは基本しない（必要なら `requestId` で重複排除を将来拡張）。

---

## 4. データモデル（第3層）

### 4.1 TxConfirmationResult
新仕様のモデル:
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

旧仕様にあるフィールド（取得できる場合に返す想定）:
- `code`（例: 0）
- `raw`（txレスポンス）

> 旧仕様では「最終的に取得できた txレスポンス（raw）」を返すことを明記し、`includeRaw` をRequestで指定していた。

### 4.2 BatchSummary
新仕様の最小モデル:
```json
{
  "total": 100,
  "succeeded": 95,
  "failed": 5,
  "durationMs": 12000
}
```

旧仕様にある集計（必要なら付加する想定）:
```json
{
  "total": 100,
  "succeeded": 95,
  "failed": 5,
  "timeout": 0,
  "durationMs": 12000,
  "latencyMs": {
    "mean": 2100,
    "p50": 1900,
    "p95": 4200,
    "max": 9000
  },
  "errors": [
    { "code": "TX_FAILED", "count": 5 }
  ]
}
```

### 4.3 ThroughputResult（固定定義）
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

### 4.4 ResourceSnapshotResult
新仕様の最小モデル:
```json
{
  "observedAt": "2026-01-23T09:00:00Z",
  "namespace": "cryptomeria",
  "systemStatus": { "...": "see /system/status" },
  "notes": ["snapshot is best-effort"]
}
```

旧仕様の「実験時点の状態記録」モデル（参考）:
```json
{
  "takenAt": "2026-01-23T12:00:00Z",
  "system": {
    "namespace": "cryptomeria",
    "pods": [],
    "services": []
  },
  "chains": [
    { "chainId": "mdsc", "latestHeight": "1234", "catchingUp": false }
  ],
  "notes": { "tag": "expA", "params": {} }
}
```

---

# 5. 観測ジョブ

## 5.1 POST /observe/tx-confirmation
txhash が確定（Tx検索で取得可能）するまで待機する。

### Request
```json
{
  "chainId": "gwc",
  "txhash": "ABCDEF...",
  "timeoutMs": 300000,
  "pollIntervalMs": 1000
}
```

旧仕様のRequest（参考: raw返却の指定）:
```json
{
  "chainId": "mdsc",
  "txhash": "ABCDEF...",
  "timeoutMs": 60000,
  "pollIntervalMs": 500,
  "includeRaw": true
}
```

制約:
- `timeoutMs`: 1,000以上
- `pollIntervalMs`: 200以上（推奨 500〜2000）

### Response
- 202: Job作成（type=`utils.observe.tx-confirmation`）

### Job Result（成功時）
```json
{
  "result": {
    "chainId": "gwc",
    "txhash": "ABCDEF...",
    "confirmed": true,
    "height": 12345,
    "firstSeenAt": "2026-01-23T09:00:00Z",
    "confirmedAt": "2026-01-23T09:00:05Z",
    "latencyMs": 5000
  }
}
```

> 旧仕様のレスポンス例では `code` と `raw` を含んでいた（取得できる場合に返す想定）:
```json
{
  "result": {
    "txhash": "ABCDEF...",
    "confirmed": true,
    "height": "123",
    "code": 0,
    "latencyMs": 1834,
    "firstSeenAt": "2026-01-23T12:00:00Z",
    "confirmedAt": "2026-01-23T12:00:01Z",
    "raw": {}
  }
}
```

### steps（推奨）
1. `validate`
2. `pollTx`
3. `finish`

---

## 5.2 POST /observe/tx-confirmation-batch
複数 txhash の確定を待機し、統計を返す。

### Request
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

旧仕様のRequest（参考: 統計の粒度）:
```json
{
  "chainId": "mdsc",
  "txhashes": ["A...", "B...", "C..."],
  "timeoutMs": 60000,
  "pollIntervalMs": 500,
  "concurrency": 10,
  "percentiles": [50, 90, 95, 99],
  "includeItems": true
}
```

制約:
- `txhashes.length` <= `maxBatchSize`（default 1000）
- `maxConcurrency` <= `maxConcurrencyLimit`（default 20）

### Response
- 202: Job作成（type=`utils.observe.tx-confirmation-batch`）

### Job Result（成功時）
```json
{
  "result": {
    "summary": { "total": 3, "succeeded": 3, "failed": 0, "durationMs": 12000 },
    "items": [
      { "txhash": "A...", "confirmed": true, "latencyMs": 5000, "height": 12345 },
      { "txhash": "B...", "confirmed": true, "latencyMs": 7000, "height": 12346 }
    ]
  }
}
```

> 旧仕様の集計例（参考: timeout別カウント、percentile等）:
```json
{
  "result": {
    "summary": {
      "total": 3,
      "succeeded": 3,
      "failed": 0,
      "timeout": 0,
      "durationMs": 5500,
      "latencyMs": { "mean": 2100, "p50": 1900, "p95": 4200, "max": 4200 },
      "errors": []
    },
    "items": [
      { "txhash": "A...", "confirmed": true, "code": 0, "latencyMs": 1800, "height": "10" },
      { "txhash": "B...", "confirmed": true, "code": 0, "latencyMs": 2200, "height": "11" }
    ]
  }
}
```

### steps（推奨）
1. `validate`
2. `pollBatch`
3. `aggregate`
4. `finish`

---

# 6. メトリクス（TPS / throughput）ジョブ

## 6.1 POST /metrics/throughput
指定 window の範囲で TPS/throughput 近似を算出する。

### 固定定義（必ずこの方式）
- `endHeight = latestHeight`
- `startHeight = endHeight - window + 1`
- `totalTx = Σ txCount[h] for h in [startHeight..endHeight]`
- `durationSeconds = (headerTime[endHeight] - headerTime[startHeight]).seconds`
- `tps = totalTx / durationSeconds`
- 返却に `startHeight/endHeight/timeStart/timeEnd/totalTx/durationSeconds` を必ず含める

> ブロックヘッダ時刻ベース。wall-clockを使わない。

### Request
```json
{
  "chainId": "gwc",
  "window": 100,
  "mode": "auto",
  "timeoutMs": 120000
}
```

旧仕様のQuery Parameters（参考: modeの考え方）:
- `mode`: `exact|estimate`（既定 `estimate`）
  - `estimate`: txsの実体取得を避け、txCountだけを取れる方法があればそれを使う（上流依存）
  - `exact`: block内txを実際に数える（重いが正確）
- `concurrency`: 既定 5（ブロック取得の並列数）

制約:
- `window`: min=2, max=2000

### Response
- 202: Job作成（type=`utils.metrics.throughput`）

### Job Result（成功時）
```json
{
  "result": {
    "chainId": "gwc",
    "range": { "startHeight": 12246, "endHeight": 12345 },
    "timeStart": "2026-01-23T08:58:20Z",
    "timeEnd": "2026-01-23T09:00:00Z",
    "durationSeconds": 100,
    "totalTx": 1200,
    "tps": 12.0,
    "computedAt": "2026-01-23T09:00:01Z"
  }
}
```

### steps（推奨）
1. `validate`
2. `resolveHeights`
3. `fetchBlocks`
4. `compute`
5. `finish`

---

# 7. リソーススナップショット（実験ログ用）ジョブ

## 7.1 POST /metrics/resource-snapshot
k8s+chain の状態をまとめて採取し、実験ログに添付しやすい形で返す。

### Request
```json
{
  "namespace": "cryptomeria",
  "include": ["systemStatus", "pods", "services", "chainsStatus"],
  "timeoutMs": 60000
}
```

- `include`（optional）:
  - `systemStatus`: `/system/status` 相当
  - `pods`: `/system/k8s/pods` 相当
  - `services`: `/system/k8s/services` 相当
  - `chainsStatus`: `/chains/{chainId}/status` を全チェーン分

旧仕様のQuery Parameters（参考: 旧エンドポイント記載）:
- `includeChains`: `true|false`（既定 true）
- `includePorts`: `true|false`（既定 true）
- `tag`: 任意の識別子（例：`expA`）

### Response
- 202: Job作成（type=`utils.metrics.resource-snapshot`）

### Job Result（成功時）
```json
{
  "result": {
    "observedAt": "2026-01-23T09:00:00Z",
    "namespace": "cryptomeria",
    "systemStatus": { "...": "..." },
    "pods": { "items": [ "..." ] },
    "services": { "items": [ "..." ] },
    "chainsStatus": [
      { "chainId": "gwc", "latestHeight": 12345, "catchingUp": false }
    ]
  }
}
```

### steps（推奨）
1. `validate`
2. `collectSystem`
3. `collectChains`
4. `finish`

---

# 8. 負荷ジョブ

## 8.1 POST /load/broadcast-batch
署名済みTxを並列 broadcast し、成功率とエラー分類を返す。

### Request
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

旧仕様のRequest（参考: 旧フィールド名）:
```json
{
  "chainId": "mdsc",
  "txs": ["<base64>", "<base64>"],
  "broadcastMode": "sync",
  "concurrency": 20,
  "timeoutMs": 60000,
  "includeItems": true
}
```

制約:
- `txBytesBase64List.length` <= `maxBatchSize`（default 1000）
- `maxConcurrency` <= `maxConcurrencyLimit`（default 20）

### Response
- 202: Job作成（type=`utils.load.broadcast-batch`）

### Job Result（成功時）
```json
{
  "result": {
    "summary": { "total": 2, "succeeded": 2, "failed": 0, "durationMs": 1200 },
    "items": [
      { "index": 0, "txhash": "A...", "ok": true },
      { "index": 1, "txhash": "B...", "ok": true }
    ]
  }
}
```

> 旧仕様のitems例（参考: code/rawLog など）:
```json
{
  "result": {
    "summary": { "total": 2, "succeeded": 2, "failed": 0, "timeout": 0, "durationMs": 1200, "errors": [] },
    "items": [
      { "index": 0, "txhash": "AAA...", "code": 0, "rawLog": "" },
      { "index": 1, "txhash": "BBB...", "code": 0, "rawLog": "" }
    ]
  }
}
```

### steps（推奨）
1. `validate`
2. `broadcastBatch`
3. `aggregate`
4. `finish`

---

## 8.2 POST /load/broadcast-and-confirm
署名済みTxを broadcast し、確定まで追跡する（負荷＋観測の統合）。

### Request
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

### Response
- 202: Job作成（type=`utils.load.broadcast-and-confirm`）

### Job Result（成功時）
```json
{
  "result": {
    "summary": { "total": 2, "succeeded": 2, "failed": 0, "durationMs": 20000 },
    "items": [
      { "index": 0, "txhash": "A...", "confirmed": true, "latencyMs": 8000 },
      { "index": 1, "txhash": "B...", "confirmed": true, "latencyMs": 9000 }
    ]
  }
}
```

### steps（推奨）
1. `validate`
2. `broadcastBatch`
3. `confirmBatch`
4. `aggregate`
5. `finish`

---

# 9. Utilitiesジョブ type と step 定義（APIJOB仕様書への上書き）

## 9.1 job type 一覧
- `utils.observe.tx-confirmation`
- `utils.observe.tx-confirmation-batch`
- `utils.metrics.throughput`
- `utils.metrics.resource-snapshot`
- `utils.load.broadcast-batch`
- `utils.load.broadcast-and-confirm`

## 9.2 排他・同時実行
- v1では Utilities ジョブは複数同時実行を許容するが、
  - サーバ側の `maxRunningJobs`（例: 4）を超える場合は 429 を返す
  - `utils.load.*` は system に影響が大きいので、同時に走らせる上限を別途持つ（例: 1〜2）

---

# 10. 非対応（v1スコープ外）
- 署名生成（第2層同様）
- “永続ログ” の保存（ジョブログはインメモリ/揮発）
- WebSocketによるリアルタイム配信

---

# 11. 変更履歴
- 1.0.0: v1 初版（Utilitiesを全面ジョブ化、throughput定義を固定）

---

# 付録A: 旧仕様書に記載の追加エンドポイント（参考）

> ここは旧仕様書（Draft）に記載されている内容を、本文を保ったまま参考として残す。

## A.1 GET `/utils/metrics/blocktime`（複数チェーンのブロック時間統計をまとめる）
- **目的**  
  第2層の `/chains/{chainId}/blocktime` を複数chainIdに対して実行し、比較しやすい形でまとめて返す。
- **何を提供するか**  
  - chainIdごとのブロック時間統計
  - 取得に使ったwindow/範囲情報
- **どんなことに使えるか**  
  - mdsc vs fdsc-0.. の比較
  - スケール前後比較（同windowで並べる）
- **内部的に必要な情報**  
  - `/chains` でchainId列挙（またはリクエストで指定）
  - `/chains/{chainId}/blocktime` 呼び出し
  - concurrency制御

#### Query Parameters（任意）
- `chainIds`：カンマ区切り（省略時は全チェーン）
- `window`：既定 100
- `percentiles`：例 `50,95`
- `concurrency`：既定 5

#### Response
- `200 OK`
```json
{
  "ok": true,
  "data": {
    "window": 100,
    "unit": "seconds",
    "items": [
      {
        "chainId": "mdsc",
        "stats": { "mean": 1.02, "p50": 1.01, "p95": 1.18, "min": 0.88, "max": 1.40 }
      },
      {
        "chainId": "fdsc-0",
        "stats": { "mean": 1.10, "p50": 1.09, "p95": 1.35, "min": 0.90, "max": 1.80 }
      }
    ]
  }
}
```

---

## A.2 POST `/utils/experiments/run`（任意：実験シナリオ実行）
> 将来的に、卒研の実験手順を “ボタン1つ/コマンド1つ” で再実行可能にするための拡張。  
> v1では「枠」だけ決め、具体シナリオは必要になった時に追加する運用がよい。

- **目的**  
  事前定義した “実験シナリオ” を実行し、結果（統計・ログ・スナップショット）を返す。
- **何を提供するか**  
  - broadcast-batch → confirm-batch → metrics → snapshot の一連実行
  - 実行結果の統一フォーマット
- **どんなことに使えるか**  
  - 実験手順の固定化（手順ミス排除）
  - 同条件での繰り返し比較
- **内部的に必要な情報**  
  - シナリオ定義（JSON/YAMLなど）
  - （推奨）非同期ジョブ化（長時間になりやすい）
  - 各utils APIの合成呼び出し

#### Request（例）
```json
{
  "name": "loadtest_basic",
  "params": {
    "chainId": "mdsc",
    "count": 1000,
    "concurrency": 50
  }
}
```

#### Response（例：同期版）
- `200 OK`
```json
{
  "ok": true,
  "data": {
    "name": "loadtest_basic",
    "startedAt": "2026-01-23T12:00:00Z",
    "finishedAt": "2026-01-23T12:05:00Z",
    "result": {
      "broadcast": { "summary": { "total": 1000, "succeeded": 990, "failed": 10, "timeout": 0, "durationMs": 60000, "errors": [] } },
      "confirm": { "summary": { "total": 990, "succeeded": 980, "failed": 10, "timeout": 0, "durationMs": 120000, "errors": [] } },
      "metrics": { "tps": 20.1 },
      "snapshot": { "takenAt": "2026-01-23T12:05:00Z", "system": {}, "chains": [] }
    }
  }
}
```
