# 修正計画書.md（Cryptomeria-BFF v1）  
作成日: 2026-01-23（JST）  
対象: リポジトリ実装（`src/`・`tests/`）と `docs/実験用API/v1/*marged.md` + `docs/実験用API/v1/APIテスト要件書.md` + `APIJOB仕様書.md` の整合性修正

---

## 0. 前提（この計画書での“正”）
- **仕様書の正**: 末尾が `marged` の仕様書（第1層/第2層/第3層）を正とする。
- **テストの正**: `docs/実験用API/v1/APIテスト要件書.md` を正とする（仕様書本文に未記載でも、テスト要件にあるものは実装対象）。
- **ジョブAPIの正**: `APIJOB仕様書.md`（変更前）を正とし、実装はそれに合わせる（不要な改訂はしない）。

---

## 1. 優先度ルール
- **P0（ブロッカー）**: 仕様/テスト要件で必須だが、現状「存在しない」「正しい結果を返さない」「エラーコードが違う」などでテストが成立しないもの
- **P1（重要）**: 互換性/運用上の重要項目（入力スキーマ不一致、レスポンス必須フィールド欠落、キャッシュ仕様逸脱）
- **P2（改善）**: 仕様上推奨・品質項目（キャンセル/タイムアウト伝播、ログ整形など）

差分レベル（ユーザー提示 1〜6）は各項目に付与する。

---

## 2. 修正項目（優先度順）

---

# P0-1. エラーコード体系の統一（Legacy `types/errors.ts` → `lib/errors.ts`）
**差分レベル**: 1（実装はあるが、返すエラーコードが仕様と違い正しい結果にならない）  
**影響範囲**: `/chains/*`, `/observe/*`, `/tx/*`, `/accounts/*`, `CryptomeriaManager` の上流エラー

## 現状の問題
- ルート実装の多くが `src/types/errors.ts`（`INVALID_INPUT`, `BAD_GATEWAY`, `GATEWAY_TIMEOUT` 等）を投げる。
- 仕様/テスト要件は `INVALID_ARGUMENT`, `UPSTREAM_ERROR`, `UPSTREAM_UNAVAILABLE`, `TIMEOUT` 等（`src/lib/errors.ts` 側）を前提。

## 実装方針
- ルート層・Manager層で投げるエラーを **すべて `src/lib/errors.ts` の ApiError** に寄せる。
- `app.ts` の `LegacyApiError` 互換ハンドリングは残してよい（後方互換）。ただし **v1 APIの主要経路は new ApiError へ**。

## 具体的な修正手順
1) ルートの置換
- 対象:
  - `src/routes/accounts.ts`
  - `src/routes/chains.ts`
  - `src/routes/observe.ts`
  - `src/routes/tx.ts`
- 変更:
  - `invalidInputError(...)` → `invalidArgumentError(...)`
  - （必要に応じて）notFound なども `lib/errors.ts` へ統一
- 期待:
  - 400 時の `error.code` が `INVALID_ARGUMENT` になる

2) `src/managers/cryptomeria-manager.ts` の上流エラー統一
- 現状: `badGatewayError`, `gatewayTimeoutError` など Legacy
- 変更:
  - downstream 4xx/5xx → `upstreamError(...)`（502）
  - downstream 到達不可/timeout → `upstreamUnavailableError(...)`（503） or `timeoutError(...)`（504）
  - 観測系で「未確定tx」など上流404は `notFoundError(...)`（404）でOK（ただし tx-confirmation のポーリングでは 404 を “未確定” として扱う）

3) ルート内の `throw new Error(...)` を ApiError に置換（BlocktimeCache など）
- `src/cache/blocktime-cache.ts` の `throw new Error(...)` はルート側で拾えないと 500 になるため、
  - **入力不正はルートでバリデーションして ApiError を投げる**
  - BlocktimeCache 内の Error は「計算不能」扱い（INTERNAL or UPSTREAM_ERROR）にマップする

## テストケース（正常系/異常系）
### 正常系
- 例: `GET /api/v1/chains` が 200 を返すこと（既存テストがあるなら維持）
### 異常系（最重要）
- `GET /api/v1/chains?mode=hoge`
  - 期待: 400 + `error.code=INVALID_ARGUMENT`
- `GET /api/v1/chains/invalid/info`
  - 期待: 400 + `INVALID_ARGUMENT`
- `POST /api/v1/chains/{chainId}/broadcast` で broadcastMode 不正
  - 期待: 400 + `INVALID_ARGUMENT`

---

# P0-2. 第3層 Utilities ジョブの“実装本体”を入れる（6 job types）
**差分レベル**: 1（エンドポイント・ジョブはあるがスタブで正しい結果にならない）  
**対象仕様**: `API第三層仕様書marged.md` / `APIテスト要件書.md`

## 対象ジョブ（type）
- `utils.observe.tx-confirmation`
- `utils.observe.tx-confirmation-batch`
- `utils.metrics.throughput`
- `utils.metrics.resource-snapshot`
- `utils.load.broadcast-batch`
- `utils.load.broadcast-and-confirm`

## 現状の問題
- `src/app.ts` の registerDefinition が **スタブ**（ログ出して固定値返すだけ）
- `src/routes/utils.ts` が入力検証不足（batchサイズ/並列数/timeout/pollInterval など）
- **payload（txBytesBase64List）を job.request に入れていない**ため、実装しても処理できない設計になっている

## 実装方針（重要）
1) **ジョブ実行に必要な payload は保持する**
- ただし `GET /jobs/{jobId}` で秘密/巨大データを返さない
- 解決策（推奨）:
  - job.request には **公開用（軽量・秘匿なし）** を入れる
  - 実payload は jobStore 側の **非公開フィールド**に持たせる（例: `privatePayloadMap: Map<jobId, unknown>`）
  - executor は `jobRunner` に `getPrivatePayload(jobId)` を用意して取り出す  
  ※ 実装コストを抑える代替: job.request に入れて、レスポンス時に redaction する（ただし漏洩リスクが上がる）

