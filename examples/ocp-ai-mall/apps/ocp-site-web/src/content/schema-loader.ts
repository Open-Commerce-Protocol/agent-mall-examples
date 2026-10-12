const schemaModules = import.meta.glob('../../../../ocp.catalog.*.v1/*.json', {
  query: '?raw',
  import: 'default',
});

export async function loadSchemaDocument(path: string): Promise<unknown | null> {
  const modulePath = `../../../../${path}`;
  const loader = schemaModules[modulePath];

  if (!loader) {
    return null;
  }

  const raw = (await (loader as () => Promise<string>)()) as string;
  return JSON.parse(raw) as unknown;
}

export function formatJsonFragment(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
