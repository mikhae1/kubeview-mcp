import * as k8s from '@kubernetes/client-node';
import { KubernetesClient } from './KubernetesClient.js';

// Import resource-specific operations
import { PodOperations } from './resources/PodOperations.js';
import { ServiceOperations } from './resources/ServiceOperations.js';
import { DeploymentOperations } from './resources/DeploymentOperations.js';
import { ConfigMapOperations } from './resources/ConfigMapOperations.js';
import { SecretOperations } from './resources/SecretOperations.js';
import { CustomResourceOperations } from './resources/CustomResourceOperations.js';
import { NamespaceOperations } from './resources/NamespaceOperations.js';
import { PersistentVolumeOperations } from './resources/PersistentVolumeOperations.js';
import { PersistentVolumeClaimOperations } from './resources/PersistentVolumeClaimOperations.js';
import { IngressOperations } from './resources/IngressOperations.js';

/**
 * Resource operations manager
 */
export class ResourceOperations {
  private pods: PodOperations;
  private services: ServiceOperations;
  private deployments: DeploymentOperations;
  private configMaps: ConfigMapOperations;
  private secrets: SecretOperations;
  private namespaces: NamespaceOperations;
  private persistentVolumesOps: PersistentVolumeOperations;
  private persistentVolumeClaimsOps: PersistentVolumeClaimOperations;
  private ingresses: IngressOperations;

  constructor(private client: KubernetesClient) {
    this.pods = new PodOperations(client);
    this.services = new ServiceOperations(client);
    this.deployments = new DeploymentOperations(client);
    this.configMaps = new ConfigMapOperations(client);
    this.secrets = new SecretOperations(client);
    this.namespaces = new NamespaceOperations(client);
    this.persistentVolumesOps = new PersistentVolumeOperations(client);
    this.persistentVolumeClaimsOps = new PersistentVolumeClaimOperations(client);
    this.ingresses = new IngressOperations(client);
  }

  /**
   * Get pod operations
   */
  public get pod(): PodOperations {
    return this.pods;
  }

  /**
   * Get service operations
   */
  public get service(): ServiceOperations {
    return this.services;
  }

  /**
   * Get deployment operations
   */
  public get deployment(): DeploymentOperations {
    return this.deployments;
  }

  /**
   * Get configMap operations
   */
  public get configMap(): ConfigMapOperations {
    return this.configMaps;
  }

  /**
   * Get secret operations
   */
  public get secret(): SecretOperations {
    return this.secrets;
  }

  /**
   * Get namespace operations
   */
  public get namespace(): NamespaceOperations {
    return this.namespaces;
  }

  /**
   * Get persistent volume operations
   */
  public get persistentVolumes(): PersistentVolumeOperations {
    return this.persistentVolumesOps;
  }

  /**
   * Get persistent volume claim operations
   */
  public get persistentVolumeClaims(): PersistentVolumeClaimOperations {
    return this.persistentVolumeClaimsOps;
  }

  /**
   * Get ingress operations
   */
  public get ingress(): IngressOperations {
    return this.ingresses;
  }

  /**
   * Create a custom resource operations instance
   */
  public custom<T extends k8s.KubernetesObject>(
    group: string,
    version: string,
    plural: string,
    namespaced = true,
  ): CustomResourceOperations<T> {
    return new CustomResourceOperations<T>(this.client, group, version, plural, namespaced);
  }
}