2) input 制約は `EnvConfig` と仕様に従い **400/429** を返す
- `maxBatchSize`（default 1000）
- `maxConcurrency`（default 20）
- `maxRunningJobs`（default 10）
- `utils.load.*` の上限別枠（仕様書の推奨）  
  → v1では `maxRunningJobs` と同等でも良いが、可能なら `maxRunningLoadJobs` を追加

3) 返却 result は `API第三層仕様書marged.md` の Job Result 例に合わせる

## 具体的な修正手順
### A. 実装置き場を分離（app.ts を薄くする）
- 新規:
  - `src/jobs/definitions/utils.ts`（Utilities job executors）
  - `src/jobs/definitions/system.ts`（System job executors ※ P0-3 で実施）
- `src/app.ts` の `registerJobDefinitions` では上記関数を呼ぶだけに変更

### B. 並列実行ユーティリティ（依存なし）
- 新規: `src/lib/concurrency.ts`
  - `runPool(items, concurrency, worker, signal)` を実装（Promise pool）
  - signal/cancel/timeout を尊重（`AbortSignal.aborted` を監視）

### C. 各 Utilities ジョブの executor 実装
1) `utils.metrics.throughput`
- 入力:
  - `chainId`, `window(2..2000)`, `mode(auto/exact/estimate)`, `timeoutMs`, `concurrency(default 5)`
- 実装:
  - `latestHeight = cryptomeriaManager.getStatus().syncInfo.latestBlockHeight`
  - `startHeight = endHeight - window + 1`
  - range の block を並列取得（`cryptomeriaManager.getBlock(chainId, height)`）
  - `totalTx = Σ numTxs`
  - `durationSeconds = time(end) - time(start)`
  - `tps = totalTx / durationSeconds`（0除算は INVALID_ARGUMENT か tps=0 に丸める方針を固定）
- result 例:
  - `range{startHeight,endHeight}`, `timeStart`, `timeEnd`, `durationSeconds`, `totalTx`, `tps`, `computedAt`

2) `utils.metrics.resource-snapshot`
- 入力:
  - `namespace`（省略時 EnvConfig or デフォルト）, `include[]`, `timeoutMs`
- 実装:
  - include に応じて:
    - `systemStatus`: `k8sManager.getSystemStatus()`
    - `pods`: `k8sManager.listPods({})`
    - `services`: `k8sManager.listServices({})`
    - `chainsStatus`: `k8sManager.getChainStatuses()` + 各 chain の `cryptomeriaManager.getStatus(chainId)`
- result:
  - `observedAt`, `namespace`, `systemStatus?`, `pods?`, `services?`, `chainsStatus?`

3) `utils.observe.tx-confirmation`
- 入力:
  - `chainId`, `txhash`, `timeoutMs`, `pollIntervalMs`
- 実装:
  - ループで `cryptomeriaManager.getTx(chainId, txhash)` を呼ぶ
  - 404 は未確定扱いで待機継続
  - 200 が来たら confirmed=true として finish（code も返す）
  - abort/timeout は `timeoutError('...')` で failed

4) `utils.observe.tx-confirmation-batch`
- 入力:
  - `chainId`, `txhashes[]`, `timeoutMs`, `pollIntervalMs`, `maxConcurrency`
- 実装:
  - pool で各 txhash を confirm（個別タイムアウトは全体 timeoutMs に従う）
  - result:
    - `summary{total,confirmed,failed,timeout,durationMs}`
    - `items[{txhash,confirmed,code,height,latencyMs}]`

5) `utils.load.broadcast-batch`
- 入力:
  - `chainId`, `txBytesBase64List[]`, `broadcastMode`, `maxConcurrency`, `timeoutMs`, `stopOnFirstError`
- 実装:
  - broadcast を pool 実行
  - `stopOnFirstError=true` の場合は最初の失敗で abort
  - result:
    - `summary{total,succeeded,failed,durationMs}`
    - `items[{index,txhash,ok,error?}]`
- セキュリティ:
  - logs / job detail に txBytesBase64 を出さない（件数と index のみ）

6) `utils.load.broadcast-and-confirm`
- 入力:
  - `chainId`, `txBytesBase64List[]`, `broadcastMode`, `maxConcurrency`, `timeoutMs`, `pollIntervalMs`
- 実装:
  - broadcast-batch → txhash list 取得
  - confirm-batch（同一 txhash list を追跡）
  - result:
    - `summary{total,succeeded,failed,durationMs}`
    - `items[{index,txhash,confirmed,latencyMs,code?}]`

### D. `src/routes/utils.ts` の入力検証を仕様通りに強化
- `txhashes.length <= maxBatchSize`
- `txBytesBase64List.length <= maxBatchSize`
- `maxConcurrency <= config.maxConcurrency`
- `timeoutMs` / `pollIntervalMs` の min/max（負数・過大を弾く）
- `broadcastMode` は `sync|async|commit` のみ

### E. ジョブAPIレスポンスの秘匿・軽量化
- `GET /api/v1/utils/jobs/{jobId}`:
  - job.request は公開用のみ（txBytesBase64List は返さない）
  - どうしても必要なら `txCount` のみを返す

## テストケース（エンドポイント別）
※ テストは `tests/run.ts` を拡張し、要件書の章立て（3.x）に合わせて追加する。

### 3.x Utilities Jobs 共通（正常系）
- `POST /api/v1/utils/metrics/throughput`（window=2）
  - 期待: 202 + `{jobId,type,status,createdAt}`
- `GET /api/v1/utils/jobs/{jobId}`
  - 期待: `status` が `queued→running→succeeded` に遷移（環境依存なので polling 上限を入れる）
- `GET /api/v1/utils/jobs/{jobId}` の `request` に **txBytesBase64List が含まれない**

