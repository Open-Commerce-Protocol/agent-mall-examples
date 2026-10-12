import { expect, test } from 'bun:test';
import { createWebMcpRuntime } from './adapter';

test('creates no-op runtime when host is absent', () => {
  const runtime = createWebMcpRuntime({ host: null });
  expect(runtime.isAvailable).toBe(false);

  const registration = runtime.registerTool({
    name: 'ocp.noop',
    description: 'No-op tool',
    handler: () => ({ ok: true }),
  });

  registration.unregister();
  runtime.cleanup();
});

test('registers Chrome WebMCP object tools and unregisters by returned registration', () => {
  const unregistered: string[] = [];
  const registered: Array<Record<string, unknown>> = [];
  const runtime = createWebMcpRuntime({
    host: {
      registerTool(tool: unknown) {
        registered.push(tool as Record<string, unknown>);
        return {
          unregister() {
            unregistered.push(String((tool as { name: string }).name));
          },
        };
      },
    },
  });

  expect(runtime.isAvailable).toBe(true);
  const registration = runtime.registerTools([
    { name: 'ocp.first', description: 'First', handler: () => null },
    { name: 'ocp.second', description: 'Second', handler: () => null },
  ]);

  expect(registered).toEqual([
    {
      name: 'ocp.first',
      description: 'First',
      inputSchema: undefined,
      execute: registered[0]?.execute,
    },
    {
      name: 'ocp.second',
      description: 'Second',
      inputSchema: undefined,
      execute: registered[1]?.execute,
    },
  ]);
  expect(typeof registered[0]?.execute).toBe('function');
  registration.unregister();
  registration.unregister();
  expect(unregistered).toEqual(['ocp.second', 'ocp.first']);
});

test('falls back to host unregisterTool when registerTool returns no registration', () => {
  const unregistered: string[] = [];
  const runtime = createWebMcpRuntime({
    host: {
      registerTool() {
        return undefined;
      },
      unregisterTool(name: unknown) {
        unregistered.push(String(name));
      },
    },
  });

  const registration = runtime.registerTool({
    name: 'ocp.chrome',
    description: 'Chrome style registration',
    handler: () => null,
  });

  registration.unregister();

  expect(unregistered).toEqual(['ocp.chrome']);
});

test('treats Chrome duplicate tool registration as already registered', () => {
  const runtime = createWebMcpRuntime({
    host: {
      registerTool() {
        throw new DOMException(
          "Failed to execute 'registerTool' on 'ModelContext': Duplicate tool name",
          'InvalidStateError',
        );
      },
    },
  });

  const registration = runtime.registerTool({
    name: 'ocp.duplicate',
    description: 'Duplicate registration',
    handler: () => null,
  });

  registration.unregister();
  runtime.cleanup();
});

test('cleanup unregisters active registrations once', () => {
  let count = 0;
  const runtime = createWebMcpRuntime({
    host: {
      registerTool() {
        return () => {
          count += 1;
        };
      },
    },
  });

  runtime.registerTool({ name: 'ocp.cleanup', description: 'Cleanup', handler: () => null });
  runtime.cleanup();
  runtime.cleanup();

  expect(count).toBe(1);
});
