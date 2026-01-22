/**
 * K8sManager - Kubernetes操作マネージャー
 * 
 * NodePort Serviceの動的解決を提供する
 * 第1層API仕様書に準拠したK8s操作を追加
 */

import * as k8s from '@kubernetes/client-node';
import type { EnvConfig } from '../config/env.js';
import type { ChainSummary, ChainEndpoints, ChainInfo } from '../types/chains.js';
import { extractChainId } from '../types/chains.js';
import { k8sUnavailableError, notFoundError, timeoutError } from '../lib/errors.js';

// ===== 型定義 =====

interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

interface PodInfo {
	name: string;
	namespace: string;
	labels: Record<string, string>;
	phase: string;
	ready: boolean;
	restarts: number;
	podIP: string | undefined;
	containers?: ContainerInfo[];
}

interface ContainerInfo {
	name: string;
	ready: boolean;
	restartCount: number;
	state: string;
}

interface ServiceInfo {
	name: string;
	type: string;
	clusterIP: string | undefined;
	ports: PortInfo[];
	selector: Record<string, string>;
}

interface PortInfo {
	name: string | undefined;
	port: number;
	nodePort: number | undefined;
	protocol: string;
}

interface EndpointInfo {
	name: string;
	subsets: SubsetInfo[];
}

interface SubsetInfo {
	addresses: { ip: string }[];
	ports: { name: string; port: number; protocol: string }[];
}

interface ConfigMapInfo {
	name: string;
	keys: string[];
	data?: Record<string, string>;
}

interface SystemSummary {
	podsTotal: number;
	podsReady: number;
	podsNotReady: number;
	restartsTotal: number;
}

interface RelayerStatus {
	podName: string | null;
	ready: boolean;
	rlyRunning: boolean;
	hint?: string;
}

interface ChainStatus {
	chainId: string;
	podName: string;
	ready: boolean;
}

interface PreflightCheck {
	name: string;
	ok: boolean;
	details?: Record<string, unknown>;
}

interface Topology {
	chains: TopologyChain[];
	relayer: { pod: { name: string; ready: boolean } } | null;
}

interface TopologyChain {
	chainId: string;
	pod: { name: string; ip: string | undefined; ready: boolean };
	service: { name: string; type: string } | null;
	ports: PortInfo[];
}

interface ChainPort {
	chainId: string;
	external: { rpc?: string; api?: string; grpc?: string };
	internal: { rpc?: string; api?: string; grpc?: string };
}

// ===== K8sManager =====

export class K8sManager {
	private readonly k8sApi: k8s.CoreV1Api;
	private readonly namespace: string;
	private readonly nodeHost: string;
	private readonly cacheTtlMs: number;
	private readonly timeoutMs: number;

	private endpointCache: Map<string, CacheEntry<ChainEndpoints>> = new Map();
	private servicesCache: CacheEntry<ChainSummary[]> | null = null;

	constructor(config: EnvConfig) {
		const kc = new k8s.KubeConfig();
		kc.loadFromDefault();

		this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
		this.namespace = config.k8sNamespace;
		this.nodeHost = config.nodeHost;
		this.cacheTtlMs = config.endpointCacheTtlMs;
		this.timeoutMs = config.downstreamTimeoutMs;
	}

	// ===== Getters =====

	getNamespace(): string {
		return this.namespace;
	}

	getNodeHost(): string {
		return this.nodeHost;
	}

	// ===== System Status Methods =====

	async getSystemStatus(): Promise<SystemSummary> {
		const pods = await this.listPods({});
		let podsReady = 0;
		let restartsTotal = 0;

		for (const pod of pods) {
			if (pod.ready) podsReady++;
			restartsTotal += pod.restarts;
		}

		return {
			podsTotal: pods.length,
			podsReady,
			podsNotReady: pods.length - podsReady,
			restartsTotal,
		};
	}

	async getRelayerStatus(): Promise<RelayerStatus> {
		const pods = await this.listPods({ selector: 'app.kubernetes.io/component=relayer' });

		if (pods.length === 0) {
			// Fallback: name containing 'relayer'
			const allPods = await this.listPods({});
			const relayerPod = allPods.find((p) => p.name.includes('relayer'));

			if (!relayerPod) {
				return { podName: null, ready: false, rlyRunning: false };
			}

			return {
				podName: relayerPod.name,
				ready: relayerPod.ready,
				rlyRunning: relayerPod.ready, // Assume running if ready
				hint: 'use /system/jobs/* for workflow logs',
			};
		}

		const relayerPod = pods[0];
		return {
			podName: relayerPod.name,
			ready: relayerPod.ready,
			rlyRunning: relayerPod.ready,
			hint: 'use /system/jobs/* for workflow logs',
		};
	}