### 3.x Utilities Jobs 共通（異常系）
- `POST /api/v1/utils/load/broadcast-batch`:
  - `txBytesBase64List.length = maxBatchSize+1`
  - 期待: 400 `INVALID_ARGUMENT`
- `POST /api/v1/utils/observe/tx-confirmation-batch`:
  - `maxConcurrency = config.maxConcurrency+1`
  - 期待: 400 `INVALID_ARGUMENT`
- `maxRunningJobs` を超える同時投下
  - 期待: 429 `RATE_LIMITED`

### 個別（throughput）
- window=1 → 400
- window=2001 → 400
- durationSeconds=0（同一時刻）を人工的に作れるなら → 400 or tps=0（方針に合わせて固定）

### 個別（broadcast-batch / broadcast-and-confirm）
- stopOnFirstError=true:
  - 1件目が失敗するtxBytesを混ぜる（環境依存。難しければ unit test で worker をモック）
  - 期待: items の一部で止まり、job が failed か succeeded+partial（方針固定）

### 個別（tx-confirmation）
- 存在しない txhash:
  - 期待: timeout により job failed + `TIMEOUT`

---

# P0-3. System 操作ジョブ（/system/start /system/connect /system/relayer/restart）を実装
**差分レベル**: 5（エンドポイントも実装もない）＋ 1（job 定義がスタブ）  
**対象仕様**: `API第一層仕様書marged.md` / `APIテスト要件書.md`

## 現状の問題
- `src/routes/system.ts` に `POST /start`, `POST /connect`, `POST /relayer/restart` が無い
- `system.start`, `system.connect` の job executor がスタブで、実際に relayer pod を操作しない
- relayer 稼働判定が `readyならrlyRunning=true` の仮実装（実態チェックがない）

## 実装方針
- Kubernetes API の `pods/exec` を使って relayer pod 内でコマンドを実行する
- 実行コマンドは **環境差が出る**ので、デフォルトを持ちつつ **EnvConfig で上書き可能**にする
- `dryRun`（テスト要件）に対応:
  - `dryRun=true` なら 200 で `plan[]`（stepごとに run/skip と理由）
  - `dryRun=false` なら 202 で job 作成

## 具体的な修正手順
### A. K8s exec 実装
- 追加/修正:
  - `src/managers/k8s-manager.ts`
    - `execInPod({podName, container?, command: string[], timeoutMs, signal?})` を追加
    - stdout/stderr を取得し、失敗時は `k8sUnavailableError` or `timeoutError` を投げる
- 実装のポイント
  - exit code を確実に取るため `bash -lc "<cmd>; echo __EXIT:$?__"` 方式でパースする（推奨）
  - ログへの出力は **stdout全文ではなく要約**（秘密情報混入対策）

### B. Relayer 稼働判定の正確化
- `getRelayerStatus()` で以下を best-effort:
  - ready なら `pgrep -f 'rly'` などでプロセス存在を確認し `rlyRunning` を決める
  - exec が失敗したら fallback として従来ロジック（ready=running）でもよいが、`hint` に不確実性を明記

### C. System routes の追加
- `src/routes/system.ts` に追加:
  - `POST /start`
  - `POST /connect`
  - `POST /relayer/restart`（任意だが要件書にあるので実装推奨）
- 入力バリデーション（要件書優先）
  - `/start`: `{force:boolean, timeoutMs:number, dryRun?:boolean}`
  - `/connect`: `{force:boolean, timeoutMs:number, target:"all"|"chain:<chainId>"}`

### D. system job definitions の実装
- `src/jobs/definitions/system.ts` を新設し、
  - `system.start` steps: `discover`, `initRelayer`, `connectAll`, `startRelayer`, `waitIbcReady`
  - `system.connect` steps: `discover`, `connectAll`
  - `system.relayer.restart` steps: `discover`, `restartRelayer`
- 各 step は `k8sManager.execInPod` を使用
- コマンドは EnvConfig で制御（例）
  - `RELAYER_INIT_CMD`（default: `"/scripts/init-relayer.sh"`）
  - `RELAYER_CONNECT_ALL_CMD`（default: `"/scripts/connect-all.sh"`）
  - `RELAYER_CONNECT_CHAIN_CMD`（default template: `"/scripts/connect-chain.sh {chainId}"`）
  - `RELAYER_START_CMD`（default: `"/scripts/start-relayer.sh"`）
  - `RELAYER_RESTART_CMD`（default: `"/scripts/restart-relayer.sh"` or `pkill rly && rly start ...`）
- `force=false` の冪等判定（最低限）
  - “判定ができない場合は run 扱い”で良い（planに理由を出す）

## テストケース
### 正常系
1) `POST /api/v1/system/start`（dryRun=false）
- 入力: `{"force":false,"timeoutMs":600000,"dryRun":false}`
- 期待: 202 + `{jobId,type,status,createdAt}`

2) `POST /api/v1/system/start`（dryRun=true）
- 入力: `{"force":false,"timeoutMs":600000,"dryRun":true}`
- 期待: 200 + `plan[]`（各stepに `action:run|skip` と `reason`）

3) `POST /api/v1/system/connect`
- 入力: `{"force":false,"timeoutMs":600000,"target":"all"}`
- 期待: 202 + jobId

4) `POST /api/v1/system/relayer/restart`
- 入力: `{"timeoutMs":120000}`
- 期待: 202 + jobId

### 異常系
- timeoutMs < 0 → 400 `INVALID_ARGUMENT`
- target が `"fdsc-0"` のように形式不正 → 400 `INVALID_ARGUMENT`
- system.* ジョブが既に running → 409 `CONFLICT`
- K8s 到達不可 → 503 `K8S_UNAVAILABLE`

### 重要（非機能）
- logs に mnemonic/秘密情報が出ない（stdoutの生出力を避け、要約ログにする）

---

# P0-4. 第2層: broadcast の入力/出力をテスト要件どおりに
**差分レベル**: 1（実装はあるがリクエスト名/レスポンス必須フィールドが欠落）  
**対象**: `POST /api/v1/chains/{chainId}/broadcast`

