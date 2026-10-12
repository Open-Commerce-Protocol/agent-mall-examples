import { artifactRegistry } from './artifacts';
import type { EndpointExample, ImplementationRef, JsonSchemaDocument } from './artifacts/types';
import type { MaybeLocalizedText } from './i18n';
import { docsPublicPathToContentId } from './routing';
import { formatJsonFragment, loadSchemaDocument } from './schema-loader';

export type LoadedSchemaSection = {
  title: MaybeLocalizedText;
  description?: MaybeLocalizedText;
  sourcePath: string;
  code: string;
  packageAnchorId: string;
};

export type LoadedSchemaPackage = {
  anchorId: string;
  sourcePath: string;
  code: string;
};

export type { EndpointExample };

export type LoadedPageArtifacts = {
  schemaSections: LoadedSchemaSection[];
  schemaPackages: LoadedSchemaPackage[];
  implementationRefs: ImplementationRef[];
  endpointExamples: EndpointExample[];
};

function createSchemaAnchorId(sourcePath: string): string {
  return `schema-package-${sourcePath.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
}

export async function loadPageArtifacts(routePath: string): Promise<LoadedPageArtifacts> {
  const normalizedRoutePath = docsPublicPathToContentId(routePath);
  const definition = artifactRegistry[normalizedRoutePath];

  if (!definition) {
    return {
      schemaSections: [],
      schemaPackages: [],
      implementationRefs: [],
      endpointExamples: [],
    };
  }

  const loadedSchemaSections: LoadedSchemaSection[] = [];
  const schemaPackages = new Map<string, LoadedSchemaPackage>();

  if (definition.schemaSections) {
    const sections = await Promise.all(
      definition.schemaSections.map(async (section) => {
        const schema = await loadSchemaDocument(section.sourcePath);

        if (!schema) {
          return null;
        }

        const loadedSection: LoadedSchemaSection = {
          title: section.title,
          sourcePath: section.sourcePath,
          code: formatJsonFragment(section.select(schema as JsonSchemaDocument)),
          packageAnchorId: createSchemaAnchorId(section.sourcePath),
        };

        if (section.description) {
          loadedSection.description = section.description;
        }

        const packageAnchorId = createSchemaAnchorId(section.sourcePath);
        if (!schemaPackages.has(section.sourcePath)) {
          schemaPackages.set(section.sourcePath, {
            anchorId: packageAnchorId,
            sourcePath: section.sourcePath,
            code: formatJsonFragment(schema),
          });
        }

        return loadedSection;
      }),
    );

    for (const section of sections) {
      if (section) {
        loadedSchemaSections.push(section);
      }
    }
  }

  return {
    schemaSections: loadedSchemaSections,
    schemaPackages: [...schemaPackages.values()],
    implementationRefs: definition.implementationRefs ?? [],
    endpointExamples: definition.endpointExamples ?? [],
  };
}