	async getChainStatuses(): Promise<ChainStatus[]> {
		const pods = await this.listPods({});
		const chains: ChainStatus[] = [];

		for (const pod of pods) {
			const instance = pod.labels['app.kubernetes.io/instance'];
			if (instance && !pod.name.includes('relayer')) {
				chains.push({
					chainId: instance,
					podName: pod.name,
					ready: pod.ready,
				});
			}
		}

		return chains;
	}

	async runPreflightChecks(): Promise<PreflightCheck[]> {
		const checks: PreflightCheck[] = [];

		// 1. Namespace exists
		try {
			await this.k8sApi.readNamespace(this.namespace);
			checks.push({ name: 'namespaceExists', ok: true });
		} catch {
			checks.push({ name: 'namespaceExists', ok: false, details: { namespace: this.namespace } });
		}

		// 2. Relayer pod found
		const relayer = await this.getRelayerStatus();
		checks.push({
			name: 'relayerPodFound',
			ok: relayer.podName !== null,
			details: relayer.podName ? { podName: relayer.podName } : undefined,
		});

		// 3. Chain pods ready
		const chainStatuses = await this.getChainStatuses();
		const readyCount = chainStatuses.filter((c) => c.ready).length;
		checks.push({
			name: 'chainPodsReady',
			ok: readyCount === chainStatuses.length && chainStatuses.length > 0,
			details: { ready: readyCount, total: chainStatuses.length },
		});

		// 4. Pods/exec allowed (basic check - can list pods)
		checks.push({
			name: 'podsExecAllowed',
			ok: true, // If we got here, we can at least list pods
			details: { hint: 'Actual exec permissions verified on use' },
		});

		return checks;
	}

	async getTopology(): Promise<Topology> {
		const pods = await this.listPods({});
		const services = await this.listServices({});

		const chains: TopologyChain[] = [];
		let relayerPod: { name: string; ready: boolean } | null = null;

		for (const pod of pods) {
			if (pod.name.includes('relayer')) {
				relayerPod = { name: pod.name, ready: pod.ready };
				continue;
			}

			const instance = pod.labels['app.kubernetes.io/instance'];
			if (!instance) continue;

			const svc = services.find((s) => s.name === `cryptomeria-${instance}`);

			chains.push({
				chainId: instance,
				pod: { name: pod.name, ip: pod.podIP, ready: pod.ready },
				service: svc ? { name: svc.name, type: svc.type } : null,
				ports: svc?.ports ?? [],
			});
		}

		return {
			chains,
			relayer: relayerPod ? { pod: relayerPod } : null,
		};
	}

	async getChainPorts(): Promise<ChainPort[]> {
		const services = await this.listServices({});
		const result: ChainPort[] = [];

		for (const svc of services) {
			const chainId = extractChainId(svc.name);
			if (!chainId) continue;

			const external: ChainPort['external'] = {};
			const internal: ChainPort['internal'] = {};

			for (const port of svc.ports) {
				const name = port.name?.toLowerCase() ?? '';

				if (name === 'rpc' && port.nodePort) {
					external.rpc = `http://${this.nodeHost}:${port.nodePort}`;
					internal.rpc = `http://${svc.name}:${port.port}`;
				} else if ((name === 'api' || name === 'rest') && port.nodePort) {
					external.api = `http://${this.nodeHost}:${port.nodePort}`;
					internal.api = `http://${svc.name}:${port.port}`;
				} else if (name === 'grpc' && port.nodePort) {
					external.grpc = `${this.nodeHost}:${port.nodePort}`;
					internal.grpc = `${svc.name}:${port.port}`;
				}
			}

			result.push({ chainId, external, internal });
		}

		return result;
	}

	// ===== K8s Resource Listing =====

