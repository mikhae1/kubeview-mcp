import * as k8s from '@kubernetes/client-node';

/**
 * Label selector builder utility
 */
export class LabelSelector {
  private selectors: string[] = [];

  /**
   * Add an equality-based selector (key=value)
   */
  equals(key: string, value: string): this {
    this.selectors.push(`${key}=${value}`);
    return this;
  }

  /**
   * Add an inequality-based selector (key!=value)
   */
  notEquals(key: string, value: string): this {
    this.selectors.push(`${key}!=${value}`);
    return this;
  }

  /**
   * Add a set-based selector (key in (value1,value2))
   */
  in(key: string, values: string[]): this {
    this.selectors.push(`${key} in (${values.join(',')})`);
    return this;
  }

  /**
   * Add a set-based selector (key notin (value1,value2))
   */
  notIn(key: string, values: string[]): this {
    this.selectors.push(`${key} notin (${values.join(',')})`);
    return this;
  }

  /**
   * Add an existence-based selector (key exists)
   */
  exists(key: string): this {
    this.selectors.push(key);
    return this;
  }

  /**
   * Add a non-existence-based selector (!key)
   */
  notExists(key: string): this {
    this.selectors.push(`!${key}`);
    return this;
  }

  /**
   * Build the label selector string
   */
  build(): string {
    return this.selectors.join(',');
  }
}

/**
 * Field selector builder utility
 */
export class FieldSelector {
  private selectors: string[] = [];

  /**
   * Add a field selector
   */
  field(path: string, value: string): this {
    this.selectors.push(`${path}=${value}`);
    return this;
  }

  /**
   * Add a field not equals selector
   */
  fieldNotEquals(path: string, value: string): this {
    this.selectors.push(`${path}!=${value}`);
    return this;
  }

  /**
   * Select by name
   */
  name(name: string): this {
    return this.field('metadata.name', name);
  }

  /**
   * Select by namespace
   */
  namespace(namespace: string): this {
    return this.field('metadata.namespace', namespace);
  }

  /**
   * Select by status phase (for pods)
   */
  phase(phase: string): this {
    return this.field('status.phase', phase);
  }

  /**
   * Build the field selector string
   */
  build(): string {
    return this.selectors.join(',');
  }
}

/**
 * Resource patch builder utility
 */
export class PatchBuilder {
  private patches: any[] = [];

  /**
   * Add a JSON patch operation
   */
  add(path: string, value: any): this {
    this.patches.push({
      op: 'add',
      path,
      value,
    });
    return this;
  }

  /**
   * Remove a JSON patch operation
   */
  remove(path: string): this {
    this.patches.push({
      op: 'remove',
      path,
    });
    return this;
  }

  /**
   * Replace a JSON patch operation
   */
  replace(path: string, value: any): this {
    this.patches.push({
      op: 'replace',
      path,
      value,
    });
    return this;
  }

  /**
   * Copy a JSON patch operation
   */
  copy(from: string, path: string): this {
    this.patches.push({
      op: 'copy',
      from,
      path,
    });
    return this;
  }

  /**
   * Move a JSON patch operation
   */
  move(from: string, path: string): this {
    this.patches.push({
      op: 'move',
      from,
      path,
    });
    return this;
  }

  /**
   * Test a JSON patch operation
   */
  test(path: string, value: any): this {
    this.patches.push({
      op: 'test',
      path,
      value,
    });
    return this;
  }

  /**
   * Build the JSON patch array
   */
  build(): any[] {
    return this.patches;
  }
}

/**
 * Resource metadata utilities
 */
export class MetadataUtils {
  /**
   * Generate a unique name with a random suffix
   */
  static generateName(prefix: string): string {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    return `${prefix}-${randomSuffix}`;
  }

  /**
   * Add or update labels on a resource
   */
  static addLabels<T extends k8s.KubernetesObject>(
    resource: T,
    labels: { [key: string]: string },
  ): T {
    if (!resource.metadata) {
      resource.metadata = {};
    }
    if (!resource.metadata.labels) {
      resource.metadata.labels = {};
    }
    Object.assign(resource.metadata.labels, labels);
    return resource;
  }

  /**
   * Add or update annotations on a resource
   */
  static addAnnotations<T extends k8s.KubernetesObject>(
    resource: T,
    annotations: { [key: string]: string },
  ): T {
    if (!resource.metadata) {
      resource.metadata = {};
    }
    if (!resource.metadata.annotations) {
      resource.metadata.annotations = {};
    }
    Object.assign(resource.metadata.annotations, annotations);
    return resource;
  }

  /**
   * Add owner reference to a resource
   */
  static addOwnerReference<T extends k8s.KubernetesObject>(
    resource: T,
    owner: k8s.KubernetesObject,
    controller = false,
    blockOwnerDeletion = false,
  ): T {
    if (!resource.metadata) {
      resource.metadata = {};
    }
    if (!resource.metadata.ownerReferences) {
      resource.metadata.ownerReferences = [];
    }

    const ownerRef: k8s.V1OwnerReference = {
      apiVersion: owner.apiVersion!,
      kind: owner.kind!,
      name: owner.metadata!.name!,
      uid: owner.metadata!.uid!,
      controller,
      blockOwnerDeletion,
    };

    resource.metadata.ownerReferences.push(ownerRef);
    return resource;
  }

  /**
   * Check if a resource has a specific label
   */
  static hasLabel(resource: k8s.KubernetesObject, key: string, value?: string): boolean {
    if (!resource.metadata?.labels || !resource.metadata.labels[key]) {
      return false;
    }
    return value === undefined || resource.metadata.labels[key] === value;
  }

