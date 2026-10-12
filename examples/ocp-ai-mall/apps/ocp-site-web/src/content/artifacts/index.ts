import { coreArtifacts } from './core';
import { examplesArtifacts } from './examples';
import { handshakeArtifacts } from './handshake';
import { registrationArtifacts } from './registration';
import type { PageArtifactDefinition } from './types';

export const artifactRegistry: Record<string, PageArtifactDefinition> = {
  ...coreArtifacts,
  ...handshakeArtifacts,
  ...registrationArtifacts,
  ...examplesArtifacts,
};