	async listPods(opts: { selector?: string; name?: string; includeContainers?: boolean }): Promise<PodInfo[]> {
		try {
			const response = await this.k8sApi.listNamespacedPod(
				this.namespace,
				undefined,
				undefined,
				undefined,
				undefined,
				opts.selector,
				undefined,
				undefined,
				undefined,
				undefined,
				Math.ceil(this.timeoutMs / 1000)
			);

			const pods: PodInfo[] = [];

			for (const pod of response.body.items) {
				const name = pod.metadata?.name ?? '';
				if (opts.name && !name.includes(opts.name)) continue;

				const conditions = pod.status?.conditions ?? [];
				const readyCondition = conditions.find((c) => c.type === 'Ready');
				const ready = readyCondition?.status === 'True';

				const containerStatuses = pod.status?.containerStatuses ?? [];
				const restarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount ?? 0), 0);

				const info: PodInfo = {
					name,
					namespace: pod.metadata?.namespace ?? this.namespace,
					labels: pod.metadata?.labels ?? {},
					phase: pod.status?.phase ?? 'Unknown',
					ready,
					restarts,
					podIP: pod.status?.podIP,
				};

				if (opts.includeContainers) {
					info.containers = containerStatuses.map((cs) => ({
						name: cs.name,
						ready: cs.ready,
						restartCount: cs.restartCount,
						state: cs.state?.running ? 'running' : cs.state?.waiting ? 'waiting' : 'terminated',
					}));
				}

				pods.push(info);
			}

