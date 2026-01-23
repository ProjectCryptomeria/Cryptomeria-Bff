/**
 * ポートフォワードマネージャー
 *
 * 開発環境(devcontainer)において、K8sクラスタ内のServiceに
 * ローカルからアクセスできるようにポートフォワードを管理するクラス。
 *
 * K8s上のService定義からNodePortを動的に取得し、
 * localhostの同一番号ポートからServiceへ転送を行う。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { K8sManager } from './k8s-manager.js';

interface ForwardTarget {
    local: number;
    target: number;
    name: string;
}

export class PortForwardManager {
    private processes: ChildProcess[] = [];
    private k8sManager: K8sManager;

    constructor(k8sManager: K8sManager) {
        this.k8sManager = k8sManager;
    }

    /**
     * ポートフォワードを開始する
     */
    public async start(): Promise<void> {
        const namespace = this.k8sManager.getNamespace();
        console.log(`🔌 Starting dynamic port-forward for Namespace: ${namespace}...`);

        // 既存のプロセスがあれば停止
        this.stop();

        try {
            // 1. K8sからチェーンのService一覧を取得
            const chains = await this.k8sManager.listChainServices();

            if (chains.length === 0) {
                console.warn('⚠️ No chain services found. Skipping port-forward.');
                return;
            }

            // 2. 各チェーンのService詳細(NodePort等)を解決してフォワード開始
            for (const chain of chains) {
                await this.setupChainForward(chain.chainId, chain.serviceName);
            }

            console.log(`✅ Port-forward started for ${this.processes.length} ports across ${chains.length} chains.`);

        } catch (error) {
            console.error('❌ Failed to discover services for port-forward:', error);
            // 致命的なエラーではないため、サーバー起動は妨げない
        }
    }

    /**
     * チェーンごとのフォワード設定を行う
     * K8sManagerを使って実際のNodePortを取得する
     */
    private async setupChainForward(chainId: string, serviceName: string): Promise<void> {
        try {
            // K8sManagerの既存ロジック(resolveChainEndpoints)を利用して
            // Serviceに設定されている本物のNodePortを取得する
            const endpoints = await this.k8sManager.resolveChainEndpoints(chainId);
            const targets: ForwardTarget[] = [];

            // API (REST)
            if (endpoints.apiNodePort) {
                targets.push({ name: 'REST', local: endpoints.apiNodePort, target: 1317 });
            }
            // RPC
            if (endpoints.rpcNodePort) {
                targets.push({ name: 'RPC', local: endpoints.rpcNodePort, target: 26657 });
            }
            // gRPC
            if (endpoints.grpcNodePort) {
                targets.push({ name: 'gRPC', local: endpoints.grpcNodePort, target: 9090 });
            }

            // プロセス起動
            this.spawnForwardProcesses(serviceName, chainId, targets);

        } catch (error) {
            console.warn(`⚠️ Failed to resolve endpoints for ${chainId}:`, error);
        }
    }

    /**
     * kubectlプロセスを起動する
     */
    private spawnForwardProcesses(serviceName: string, chainId: string, targets: ForwardTarget[]): void {
        const namespace = this.k8sManager.getNamespace();

        for (const t of targets) {
            // kubectl port-forward -n <namespace> svc/<service> <local>:<target>
            const args = [
                'port-forward',
                '-n',
                namespace,
                `svc/${serviceName}`,
                `${t.local}:${t.target}`,
            ];

            const child = spawn('kubectl', args, {
                stdio: 'ignore',
                detached: false,
            });

            child.on('error', (err: Error) => {
                console.error(
                    `❌ Failed to start port-forward for ${serviceName} (${t.local}:${t.target}):`,
                    err.message
                );
            });

            this.processes.push(child);
            console.log(`  → ${chainId} (${t.name}): localhost:${t.local} → ${t.target}`);
        }
    }

    /**
     * 全てのポートフォワードプロセスを停止する
     */
    public stop(): void {
        if (this.processes.length === 0) {
            return;
        }

        console.log('🛑 Stopping port-forward processes...');

        for (const child of this.processes) {
            if (child.pid && !child.killed) {
                try {
                    process.kill(child.pid);
                } catch (e) {
                    // ignore
                }
            }
        }

        this.processes = [];
        console.log('✅ Port-forward stopped.');
    }
}