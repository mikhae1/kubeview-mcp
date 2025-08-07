export class KubeConfig {
  loadFromFile = jest.fn();
  loadFromCluster = jest.fn();
  loadFromOptions = jest.fn();
  setCurrentContext = jest.fn();
  getCurrentContext = jest.fn();
  getContexts = jest.fn();
  getClusters = jest.fn();
  makeApiClient = jest.fn();
}

export class CoreV1Api {
  listNamespace = jest.fn();
  listNode = jest.fn();
  listNamespacedEndpoints = jest.fn();
  listNamespacedResourceQuota = jest.fn();
  listNamespacedLimitRange = jest.fn();
}

export class AppsV1Api {
  listNamespacedReplicaSet = jest.fn();
  listNamespacedStatefulSet = jest.fn();
  listNamespacedDaemonSet = jest.fn();
}
export class BatchV1Api {
  listNamespacedJob = jest.fn();
  listNamespacedCronJob = jest.fn();
}
export class NetworkingV1Api {}
export class AutoscalingV2Api {
  listNamespacedHorizontalPodAutoscaler = jest.fn();
}
export class PolicyV1Api {
  listNamespacedPodDisruptionBudget = jest.fn();
}
export class DiscoveryV1Api {
  listNamespacedEndpointSlice = jest.fn();
}

export interface Cluster {
  name: string;
  server: string;
  skipTLSVerify?: boolean;
}

export interface User {
  name: string;
  token?: string;
}

export interface Context {
  name: string;
  cluster: string;
  user: string;
}