			return pods;
		} catch (error) {
			this.handleK8sError(error);
			return [];
		}
	}

	async listServices(opts: { selector?: string; name?: string }): Promise<ServiceInfo[]> {
		try {
			const response = await this.k8sApi.listNamespacedService(
				this.namespace,
				undefined,
				undefined,
				undefined,
				undefined,
				opts.selector,
				undefined,
				undefined,
				undefined,
				undefined,
				Math.ceil(this.timeoutMs / 1000)
			);

			const services: ServiceInfo[] = [];

			for (const svc of response.body.items) {
				const name = svc.metadata?.name ?? '';
				if (opts.name && !name.includes(opts.name)) continue;

				services.push({
					name,
					type: svc.spec?.type ?? 'ClusterIP',
					clusterIP: svc.spec?.clusterIP,
					ports: (svc.spec?.ports ?? []).map((p) => ({
						name: p.name,
						port: p.port,
						nodePort: p.nodePort,
						protocol: p.protocol ?? 'TCP',
					})),
					selector: svc.spec?.selector ?? {},
				});
			}

			return services;
		} catch (error) {
			this.handleK8sError(error);
			return [];
		}
	}

	async listEndpoints(opts: { selector?: string; name?: string }): Promise<EndpointInfo[]> {
		try {
			const response = await this.k8sApi.listNamespacedEndpoints(
				this.namespace,
				undefined,
				undefined,
				undefined,
				undefined,
				opts.selector,
				undefined,
				undefined,
				undefined,
				undefined,
				Math.ceil(this.timeoutMs / 1000)
			);

			const endpoints: EndpointInfo[] = [];

			for (const ep of response.body.items) {
				const name = ep.metadata?.name ?? '';
				if (opts.name && !name.includes(opts.name)) continue;

				endpoints.push({
					name,
					subsets: (ep.subsets ?? []).map((ss) => ({
						addresses: (ss.addresses ?? []).map((a) => ({ ip: a.ip })),
						ports: (ss.ports ?? []).map((p) => ({
							name: p.name ?? '',
							port: p.port,
							protocol: p.protocol ?? 'TCP',
						})),
					})),
				});
			}

			return endpoints;
		} catch (error) {
			this.handleK8sError(error);
			return [];
		}
	}

	async listConfigMaps(opts: { name?: string; includeData?: boolean }): Promise<ConfigMapInfo[]> {
		try {
			const response = await this.k8sApi.listNamespacedConfigMap(
				this.namespace,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				Math.ceil(this.timeoutMs / 1000)
			);

			const configMaps: ConfigMapInfo[] = [];

			for (const cm of response.body.items) {
				const name = cm.metadata?.name ?? '';
				if (opts.name && !name.includes(opts.name)) continue;

				const info: ConfigMapInfo = {
					name,
					keys: Object.keys(cm.data ?? {}),
				};

				if (opts.includeData) {
					info.data = cm.data ?? {};
				}

				configMaps.push(info);
			}

			return configMaps;
		} catch (error) {
			this.handleK8sError(error);
			return [];
		}
	}

	async getPodLogs(opts: { podName: string; container?: string; tailLines?: number; sinceSeconds?: number }): Promise<string> {
		try {
			const response = await this.k8sApi.readNamespacedPodLog(
				opts.podName,
				this.namespace,
				opts.container,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				opts.sinceSeconds,
				opts.tailLines ?? 200,
				undefined
			);

			return response.body ?? '';
		} catch (error) {
			if (this.isNotFoundError(error)) {
				throw notFoundError('Pod not found', { podName: opts.podName });
			}
			this.handleK8sError(error);
			return '';
		}
	}

	// ===== Legacy Methods (for backward compatibility) =====

	async listChainServices(): Promise<ChainSummary[]> {
		if (this.servicesCache && Date.now() < this.servicesCache.expiresAt) {
			return this.servicesCache.data;
		}

		const services = await this.listServices({});
		const chains: ChainSummary[] = [];

		for (const svc of services) {
			if (!svc.name.startsWith('cryptomeria-') || svc.type !== 'NodePort') continue;

			const chainId = extractChainId(svc.name);
			if (chainId) {
				chains.push({ chainId, serviceName: svc.name });
			}
		}

		this.servicesCache = { data: chains, expiresAt: Date.now() + this.cacheTtlMs };
		return chains;
	}

	async resolveChainEndpoints(chainId: string): Promise<ChainEndpoints> {
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
			const endpoints: ChainEndpoints = {
				chainId,
				serviceName,
				resolvedAt: new Date(),
			};

			for (const port of ports) {
				const portName = port.name?.toLowerCase();
				const nodePort = port.nodePort;

				if (!nodePort) continue;

				if (portName === 'api' || portName === 'rest') {
					endpoints.apiNodePort = nodePort;
					endpoints.restBase = `http://${this.nodeHost}:${nodePort}`;
				} else if (portName === 'rpc') {
					endpoints.rpcNodePort = nodePort;
					endpoints.rpcBase = `http://${this.nodeHost}:${nodePort}`;
					endpoints.wsRpcUrl = `ws://${this.nodeHost}:${nodePort}/websocket`;
				} else if (portName === 'grpc') {
					endpoints.grpcNodePort = nodePort;
					endpoints.grpcAddr = `${this.nodeHost}:${nodePort}`;
				}
			}

			if (!endpoints.apiNodePort) {
				throw k8sUnavailableError('Service missing required api port', {
					chainId,
					serviceName,
					availablePorts: ports.map((p) => p.name),
				});
			}

			this.endpointCache.set(chainId, { data: endpoints, expiresAt: Date.now() + this.cacheTtlMs });
			return endpoints;
		} catch (error) {
			if (error instanceof Error && error.name === 'ApiError') throw error;
			if (this.isNotFoundError(error)) throw notFoundError('Chain service not found', { chainId });
			if (this.isTimeoutError(error)) throw timeoutError('Kubernetes API timeout');
			throw k8sUnavailableError('Failed to resolve chain endpoints', { chainId, error: String(error) });
		}
	}

	endpointsToInfo(endpoints: ChainEndpoints): ChainInfo {
		return {
			chainId: endpoints.chainId,
			serviceName: endpoints.serviceName,
			restBase: endpoints.restBase!,
			rpcBase: endpoints.rpcBase ?? endpoints.restBase!,
			wsRpcUrl: endpoints.wsRpcUrl,
			grpcAddr: endpoints.grpcAddr,
		};
	}

	async resolveAllEndpoints(): Promise<Map<string, ChainEndpoints>> {
		const chains = await this.listChainServices();
		const results = new Map<string, ChainEndpoints>();

		for (const chain of chains) {
			try {
				const endpoints = await this.resolveChainEndpoints(chain.chainId);
				results.set(chain.chainId, endpoints);
			} catch {
				console.warn(`Failed to resolve endpoints for ${chain.chainId}`);
			}
		}

		return results;
	}

	clearCache(): void {
		this.endpointCache.clear();
		this.servicesCache = null;
	}

	// ===== Error Handling =====

	private handleK8sError(error: unknown): never {
		if (this.isTimeoutError(error)) {
			throw timeoutError('Kubernetes API timeout');
		}
		throw k8sUnavailableError('Kubernetes API error', { error: String(error) });
	}

	private isTimeoutError(error: unknown): boolean {
		if (error instanceof Error) {
			return error.message.includes('timeout') || error.message.includes('ETIMEDOUT');
		}
		return false;
	}

	private isNotFoundError(error: unknown): boolean {
		if (error && typeof error === 'object' && 'response' in error) {
			const response = (error as { response?: { statusCode?: number } }).response;
			return response?.statusCode === 404;
		}
		return false;
	}
}
