/**
 * K8sManager - Kubernetes操作マネージャー
 *
 * NodePort Serviceの動的解決を提供する
 */
import * as k8s from '@kubernetes/client-node';
import { extractChainId } from '../types/chains.js';
import { badGatewayError, notFoundError, gatewayTimeoutError } from '../types/errors.js';
/**
 * K8sManager
 */
export class K8sManager {
    k8sApi;
    namespace;
    nodeHost;
    cacheTtlMs;
    timeoutMs;
    /** endpoint解決結果キャッシュ */
    endpointCache = new Map();
    /** Service一覧キャッシュ */
    servicesCache = null;
    constructor(config) {
        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
        this.namespace = config.k8sNamespace;
        this.nodeHost = config.nodeHost;
        this.cacheTtlMs = config.endpointCacheTtlMs;
        this.timeoutMs = config.downstreamTimeoutMs;
    }
    /**
     * Cryptomeria関連のServiceを列挙
     */
    async listChainServices() {
        // キャッシュ確認
        if (this.servicesCache && Date.now() < this.servicesCache.expiresAt) {
            return this.servicesCache.data;
        }
        try {
            const response = await this.k8sApi.listNamespacedService(this.namespace, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, Math.ceil(this.timeoutMs / 1000));
            const chains = [];
            for (const service of response.body.items) {
                const serviceName = service.metadata?.name;
                if (!serviceName || !serviceName.startsWith('cryptomeria-')) {
                    continue;
                }
                // NodePort Serviceのみ対象
                if (service.spec?.type !== 'NodePort') {
                    continue;
                }
                const chainId = extractChainId(serviceName);
                if (chainId) {
                    chains.push({ chainId, serviceName });
                }
            }
            // キャッシュ更新
            this.servicesCache = {
                data: chains,
                expiresAt: Date.now() + this.cacheTtlMs,
            };
            return chains;
        }
        catch (error) {
            if (this.isTimeoutError(error)) {
                throw gatewayTimeoutError('Kubernetes API timeout');
            }
            throw badGatewayError('Failed to list Kubernetes services', {
                error: String(error),
            });
        }
    }
    /**
     * 指定chainIdのendpointを解決
     */
    async resolveChainEndpoints(chainId) {
        // キャッシュ確認
        const cached = this.endpointCache.get(chainId);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.data;
        }
        const serviceName = `cryptomeria-${chainId}`;
        try {
            const response = await this.k8sApi.readNamespacedService(serviceName, this.namespace);
            const service = response.body;
            if (service.spec?.type !== 'NodePort') {
                throw notFoundError('Service is not NodePort type', { chainId, serviceName });
            }
            const ports = service.spec?.ports ?? [];
            const endpoints = {
                chainId,
                serviceName,
                resolvedAt: new Date(),
            };
            // port名でapi/rpc/grpcを判別
            for (const port of ports) {
                const portName = port.name?.toLowerCase();
                const nodePort = port.nodePort;
                if (!nodePort)
                    continue;
                if (portName === 'api' || portName === 'rest') {
                    endpoints.apiNodePort = nodePort;
                    endpoints.restBase = `http://${this.nodeHost}:${nodePort}`;
                }
                else if (portName === 'rpc') {
                    endpoints.rpcNodePort = nodePort;
                    endpoints.rpcBase = `http://${this.nodeHost}:${nodePort}`;
                    endpoints.wsRpcUrl = `ws://${this.nodeHost}:${nodePort}/websocket`;
                }
                else if (portName === 'grpc') {
                    endpoints.grpcNodePort = nodePort;
                    endpoints.grpcAddr = `${this.nodeHost}:${nodePort}`;
                }
            }
            // apiポートは必須
            if (!endpoints.apiNodePort) {
                throw badGatewayError('Service missing required api port', {
                    chainId,
                    serviceName,
                    availablePorts: ports.map((p) => p.name),
                });
            }
            // キャッシュ更新
            this.endpointCache.set(chainId, {
                data: endpoints,
                expiresAt: Date.now() + this.cacheTtlMs,
            });
            return endpoints;
        }
        catch (error) {
            // すでにApiErrorの場合はそのままthrow
            if (error instanceof Error && error.name === 'ApiError') {
                throw error;
            }
            if (this.isNotFoundError(error)) {
                throw notFoundError('Chain service not found', { chainId });
            }
            if (this.isTimeoutError(error)) {
                throw gatewayTimeoutError('Kubernetes API timeout');
            }
            throw badGatewayError('Failed to resolve chain endpoints', {
                chainId,
                error: String(error),
            });
        }
    }
    /**
     * ChainEndpointsをChainInfoに変換
     */
    endpointsToInfo(endpoints) {
        const info = {
            chainId: endpoints.chainId,
            serviceName: endpoints.serviceName,
            restBase: endpoints.restBase,
            rpcBase: endpoints.rpcBase ?? endpoints.restBase,
        };
        if (endpoints.wsRpcUrl) {
            info.wsRpcUrl = endpoints.wsRpcUrl;
        }
        if (endpoints.grpcAddr) {
            info.grpcAddr = endpoints.grpcAddr;
        }
        return info;
    }
    /**
     * 全チェーンのendpointを解決
     */
    async resolveAllEndpoints() {
        const chains = await this.listChainServices();
        const results = new Map();
        for (const chain of chains) {
            try {
                const endpoints = await this.resolveChainEndpoints(chain.chainId);
                results.set(chain.chainId, endpoints);
            }
            catch {
                // 個別エラーは無視して続行
                console.warn(`Failed to resolve endpoints for ${chain.chainId}`);
            }
        }
        return results;
    }
    /**
     * キャッシュをクリア
     */
    clearCache() {
        this.endpointCache.clear();
        this.servicesCache = null;
    }
    /**
     * タイムアウトエラー判定
     */
    isTimeoutError(error) {
        if (error instanceof Error) {
            return error.message.includes('timeout') || error.message.includes('ETIMEDOUT');
        }
        return false;
    }
    /**
     * Not Foundエラー判定
     */
    isNotFoundError(error) {
        if (error && typeof error === 'object' && 'response' in error) {
            const response = error.response;
            return response?.statusCode === 404;
        }
        return false;
    }
}
//# sourceMappingURL=k8s-manager.js.map