## 現状の問題
- Request: 仕様/要件は `broadcastMode`、実装は `mode`
- Response: 要件は `txhash,height,code,rawLog,gasWanted,gasUsed`、実装は `{txhash,broadcastResult,observedAt}`

## 実装方針
- Request は後方互換のため `broadcastMode` と `mode` の両対応（優先順位を固定: `broadcastMode` 優先）
- Response は上流（Cosmos SDK）`tx_response` を可能な限りパースして必須フィールドを返す

## 具体的な修正手順
1) `src/types/api.ts`
- `BroadcastRequestSchema` を拡張:
  - `broadcastMode?: enum` と `mode?: enum` を受け付け、正規化して `broadcastMode` を採用

2) `src/managers/cryptomeria-manager.ts`
- broadcastTx の parse を拡張:
  - `tx_response.height`, `tx_response.code`, `tx_response.raw_log`, `tx_response.gas_wanted`, `tx_response.gas_used` を抽出
- `BroadcastResponse` 型を要件に合わせて更新（ただし `broadcastResult` を残すなら optional にしても良い）

3) `src/routes/tx.ts`
- request/response を新形式に合わせて修正

## テストケース
### 正常系
- `POST /chains/{chainId}/broadcast` with `{"txBytesBase64":"...","broadcastMode":"sync"}`
  - 期待: 200 + `txhash,height,code,rawLog,gasWanted,gasUsed`（存在しない場合は空/0でも“フィールドは存在”）
### 異常系
- broadcastMode 不正 → 400 `INVALID_ARGUMENT`
- txBytesBase64 空 → 400 `INVALID_ARGUMENT`
- chainId 不明 → 400 or 404（方針を固定。推奨: chainId形式不正=400、存在しない=404）

---

# P0-5. 第2層: blocks 系の必須フィールドと /blocks/{height}/txs の追加
**差分レベル**:  
- blocks: 1（フィールド名/詳細切替が違う）  
- /txs: 5（エンドポイント自体が無い）  
**対象**: `APIテスト要件書.md` 2.5/2.6/2.7

## 現状の問題
- `GET /blocks/latest` と `GET /blocks/{height}` が:
  - `txCount` ではなく `numTxs`
  - `detail=true` の挙動が無い（常に txHashes を含む）
- `GET /blocks/{height}/txs` が未実装

## 実装方針
- 互換性のため `numTxs` は残しても良いが、**要件の `txCount` を必ず追加**
- `detail` が無い場合は payload を軽くする（txHashes を省略）
- `/txs` は `format=hash|base64` を実装

## 具体的な修正手順
1) `src/managers/cryptomeria-manager.ts`
- `getBlock/getLatestBlock` で txs base64 を捨てているため、`getBlockTxs`（新規）を追加:
  - `format=hash` なら既存の `txHashes` を返す
  - `format=base64` なら block RPC の `txs[]`（base64）を返す

2) `src/routes/observe.ts`
- 追加:
  - `GET /:chainId/blocks/:height/txs`
- 変更:
  - `GET /:chainId/blocks/latest` と `GET /:chainId/blocks/:height`
    - query `detail=true|false` を追加
    - response に `txCount` を追加（= numTxs）
    - detail=false なら `txHashes` を返さない

## テストケース
### 正常系
- `GET /chains/gwc/blocks/latest`
  - 期待: 200 + `height,time,hash,txCount`
- `GET /chains/gwc/blocks/latest?detail=true`
  - 期待: 上記 + `txHashes[]`
- `GET /chains/gwc/blocks/12345/txs?format=hash`
  - 期待: 200 + `height, txs[]`（hash）
- `GET /chains/gwc/blocks/12345/txs?format=base64`
  - 期待: 200 + `height, txs[]`（base64）

### 異常系
- height=abc → 400 `INVALID_ARGUMENT`
- format=json → 400 `INVALID_ARGUMENT`

---

# P1-1. 第2層: /chains と /chains/{chainId}/info のレスポンス整形（pod起点 + include=endpoints）
**差分レベル**: 1（実装はあるがレスポンス構造が仕様/要件と違う）  
**対象**: `API第二層仕様書marged.md` / `APIテスト要件書.md` 2.1/2.2

## 現状の問題
- `/chains` が service(NodePort)起点で `{chains:[...]}` を返す
- 要件は pod 起点で `{items:[{chainId,pod{...}}]}`、`include=endpoints` 時のみ endpoints を付与

## 実装方針
- `k8sManager.getChainStatuses()`（pod一覧）を主ソースにする
- `include=endpoints` の時だけ `k8sManager.resolveChainEndpoints(chainId)` を試みる
  - 失敗しても一覧自体は落とさず、endpoints 欠損で返す

## 具体的な修正手順
- `src/routes/chains.ts`:
  - `/chains` のレスポンスを `itemsResponse` 形式に変更
  - `mode` の enum バリデーション（`external|internal|auto`）
  - `include` で `endpoints` のみサポート（旧include互換は後回しで良いが、少なくとも `include=endpoints` は通す）
- `GET /chains/{chainId}/info`:
  - `cryptomeriaManager.getStatus(chainId)` を呼び、`{chainId, nodeInfo, syncInfo}` を返す

## テストケース
### 正常系
- `GET /chains` → 200 + `items[].chainId` と `pod{name,ready}`
- `GET /chains?include=endpoints` → endpoints が取れた chain に `endpoints{rpc,rest}` が付く
### 異常系
- `mode=hoge` → 400 `INVALID_ARGUMENT`
- k8s 不達 → 503 `UPSTREAM_UNAVAILABLE`（or K8S_UNAVAILABLE。ここは第2層仕様の表現に合わせて固定）

---

# P1-2. 第2層: blocktime の query（useCache/ttlSeconds）とエラー整形
**差分レベル**: 1（実装はあるが query/エラーが要件と不整合）  
**対象**: `APIテスト要件書.md` 2.12

