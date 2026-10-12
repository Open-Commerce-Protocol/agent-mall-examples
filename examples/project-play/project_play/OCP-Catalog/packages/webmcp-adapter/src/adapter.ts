import type { WebMcpHost, WebMcpRuntime, WebMcpRuntimeOptions, WebMcpTool, WebMcpToolRegistration } from './types';

type HostRegistration =
  | undefined
  | null
  | (() => void)
  | { unregister?: () => void; remove?: () => void; dispose?: () => void };

type RegisterToolFunction = (...args: unknown[]) => HostRegistration;
type UnregisterToolFunction = (name: string) => void;

export function createWebMcpRuntime(options: WebMcpRuntimeOptions = {}): WebMcpRuntime {
  const host = options.host === undefined ? getDefaultHost() : options.host;
  const registerTool = isRegisterToolHost(host) ? host.registerTool.bind(host) : null;
  const unregisterTool = isUnregisterToolHost(host) ? host.unregisterTool.bind(host) : null;
  const registrations = new Set<WebMcpToolRegistration>();

  const runtime: WebMcpRuntime = {
    isAvailable: Boolean(registerTool),
    registerTool<TInput = unknown, TResult = unknown>(tool: WebMcpTool<TInput, TResult>) {
      if (!registerTool) return noopRegistration;

      let active = true;
      const hostRegistration = registerHostTool(registerTool, tool);
      const registration = {
        unregister() {
          if (!active) return;
          active = false;
          unregisterHostTool(hostRegistration, unregisterTool, tool.name);
          registrations.delete(registration);
        },
      };
      registrations.add(registration);
      return registration;
    },
    registerTools(tools: readonly WebMcpTool[]) {
      const childRegistrations = tools.map((tool) => runtime.registerTool(tool));
      let active = true;
      return {
        unregister() {
          if (!active) return;
          active = false;
          for (const registration of [...childRegistrations].reverse()) {
            registration.unregister();
          }
        },
      };
    },
    cleanup() {
      for (const registration of Array.from(registrations).reverse()) {
        registration.unregister();
      }
    },
  };

  return runtime;
}

export function registerWebMcpTools(
  tools: readonly WebMcpTool[],
  options: WebMcpRuntimeOptions = {},
): WebMcpToolRegistration {
  return createWebMcpRuntime(options).registerTools(tools);
}

function getDefaultHost(): WebMcpHost | null {
  const navigatorValue = globalThis.navigator as (Navigator & { modelContext?: WebMcpHost }) | undefined;
  return navigatorValue?.modelContext ?? null;
}

function isRegisterToolHost(host: WebMcpHost | null | undefined): host is { registerTool: RegisterToolFunction } {
  return typeof host?.registerTool === 'function';
}

function isUnregisterToolHost(host: WebMcpHost | null | undefined): host is { unregisterTool: UnregisterToolFunction } {
  return typeof host?.unregisterTool === 'function';
}

function registerHostTool<TInput, TResult>(
  registerTool: RegisterToolFunction,
  tool: WebMcpTool<TInput, TResult>,
): HostRegistration {
  try {
    return registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: tool.handler,
    });
  } catch (error) {
    if (isDuplicateToolRegistrationError(error)) return noopHostRegistration;
    throw error;
  }
}

function unregisterHostTool(
  registration: HostRegistration,
  unregisterTool: UnregisterToolFunction | null,
  toolName: string,
) {
  if (typeof registration === 'function') {
    registration();
    return;
  }

  if (registration?.unregister) {
    registration.unregister();
    return;
  }
  if (registration?.remove) {
    registration.remove();
    return;
  }
  if (registration?.dispose) {
    registration.dispose();
    return;
  }

  unregisterTool?.(toolName);
}

const noopRegistration: WebMcpToolRegistration = {
  unregister() {},
};

const noopHostRegistration = {
  unregister() {},
};

function isDuplicateToolRegistrationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === 'InvalidStateError' && error.message.includes('Duplicate tool name');
}
