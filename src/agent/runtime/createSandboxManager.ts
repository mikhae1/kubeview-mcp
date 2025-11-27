import type { MCPBridge } from '../bridge/MCPBridge.js';
import { VmSandboxManager } from './vm/VmSandboxManager.js';
import type { SandboxOptions, SandboxRuntime } from './types.js';

const MAX_IVM_NODE_MAJOR = 22;

export async function createSandboxManager(
  bridge: MCPBridge,
  options: SandboxOptions,
): Promise<SandboxRuntime> {
  if (shouldUseIsolatedVm()) {
    try {
      const module = await import('./ivm/IVMSandboxManager.js');
      const { IVMSandboxManager } = module;
      return new IVMSandboxManager(bridge, options);
    } catch (error) {
      options.logger?.warn?.(
        'Failed to initialize isolated-vm sandbox, falling back to VM sandbox.',
        {
          error,
        },
      );
    }
  }

  return new VmSandboxManager(bridge, options);
}

function shouldUseIsolatedVm(): boolean {
  if (process.env.KUBE_MCP_FORCE_VM_SANDBOX === '1') {
    return false;
  }

  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (!Number.isFinite(major)) {
    return false;
  }

  return major <= MAX_IVM_NODE_MAJOR;
}