## 現状の問題
- `useCache`, `ttlSeconds` が無い
- blocktime の window 不正時に ApiError ではなく throw Error → 500 になり得る

## 実装方針
- query:
  - `window` default 100
  - `useCache` default true
  - `ttlSeconds` optional（例: 1〜600 の範囲で許可。範囲はコードに固定し、ドキュメント化）
- エラー:
  - window/ttlSeconds 不正は 400 `INVALID_ARGUMENT`
- キャッシュ:
  - 同一 latestHeight で連続呼び出し → `cached=true`

## 具体的な修正手順
- `src/cache/blocktime-cache.ts`
  - `getBlocktime(..., {useCache, ttlMsOverride})` のように拡張
  - useCache=false のときはキャッシュ参照/更新をしない
  - ttl override がある場合は entry.expiresAt を override 値で更新
- `src/routes/chains.ts`
  - query を parse & validate（window, useCache, ttlSeconds）
  - validation で ApiError を投げる（Cache内で throw Error させない）

## テストケース
### 正常系
- `GET /chains/gwc/blocktime` → 200 + `cached` と `computedAt`
- 連続2回（同一latestHeight） → 2回目 `cached=true`
- `ttlSeconds=10` 指定 → 10秒以内に同一latestHeightなら cached=true
### 異常系
- window=1 → 400 `INVALID_ARGUMENT`
- window=2001 → 400
- ttlSeconds=-1 → 400
- ttlSeconds=999999 → 400（許容上限を固定した場合）

---

# P2-1. Job API（APIJOB仕様書.md）細部の整合（limit上限/ログ tail & sinceSeconds）
**差分レベル**: 1（実装はあるが仕様の細部が違う）  
**対象**: `APIJOB仕様書.md`

## 現状の問題（確認できているもの）
- `GET /jobs?limit=` の上限（max=200）が未強制
- `GET /jobs/{jobId}/logs`:
  - tailLines の max=5000 を未強制
  - sinceSeconds に未対応（ログにタイムスタンプ前提）

## 実装方針
- limit/tailLines は上限を enforce し、超過は clamp か INVALID_ARGUMENT（方針固定）
  - 推奨: clamp（安全） + details に `clamped:true`
- sinceSeconds 対応のため、job log は 1行ごとに ISO 時刻 prefix を付ける

## 具体的な修正手順
- `src/jobs/job-store.ts`
  - `appendLog` で `nowISO()` を prefix
  - `getLogs({tailLines,sinceSeconds})` のフィルタリングを追加
- `src/routes/system.ts` / `src/routes/utils.ts`
  - query parse: tailLines/sinceSeconds/limit のバリデーション + clamp

## テストケース
### 正常系
- `GET /api/v1/system/jobs?limit=300` → items が 200 件以内（clamp or 400）
- `GET /api/v1/system/jobs/{jobId}/logs?tailLines=6000` → 5000 以内
- `sinceSeconds=1` → 直近1秒のログだけ（最小限の検証で良い）
### 異常系
- tailLines=-1 → 400 `INVALID_ARGUMENT`
- sinceSeconds=-1 → 400

---

## 3. テスト実装計画（tests/run.ts の増強）—詳細版

### 3.0 ゴール（DoD: テスト側）
- `docs/実験用API/v1/APIテスト要件書.md` の **全H2見出し（1.1〜4.5）**に対応するテスト関数を用意し、
  - **環境非依存（入力バリデーション/エラー形式/エラーコード）**は CI で常に実行・常に PASS が必要
  - **環境依存（K8s/チェーン実動）**は capability 判定 + env フラグで実行/skip を制御
  - **破壊的（load/broadcast 実トランザクション送信、排他/上限、再起動）**は明示フラグが無い限り skip
- 失敗時に「どの章番号/どの観点が壊れたか」がログから即分かる（章番号・観点・期待/実際を出す）

---

### 3.1 実行モード設計（CI/手元/E2E/破壊的）
テストは **“できる範囲だけ回す”** と **“必須環境なら落とす”** を両立させるため、以下のモードを導入する。

#### (A) CI_MIN（常に実行 / 環境非依存のみ）
- 目的: 仕様差分のうち **入力検証・エラー整形・エラーコード**の回帰検知
- 実行対象:
  - すべてのエンドポイントの **異常系（400/404/409/429）**のうち「上流不要」で成立するもの
  - `404 Not Found` / `health`
  - Job API の **NotFound/limit上限/クエリバリデーション**など（上流不要）
- 条件:
  - K8s/チェーンが無くても PASS できる設計にする
  - 上流が必要な正常系は skip

#### (B) E2E_K8S（K8s 必須 / cluster 到達できる環境）
- 実行対象: 1.x（system/k8s）正常系、3.4 resource-snapshot の include の一部など
- 条件:
  - capability で K8s 到達不可なら **SKIP**（ただし `REQUIRE_K8S=1` の場合は **FAIL**）

#### (C) E2E_CHAIN（チェーンRPC 必須 / chainId が生きている環境）
- 実行対象: 2.x（blocks/tx/accounts/simulate/broadcast）正常系、3.1/3.3/3.6 等
- 条件:
  - capability でチェーン到達不可なら **SKIP**（ただし `REQUIRE_CHAIN=1` の場合は **FAIL**）

#### (D) DESTRUCTIVE（実Tx送信・排他/上限・再起動など）
- 実行対象:
  - 2.11 broadcast の **実送信成功**（成功txhashが取れる）
  - 3.5/3.6 load 系（broadcast-batch / broadcast-and-confirm）
  - 4.4 排他/上限テスト（429/409 を出すために並列投下）
  - 4.5 再起動影響テスト（BFF再起動が必要）
- 条件:
  - `RUN_DESTRUCTIVE=1` が無ければ **SKIP**
  - さらに負荷系は `RUN_LOAD=1` が必要（誤爆防止）

---

