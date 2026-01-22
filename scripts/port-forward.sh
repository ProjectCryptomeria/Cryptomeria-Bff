#!/bin/bash
# Cryptomeria-Bff port-forward script
# devcontainer環境でK8s NodePortサービスにアクセスするためのポートフォワーディング
#
# 使用方法:
#   yarn port-forward    # 全チェーンのport-forwardを開始
#   Ctrl+C              # 終了
#
set -e

NAMESPACE="${K8S_NAMESPACE:-cryptomeria}"

echo "🔌 Starting port-forward for Cryptomeria chains..."
echo "   Namespace: ${NAMESPACE}"
echo ""

# 既存のport-forwardプロセスをクリーンアップ
cleanup() {
    echo ""
    echo "🛑 Stopping port-forward..."
    pkill -P $$ 2>/dev/null || true
    wait 2>/dev/null || true
    echo "✅ Port-forward stopped."
}
trap cleanup EXIT INT TERM

# チェーンごとのポートフォワード設定
# 形式: サービス名:ローカルポート:ターゲットポート
FORWARDS=(
    # gwc chain
    "cryptomeria-gwc:30003:1317"   # REST API
    "cryptomeria-gwc:30007:26657"  # RPC
    "cryptomeria-gwc:30000:9090"   # gRPC
    
    # fdsc-0 chain
    "cryptomeria-fdsc-0:30023:1317"
    "cryptomeria-fdsc-0:30027:26657"
    "cryptomeria-fdsc-0:30020:9090"
    
    # mdsc chain
    "cryptomeria-mdsc:30013:1317"
    "cryptomeria-mdsc:30017:26657"
    "cryptomeria-mdsc:30010:9090"
)

PIDS=()

for forward in "${FORWARDS[@]}"; do
    IFS=':' read -r service local_port target_port <<< "$forward"
    
    echo "  → ${service}: localhost:${local_port} → ${target_port}"
    kubectl port-forward -n "${NAMESPACE}" "svc/${service}" "${local_port}:${target_port}" &>/dev/null &
    PIDS+=($!)
done

echo ""
echo "✅ Port-forward started for ${#FORWARDS[@]} ports."
echo ""
echo "📋 Available endpoints:"
echo "   gwc:     REST=http://localhost:30003  RPC=http://localhost:30007"
echo "   fdsc-0:  REST=http://localhost:30023  RPC=http://localhost:30027"
echo "   mdsc:    REST=http://localhost:30013  RPC=http://localhost:30017"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# 全てのバックグラウンドプロセスを待機
wait
