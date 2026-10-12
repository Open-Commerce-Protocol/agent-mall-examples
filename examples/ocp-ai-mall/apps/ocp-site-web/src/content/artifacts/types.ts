import type { MaybeLocalizedText } from '../i18n';

export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | JsonSchemaValue[]
  | JsonSchemaDocument;

export type JsonSchemaDocument = {
  [key: string]: JsonSchemaValue | undefined;
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaDocument>;
  items?: JsonSchemaDocument;
};

export type SchemaSectionDefinition = {
  title: MaybeLocalizedText;
  sourcePath: string;
  select: (schema: JsonSchemaDocument) => unknown;
  description?: MaybeLocalizedText;
};

export type ImplementationRef = {
  label: MaybeLocalizedText;
  path: string;
  // When the referenced source lives in the separate ocp-catalog-instances
  // repo (not in this protocol repo), set href to its canonical URL. The docs
  // integrity check treats an href-bearing ref as external and does not require
  // the path to exist locally.
  href?: string;
  note?: MaybeLocalizedText;
};

export type EndpointExample = {
  title: MaybeLocalizedText;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  request?: unknown;
  response?: unknown;
  note?: MaybeLocalizedText;
};

export type PageArtifactDefinition = {
  schemaSections?: SchemaSectionDefinition[];
  implementationRefs?: ImplementationRef[];
  endpointExamples?: EndpointExample[];
};