### 3.2 Env / Config の詳細（tests/config.ts を拡張）
既存の env に加えて「実行モード」と「必須扱い」を明示できるようにする。

#### 追加/整理する env（提案）
- 接続・認証
  - `BASE_URL`（既存）
  - `AUTH_TOKEN`（既存）
- 対象指定
  - `CHAIN_ID`（既存）
  - `NAMESPACE`（追加、default: `cryptomeria`）
- テストデータ（環境依存テストのキー）
  - `TEST_ADDRESS`（既存）
  - `TEST_BLOCK_HEIGHT`（既存）
  - `TEST_TXHASH`（既存）
  - `DUMMY_TX_BYTES`（既存）
  - `VALID_TX_BYTES`（追加: 実際に通る署名済Tx。DESTRUCTIVE のみ使用）
- モードフラグ
  - `RUN_E2E=1`（E2E_K8S/E2E_CHAIN を有効化）
  - `RUN_DESTRUCTIVE=1`（破壊的を有効化）
  - `RUN_LOAD=1`（負荷系を有効化。RUN_DESTRUCTIVE の下位）
  - `RUN_LIMIT_TESTS=1`（4.4 の上限/排他を有効化。RUN_DESTRUCTIVE の下位）
  - `RUN_RESTART_TESTS=1`（4.5 再起動テストを有効化。RUN_DESTRUCTIVE の下位）
- 必須扱い（skip ではなく fail にする）
  - `REQUIRE_K8S=1`
  - `REQUIRE_CHAIN=1`
- タイムアウト
  - `TIMEOUT_MS`（既存: request timeout）
  - `JOB_POLL_INTERVAL_MS`（追加、default 500）
  - `JOB_WAIT_TIMEOUT_MS`（追加、default 60_000）
  - `TX_CONFIRM_TIMEOUT_MS`（追加、default 300_000）

#### config.ts の拡張案（フィールド）
- `namespace`
- `runE2E`, `runDestructive`, `runLoad`, `runLimitTests`, `runRestartTests`
- `requireK8s`, `requireChain`
- `jobPollIntervalMs`, `jobWaitTimeoutMs`, `txConfirmTimeoutMs`
- `validTxBytes?`（optional）

---

### 3.3 テスト共通ユーティリティの追加（tests/utils.ts 拡張）
現状は `request()` と `hasField()` しかないため、「章番号に沿った粒度のアサート」と「skip判定」「ジョブ待機」を共通化する。

#### 追加する helper（必須）
1) **capability 判定**
- `detectCapabilities(config) -> { k8sOk, chainOk, authOk, serverOk }`
  - serverOk: `GET /health` 200
  - authOk: `GET /api/v1/system/jobs` が 200 か、AUTH_DISABLED 時は includeAuth=false で 200 か、など
  - k8sOk: `GET /api/v1/system/status` が 200（または 503 を k8sOk=false とみなす）
  - chainOk: `GET /api/v1/chains/{chainId}/status` が 200

2) **env 必須チェック → skip/fail を統一**
- `requireValue(counter, label, value, {required:boolean})`
  - 未設定なら `required=true` で FAIL、そうでなければ SKIP

3) **エラー形式/エラーコードのアサート**
- `expectError(counter, res, {httpStatus, code})`
  - `res.body.error.code === code` を検証
  - 失敗時は “期待/実際” と bodyText を出す

4) **JSONフィールドのアサート**
- `expectFields(counter, res.body, ["ok","data.namespace",...])`
  - ドットパス対応（`data.namespace`）

5) **ジョブ生成→完了待機（最重要）**
- `createJob(config, path, body) -> jobId`
- `waitJob(config, jobPath, {timeoutMs,pollIntervalMs, acceptStatuses}) -> finalJob`
  - `status` が `succeeded|failed|cancelled` になるまで poll
  - timeout で FAIL（ただし E2E で require が無ければ SKIP も可）
- `waitJobStepChanges(finalJob)` のように steps の存在/遷移を確認（4.2 の一部）

6) **破壊的テスト用の “安全ブレーキ”**
- `guardDestructive(config, counter, reason)`
  - `RUN_DESTRUCTIVE!=1` の場合は SKIP に統一

#### request() の拡張（推奨）
- `request(config, method, path, body, includeAuth, timeoutOverrideMs?)`
  - job待機や logs 取得は長めにしたい場合があるため

---

### 3.4 run.ts の構造（章番号に対応させる）
現状カテゴリ（layer1/layer2/layer3/jobs）は維持しつつ、各カテゴリ内で **要件書の章番号単位**に関数を切る。

- `testLayer1()` 内
  - `test_1_1_system_status()`
  - `test_1_2_system_preflight()`
  - ...
  - `test_1_12_system_jobs_common()`
- `testLayer2()` 内
  - `test_2_1_chains_list()`
  - ...
  - `test_2_12_blocktime()`
- `testLayer3()` 内
  - `test_3_1_tx_confirmation_job()`
  - ...
  - `test_3_7_utils_jobs_common()`
- `testJobsTests()` 内（4.x）
  - `test_4_1_state_transition()`
  - ...
  - `test_4_5_restart_impact()`

さらに、main 開始直後に `capabilities = await detectCapabilities(config)` を取って全テストに渡す。

---

### 3.5 章番号別・詳細テスト設計（APIテスト要件書.md 準拠）
以下は「何を追加するか」を **章番号ごと**に、**正常系/異常系**と **skip条件**まで落とした実装計画。

---

#### 0. 共通（全API横断）— CI_MINで常に実行
**目的**: 仕様の根幹（エラー形式・機密非露出・Content-Type）を守れているか

- (0-A) Content-Type（JSON系）
  - 任意のJSON系 endpoint（例: `/api/v1/chains`）で `content-type` に `application/json` を含む
- (0-B) エラー形式（400/404/409/429/502/503）
  - `/api/v1/nonexistent` → 404 で `{"error":{code,message,details}}`
  - `GET /api/v1/chains/invalid/info` → 400 で `error.code=INVALID_ARGUMENT`
