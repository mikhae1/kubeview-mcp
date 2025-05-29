import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  BaseCommand,
  CommonSchemas,
  formatResourceMetadata,
  formatResourceStatus,
} from './BaseCommand.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * Get details of a specific Kubernetes resource
 */
export class GetResourceDetailsCommand implements BaseCommand {
  tool: Tool = {
    name: 'get_resource_details',
    description: 'Get detailed information about a specific Kubernetes resource',
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          description: 'Type of resource (pod, service, deployment, configmap, secret)',
          enum: ['pod', 'service', 'deployment', 'configmap', 'secret'],
        },
        name: CommonSchemas.name,
        namespace: {
          ...CommonSchemas.namespace,
          description: 'Kubernetes namespace (defaults to "default")',
        },
      },
      required: ['resourceType', 'name'],
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { resourceType, name, namespace = 'default' } = params;

      switch (resourceType) {
        case 'pod':
          return await this.getPodDetails(client, name, namespace);
        case 'service':
          return await this.getServiceDetails(client, name, namespace);
        case 'deployment':
          return await this.getDeploymentDetails(client, name, namespace);
        case 'configmap':
          return await this.getConfigMapDetails(client, name, namespace);
        case 'secret':
          return await this.getSecretDetails(client, name, namespace);
        default:
          throw new Error(`Unsupported resource type: ${resourceType}`);
      }
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to get resource details: ${errorMessage}`);
    }
  }

  private async getPodDetails(
    client: KubernetesClient,
    name: string,
    namespace: string,
  ): Promise<any> {
    const pod = await client.core.readNamespacedPod({ name, namespace });

    return {
      resourceType: 'pod',
      metadata: formatResourceMetadata(pod),
      spec: {
        nodeName: pod.spec?.nodeName,
        serviceAccountName: pod.spec?.serviceAccountName,
        restartPolicy: pod.spec?.restartPolicy,
        containers:
          pod.spec?.containers?.map((c: any) => ({
            name: c.name,
            image: c.image,
            command: c.command,
            args: c.args,
            ports: c.ports || [],
            env: c.env || [],
            resources: c.resources || {},
            volumeMounts: c.volumeMounts || [],
          })) || [],
        volumes: pod.spec?.volumes || [],
      },
      status: {
        ...formatResourceStatus(pod),
        phase: pod.status?.phase,
        podIP: pod.status?.podIP,
        hostIP: pod.status?.hostIP,
        startTime: pod.status?.startTime,
        containerStatuses: pod.status?.containerStatuses || [],
      },
    };
  }

  private async getServiceDetails(
    client: KubernetesClient,
    name: string,
    namespace: string,
  ): Promise<any> {
    const service = await client.core.readNamespacedService({ name, namespace });

    return {
      resourceType: 'service',
      metadata: formatResourceMetadata(service),
      spec: {
        type: service.spec?.type,
        clusterIP: service.spec?.clusterIP,
        externalIPs: service.spec?.externalIPs || [],
        ports: service.spec?.ports || [],
        selector: service.spec?.selector || {},
        sessionAffinity: service.spec?.sessionAffinity,
        loadBalancerIP: service.spec?.loadBalancerIP,
        externalName: service.spec?.externalName,
      },
      status: service.status || {},
    };
  }

  private async getDeploymentDetails(
    client: KubernetesClient,
    name: string,
    namespace: string,
  ): Promise<any> {
    const deployment = await client.apps.readNamespacedDeployment({ name, namespace });

    return {
      resourceType: 'deployment',
      metadata: formatResourceMetadata(deployment),
      spec: {
        replicas: deployment.spec?.replicas,
        selector: deployment.spec?.selector,
        template: deployment.spec?.template,
        strategy: deployment.spec?.strategy,
        minReadySeconds: deployment.spec?.minReadySeconds,
        revisionHistoryLimit: deployment.spec?.revisionHistoryLimit,
        progressDeadlineSeconds: deployment.spec?.progressDeadlineSeconds,
      },
      status: {
        ...formatResourceStatus(deployment),
        replicas: deployment.status?.replicas,
        updatedReplicas: deployment.status?.updatedReplicas,
        readyReplicas: deployment.status?.readyReplicas,
        availableReplicas: deployment.status?.availableReplicas,
        unavailableReplicas: deployment.status?.unavailableReplicas,
        observedGeneration: deployment.status?.observedGeneration,
      },
    };
  }

  private async getConfigMapDetails(
    client: KubernetesClient,
    name: string,
    namespace: string,
  ): Promise<any> {
    const configMap = await client.core.readNamespacedConfigMap({ name, namespace });

    return {
      resourceType: 'configmap',
      metadata: formatResourceMetadata(configMap),
      data: configMap.data || {},
      binaryData: configMap.binaryData ? Object.keys(configMap.binaryData) : [],
    };
  }

  private async getSecretDetails(
    client: KubernetesClient,
    name: string,
    namespace: string,
  ): Promise<any> {
    const secret = await client.core.readNamespacedSecret({ name, namespace });

    // Note: Secret data is base64 encoded, we'll return keys only for security
    return {
      resourceType: 'secret',
      metadata: formatResourceMetadata(secret),
      type: secret.type,
      dataKeys: secret.data ? Object.keys(secret.data) : [],
      stringDataKeys: secret.stringData ? Object.keys(secret.stringData) : [],
    };
  }
}
