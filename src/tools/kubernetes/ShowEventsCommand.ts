import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseCommand, CommonSchemas } from './BaseCommand.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * Show events in a Kubernetes cluster
 */
export class ShowEventsCommand implements BaseCommand {
  tool: Tool = {
    name: 'show_events',
    description: 'Show events in the Kubernetes cluster, optionally filtered by resource',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: CommonSchemas.namespace,
        resourceType: {
          type: 'string',
          description: 'Filter events by resource type (e.g., pod, service, deployment)',
          optional: true,
        },
        resourceName: {
          type: 'string',
          description: 'Filter events by specific resource name',
          optional: true,
        },
        type: {
          type: 'string',
          description: 'Filter by event type (Normal or Warning)',
          enum: ['Normal', 'Warning'],
          optional: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (default: 100)',
          optional: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { namespace, resourceType, resourceName, type: eventType, limit = 100 } = params || {};

      // Build field selector for filtering
      const fieldSelectors: string[] = [];

      if (resourceName) {
        fieldSelectors.push(`involvedObject.name=${resourceName}`);
      }

      if (resourceType) {
        // Capitalize the resource type for Kubernetes API
        const capitalizedType = resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
        fieldSelectors.push(`involvedObject.kind=${capitalizedType}`);
      }

      if (eventType) {
        fieldSelectors.push(`type=${eventType}`);
      }

      const fieldSelector = fieldSelectors.length > 0 ? fieldSelectors.join(',') : undefined;

      let result;
      if (namespace) {
        // List events in specific namespace
        result = await client.core.listNamespacedEvent({
          namespace,
          fieldSelector,
          limit,
        });
      } else {
        // List events in all namespaces
        result = await client.core.listEventForAllNamespaces({
          fieldSelector,
          limit,
        });
      }

      // Sort events by timestamp (most recent first)
      const events = result.items
        .sort((a: any, b: any) => {
          const timeA = new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime();
          const timeB = new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime();
          return timeB - timeA;
        })
        .map((event: any) => ({
          namespace: event.metadata?.namespace,
          timestamp: event.lastTimestamp || event.firstTimestamp,
          type: event.type,
          reason: event.reason,
          message: event.message,
          count: event.count,
          source: {
            component: event.source?.component,
            host: event.source?.host,
          },
          involvedObject: {
            kind: event.involvedObject?.kind,
            name: event.involvedObject?.name,
            namespace: event.involvedObject?.namespace,
            uid: event.involvedObject?.uid,
            apiVersion: event.involvedObject?.apiVersion,
            resourceVersion: event.involvedObject?.resourceVersion,
            fieldPath: event.involvedObject?.fieldPath,
          },
          firstSeen: event.firstTimestamp,
          lastSeen: event.lastTimestamp,
        }));

      // Group events by type for summary
      const summary = {
        total: events.length,
        normal: events.filter((e: any) => e.type === 'Normal').length,
        warning: events.filter((e: any) => e.type === 'Warning').length,
      };

      return {
        summary,
        filters: {
          namespace: namespace || 'all',
          resourceType,
          resourceName,
          eventType,
        },
        events,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to fetch events: ${errorMessage}`);
    }
  }
}