- (0-C) 機密の非露出（簡易）
  - レスポンス文字列に `kubeconfig|token|mnemonic|private|seed|txBytes` 等が含まれない（単純な substring check）
  - ※ false positive を避けるため “検出したら FAIL” 程度のライトチェック

---

#### 1.x System/K8s — E2E_K8S（RUN_E2E=1）で実行、無ければSKIP（REQUIRE_K8S=1ならFAIL）
**1.1 GET /system/status**
- 正常系（k8sOk=true）
  - 200, `data.namespace`, `data.summary.*`, `data.relayer.*`, `data.chains[]` の最小チェック
  - `?verbose=true` で追加フィールドが増える（増えない場合は WARN 相当か PASS でよい：要件が “増える” なので）
- 異常系（CI_MIN）
  - query 不正（`verbose=hoge`）→ 400 INVALID_ARGUMENT（実装がstrictなら追加）

**1.4〜1.8 K8s リソース**
- 正常系（k8sOk=true）
  - pods/services/endpoints/configmaps/logs それぞれ 200 + `items`
  - logs: `tailLines` の上限や負数 → 400
- 異常系（CI_MIN）
  - `tailLines=-1` → 400 INVALID_ARGUMENT
  - `sinceSeconds=-1`（仕様にある場合）→ 400

**1.9 /system/start, 1.10 /system/connect, 1.11 /relayer/restart**
- 正常系（RUN_E2E=1 かつ k8sOk=true）
  - `dryRun=true` → 200 + plan
  - `dryRun=false` → 202 + jobId → waitJob で succeeded/failed/cancelled のいずれか終端確認
- 異常系（CI_MIN）
  - `timeoutMs=-1` → 400 INVALID_ARGUMENT
  - `target="bad"` → 400 INVALID_ARGUMENT
- 排他（4.4 と連携、RUN_LIMIT_TESTS=1）
  - start/connect を同時2回投下 → 409 or 429（仕様に合わせる）

**1.12 System Jobs（共通）**
- CI_MINで常に実行（上流不要）
  - `GET /system/jobs` → 200 + items
  - `GET /system/jobs/nonexistent` → 404
  - `POST /system/jobs/nonexistent/cancel` → 404
- E2E_K8Sで追加
  - 1.9/1.10 で作った jobId の logs が取れる

---

#### 2.x Blockchain — E2E_CHAIN（RUN_E2E=1）で実行、無ければSKIP（REQUIRE_CHAIN=1ならFAIL）
**2.1 GET /chains**
- 正常系（chainOk=true）
  - 200 + `items[]`（仕様どおりに修正後）
  - `include=endpoints` の有無でフィールド差分チェック（include無しでは endpoints 無い）
- 異常系（CI_MIN）
  - `mode=hoge` → 400 INVALID_ARGUMENT
  - `include=hoge` → 400 INVALID_ARGUMENT

**2.5/2.6 blocks、2.7 /txs**
- 正常系（chainOk=true かつ TEST_BLOCK_HEIGHT が実在）
  - `GET /blocks/latest` → `height,time,hash,txCount`（detailで txHashes）
  - `GET /blocks/{height}` 同様
  - `GET /blocks/{height}/txs?format=hash|base64` → 200
- 異常系（CI_MIN）
  - height=abc → 400 INVALID_ARGUMENT
  - format=bad → 400

**2.8 tx, 2.9 accounts**
- 正常系（chainOk=true かつ TEST_TXHASH/TEST_ADDRESS が実在）
  - tx: 200 + `txhash,height,code` 等
  - accounts: 200 + `address,accountNumber,sequence`（要件に合わせる）
- 異常系（CI_MIN）
  - txhash形式不正 → 400 INVALID_ARGUMENT
  - address形式不正 → 400 INVALID_ARGUMENT

**2.10 simulate**
- 正常系（chainOk=true、ただし実Txが必要）
  - RUN_DESTRUCTIVE=1 でのみ実行推奨（VALID_TX_BYTESが必要）
- 異常系（CI_MIN）
  - txBytesBase64 が base64でない → 400

**2.11 broadcast**
- CI_MIN（上流不要の異常系）
  - broadcastMode 不正 → 400
  - txBytesBase64 不正 → 400
- DESTRUCTIVE（RUN_DESTRUCTIVE=1 & VALID_TX_BYTESあり）
  - 正常系: 200 + `txhash,height,code,rawLog,gasWanted,gasUsed`（field存在チェック）
  - 異常系: upstream error → 502/503（分類を確認）

**2.12 blocktime**
- 正常系（chainOk=true）
  - 200 + stats + cached + computedAt
  - `useCache=false` 指定時は cached=false を期待（修正後）
  - `ttlSeconds` 指定の挙動（短時間で2回呼び出し）
- 異常系（CI_MIN）
  - window=1 → 400
  - ttlSeconds=-1 → 400

---

#### 3.x Utilities（ジョブ）— 基本は E2E_CHAIN / E2E_K8S、ただし入力異常系は CI_MIN
**共通（全ジョブ）**
- CI_MINで常に実行
  - window=1, maxConcurrency超過, batchSize超過, timeoutMs負数 等 → 400 INVALID_ARGUMENT
  - maxRunningJobs 超過 → 429（これは 4.4 へ。RUN_LIMIT_TESTS=1 のみ）
- E2Eで実行
  - 202 で jobId → waitJob で終端 → result の必須フィールド確認

**3.1 tx-confirmation**
- 異常系（CI_MIN）
  - timeoutMs=0 → 400
  - pollIntervalMs=0 → 400
- 正常系（E2E_CHAIN & TEST_TXHASH 実在）
  - confirmed=true, latencyMs 等
- 異常系（E2E_CHAIN & 存在しないtxhash）
  - timeout → TIMEOUT（ジョブ failed）or confirmed=false（仕様方針に従って判定）

