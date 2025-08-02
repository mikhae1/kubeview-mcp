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
}

export class AppsV1Api {}
export class BatchV1Api {}
export class NetworkingV1Api {}

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