  /**
   * Check if a resource has a specific annotation
   */
  static hasAnnotation(resource: k8s.KubernetesObject, key: string, value?: string): boolean {
    if (!resource.metadata?.annotations || !resource.metadata.annotations[key]) {
      return false;
    }
    return value === undefined || resource.metadata.annotations[key] === value;
  }

  /**
   * Get resource age in milliseconds
   */
  static getAge(resource: k8s.KubernetesObject): number {
    if (!resource.metadata?.creationTimestamp) {
      return 0;
    }
    const created = new Date(resource.metadata.creationTimestamp);
    return Date.now() - created.getTime();
  }

  /**
   * Format resource age as human-readable string
   */
  static formatAge(resource: k8s.KubernetesObject): string {
    const ageMs = this.getAge(resource);
    const seconds = Math.floor(ageMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }
}

/**
 * Container utilities
 */
export class ContainerUtils {
  /**
   * Create a basic container spec
   */
  static createContainer(
    name: string,
    image: string,
    options?: {
      command?: string[];
      args?: string[];
      env?: k8s.V1EnvVar[];
      ports?: k8s.V1ContainerPort[];
      resources?: k8s.V1ResourceRequirements;
      volumeMounts?: k8s.V1VolumeMount[];
    },
  ): k8s.V1Container {
    return {
      name,
      image,
      ...options,
    };
  }

  /**
   * Add environment variable to container
   */
  static addEnvVar(
    container: k8s.V1Container,
    name: string,
    value?: string,
    valueFrom?: k8s.V1EnvVarSource,
  ): k8s.V1Container {
    if (!container.env) {
      container.env = [];
    }

    const envVar: k8s.V1EnvVar = { name };
    if (value !== undefined) {
      envVar.value = value;
    }
    if (valueFrom !== undefined) {
      envVar.valueFrom = valueFrom;
    }

    container.env.push(envVar);
    return container;
  }

  /**
   * Add port to container
   */
  static addPort(
    container: k8s.V1Container,
    containerPort: number,
    options?: {
      name?: string;
      protocol?: string;
      hostPort?: number;
    },
  ): k8s.V1Container {
    if (!container.ports) {
      container.ports = [];
    }

    container.ports.push({
      containerPort,
      ...options,
    });
    return container;
  }

  /**
   * Set container resources
   */
  static setResources(
    container: k8s.V1Container,
    requests?: { cpu?: string; memory?: string },
    limits?: { cpu?: string; memory?: string },
  ): k8s.V1Container {
    container.resources = {
      requests,
      limits,
    };
    return container;
  }
}

/**
 * Pod template utilities
 */
export class PodTemplateUtils {
  /**
   * Create a basic pod template spec
   */
  static createPodTemplateSpec(
    containers: k8s.V1Container[],
    options?: {
      labels?: { [key: string]: string };
      annotations?: { [key: string]: string };
      restartPolicy?: string;
      serviceAccountName?: string;
      volumes?: k8s.V1Volume[];
      nodeSelector?: { [key: string]: string };
      tolerations?: k8s.V1Toleration[];
      affinity?: k8s.V1Affinity;
    },
  ): k8s.V1PodTemplateSpec {
    return {
      metadata: {
        labels: options?.labels,
        annotations: options?.annotations,
      },
      spec: {
        containers,
        restartPolicy: options?.restartPolicy,
        serviceAccountName: options?.serviceAccountName,
        volumes: options?.volumes,
        nodeSelector: options?.nodeSelector,
        tolerations: options?.tolerations,
        affinity: options?.affinity,
      },
    };
  }

  /**
   * Add init container to pod template
   */
  static addInitContainer(
    podTemplate: k8s.V1PodTemplateSpec,
    initContainer: k8s.V1Container,
  ): k8s.V1PodTemplateSpec {
    if (!podTemplate.spec) {
      podTemplate.spec = {
        containers: [],
      };
    }
    if (!podTemplate.spec.initContainers) {
      podTemplate.spec.initContainers = [];
    }
    podTemplate.spec.initContainers.push(initContainer);
    return podTemplate;
  }

  /**
   * Add volume to pod template
   */
  static addVolume(
    podTemplate: k8s.V1PodTemplateSpec,
    volume: k8s.V1Volume,
  ): k8s.V1PodTemplateSpec {
    if (!podTemplate.spec) {
      podTemplate.spec = {
        containers: [],
      };
    }
    if (!podTemplate.spec.volumes) {
      podTemplate.spec.volumes = [];
    }
    podTemplate.spec.volumes.push(volume);
    return podTemplate;
  }
}

/**
 * Service utilities
 */
export class ServiceUtils {
  /**
   * Create a service spec for a deployment or pods
   */
  static createServiceSpec(
    selector: { [key: string]: string },
    ports: Array<{
      port: number;
      targetPort: number | string;
      protocol?: string;
      name?: string;
    }>,
    type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName' = 'ClusterIP',
  ): k8s.V1ServiceSpec {
    return {
      selector,
      ports: ports.map((p) => ({
        port: p.port,
        targetPort: p.targetPort as any,
        protocol: p.protocol || 'TCP',
        name: p.name,
      })),
      type,
    };
  }
}

/**
 * Deployment utilities
 */
export class DeploymentUtils {
  /**
   * Create a deployment spec
   */
  static createDeploymentSpec(
    replicas: number,
    selector: { [key: string]: string },
    template: k8s.V1PodTemplateSpec,
    strategy?: k8s.V1DeploymentStrategy,
  ): k8s.V1DeploymentSpec {
    return {
      replicas,
      selector: {
        matchLabels: selector,
      },
      template,
      strategy: strategy || {
        type: 'RollingUpdate',
        rollingUpdate: {
          maxUnavailable: '25%',
          maxSurge: '25%',
        },
      },
    };
  }
}