**3.2 tx-confirmation-batch**
- CI_MIN
  - txhashes.length=maxBatchSize+1 → 400
  - maxConcurrency=max+1 → 400
- E2E_CHAIN
  - items と summary の整合（total=succeeded+failed(+timeout)）

**3.3 throughput**
- CI_MIN
  - window=1 → 400（既存あり、error.code まで確認に強化）
- E2E_CHAIN
  - result に `range/timeStart/timeEnd/durationSeconds/totalTx/tps/computedAt` が必ずある
  - durationSeconds>0 のとき tps が NaN/Infinity でない

**3.4 resource-snapshot**
- CI_MIN
  - include が配列でない → 400
- E2E_K8S
  - include の組合せで返却フィールドが変わる（systemStatus/pods/services/chainsStatus）
  - best-effort: 一部取得失敗しても job が破綻しない（notes 等の確認）

**3.5 broadcast-batch / 3.6 broadcast-and-confirm**
- CI_MIN
  - batchSize/maxConcurrency/txBytes不正 → 400
- DESTRUCTIVE（RUN_DESTRUCTIVE=1 & RUN_LOAD=1 & VALID_TX_BYTESあり）
  - summary/items の整合、stopOnFirstError の挙動（可能なら）

**3.7 Utils Jobs（共通）**
- CI_MIN
  - list/get/notfound/cancel-notfound
- E2E
  - logs（tailLines/sinceSeconds）動作

---

#### 4.x Jobs（共通）— 4.1/4.3 は E2E 推奨、4.4/4.5 は破壊的
**4.1 状態遷移**
- E2E（RUN_E2E=1）
  - resource-snapshot など軽い job を作成し、
    - queued → running → succeeded/failed のどれかに到達すること
  - “途中状態が観測できない”場合もあるため、
    - 途中の観測は WARN 扱い、最終終端は必須にする

**4.2 ステップ状態**
- E2E（RUN_E2E=1）
  - job.steps が存在し、少なくとも 1 step が `succeeded|running|failed` を持つ
  - step status enum が仕様どおりか（pending/skipped/canceled 等）を確認（修正後に厳格化）

**4.3 ログ**
- E2E（RUN_E2E=1）
  - logs が 200
  - `tailLines` の上限・負数で 400
  - `sinceSeconds` があるならフィルタが効く

**4.4 排他/上限**
- RUN_DESTRUCTIVE=1 & RUN_LIMIT_TESTS=1 必須
  - maxRunningJobs 超過で 429
  - system.start/connect の排他で 409（仕様に合わせる）
  - utils.load.* の別枠上限（実装するなら）もテスト

**4.5 再起動影響（インメモリ消失）**
- RUN_DESTRUCTIVE=1 & RUN_RESTART_TESTS=1 必須
- これは **run.ts 単体ではBFF再起動できない**ため、2段階方式にする：
  - Phase1（run.ts）: jobId を作って `tests/.artifacts/lastJobId.json` に保存して終了
  - Phase2（CIのworkflowや scripts）: BFF再起動後に `GET /jobs/{jobId}` が 404 になることを確認
- 実装案:
  - `scripts/test-restart.sh` を追加し、docker compose か systemctl 等でBFFを再起動してPhase2を実行

---

### 3.6 SKIP/FAIL のルール（ブレ防止）
- `REQUIRE_K8S=1` なのに k8sOk=false → **FAIL**
- `REQUIRE_CHAIN=1` なのに chainOk=false → **FAIL**
- `RUN_E2E!=1` の E2E テスト → **SKIP**
- `RUN_DESTRUCTIVE!=1` の破壊的テスト → **SKIP**
- それ以外は基本 **FAIL**（仕様違反を見逃さない）

---

### 3.7 追加する CLI（運用性）
- 既存カテゴリに加え、以下のスイッチを追加（任意だが有用）
  - `yarn test --ci-min`（CI_MIN だけ実行）
  - `yarn test --e2e`（RUN_E2E=1相当）
  - `yarn test --destructive`（RUN_DESTRUCTIVE=1相当）
- ただし env での制御を主とし、CLI は補助にする（CI設定をシンプルにするため）

---

### 3.8 実装タスク分割（迷わない順番）
1) `tests/utils.ts` に helper 追加（capability / expectError / waitJob 等）
2) `tests/run.ts` に capability 判定導入・章番号関数の枠だけ作る
3) **CI_MIN**（異常系中心）を 1.x/2.x/3.x/4.x の全章に広げる（ここが最優先）
4) E2E_K8S（1.x）を増やす
5) E2E_CHAIN（2.x/3.x）を増やす（TEST_BLOCK_HEIGHT/TEST_TXHASH が必須）
6) 破壊的（4.4/4.5/3.5/3.6/2.11 成功系）を “最後” に追加

---

### 3.9 期待する最終的なカバレッジ（最低ライン）
- CI_MIN: 37章のうち「異常系・形式・エラーコード」のテストが **全章で最低1本以上**ある
- RUN_E2E=1: 1.x/2.x/3.x の **正常系が主要エンドポイントで通る**
- RUN_DESTRUCTIVE=1: load/broadcast/上限/再起動のテストが **明示的に回る**

---

## 4. 受け入れ条件（Definition of Done）
- APIテスト要件書に記載の以下が通る（最低ライン）
  - System: `/system/start`（dryRun含む）、`/system/connect`、任意だが `/relayer/restart`
  - L2: `/chains`（pod起点 + include=endpoints）、`/info`、`/blocktime`（useCache/ttlSeconds）、blocks と /txs、broadcast（入力/出力）
  - Utilities: 6 job type がスタブでなく、result を仕様例どおりに返す
- エラーコードが `INVALID_ARGUMENT / NOT_FOUND / CONFLICT / UPSTREAM_ERROR / UPSTREAM_UNAVAILABLE / TIMEOUT / RATE_LIMITED` に揃う
- job detail/ログに txBytesBase64 等の巨大・秘匿情報が露出しない

---
