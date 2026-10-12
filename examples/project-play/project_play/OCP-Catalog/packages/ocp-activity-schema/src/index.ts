import { z } from 'zod';

export const ocpActivityEventVersionSchema = z.literal('ocp.activity.v1');

export const ocpActivityEventTypeSchema = z.enum([
  'registration.discovered',
  'registration.manifest_read',
  'registration.catalog_registered',
  'registration.catalog_searched',
  'registration.catalog_resolved',
  'registration.catalog_verified',
  'registration.catalog_refreshed',
  'catalog.manifest_read',
  'catalog.contracts_read',
  'catalog.health_checked',
  'catalog.provider_registered',
  'catalog.object_synced',
  'catalog.queried',
  'catalog.resolved',
  'action.binding_exposed',
  'action.invoked',
  'client.call_attempted',
  'client.call_completed',
  'client.validation_completed',
  'provider.webhook_received',
  'provider.sync_queued',
  'policy.denied',
]);

export const ocpActivitySourceKindSchema = z.enum([
  'registration_node',
  'catalog_node',
  'provider_plugin',
  'provider_api',
  'cli',
  'skill',
  'mcp_gateway',
  'webmcp',
  'site',
  'unknown',
]);

export const ocpActivityClientKindSchema = z.enum([
  'http',
  'cli',
  'skill',
  'mcp',
  'webmcp',
  'plugin',
  'server',
  'scheduler',
  'unknown',
]);

export const ocpActivityEndpointRoleSchema = z.enum(['inbound', 'outbound', 'internal']);

export const ocpActivityProtocolFamilySchema = z.enum([
  'registration',
  'catalog',
  'provider',
  'activity',
  'action',
  'client',
  'unknown',
]);

export const ocpActivityPublicVisibilitySchema = z.enum(['public', 'aggregate_only', 'private']);

export const ocpActivityStatusClassSchema = z.enum(['success', 'client_error', 'server_error', 'policy_denied', 'unknown']);

export const ocpActivityDurationBucketSchema = z.enum(['none', 'lt_100ms', 'lt_500ms', 'lt_1s', 'lt_5s', 'gte_5s']);

export const ocpActivityCountBucketSchema = z.enum(['none', 'zero', 'one', 'lt_10', 'lt_100', 'gte_100']);

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ocpActivityMetadataSchema = z.record(z.string(), metadataValueSchema)
  .default({})
  .superRefine((value, context) => {
    const entries = Object.entries(value);
    if (entries.length > 24) {
      context.addIssue({
        code: 'custom',
        message: 'metadata may contain at most 24 keys',
      });
    }

    for (const [key, item] of entries) {
      if (key.length > 80) {
        context.addIssue({
          code: 'custom',
          message: `metadata key ${key} is too long`,
        });
      }
      if (typeof item === 'string' && item.length > 500) {
        context.addIssue({
          code: 'custom',
          message: `metadata value ${key} is too long`,
        });
      }
    }
  });

export const ocpActivityEventInputSchema = z.object({
  event_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  event_version: ocpActivityEventVersionSchema.optional().default('ocp.activity.v1'),
  event_type: ocpActivityEventTypeSchema,
  occurred_at: z.string().datetime().optional(),
  observed_at: z.string().datetime().optional(),
  correlation_id: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
  span_id: z.string().min(1).optional(),
  parent_event_id: z.string().min(1).optional(),
  source_kind: ocpActivitySourceKindSchema.default('unknown'),
  client_kind: ocpActivityClientKindSchema.default('unknown'),
  endpoint_role: ocpActivityEndpointRoleSchema.default('internal'),
  protocol_family: ocpActivityProtocolFamilySchema.default('unknown'),
  protocol_version: z.string().min(1).optional(),
  method: z.string().min(1).max(16).optional(),
  path_template: z.string().min(1).max(200).optional(),
  status_code: z.number().int().min(100).max(599).optional(),
  duration_ms: z.number().int().min(0).max(3_600_000).optional(),
  error_code: z.string().min(1).max(120).optional(),
  registration_id: z.string().min(1).optional(),
  catalog_id: z.string().min(1).optional(),
  provider_id: z.string().min(1).optional(),
  object_type: z.string().min(1).optional(),
  query_pack: z.string().min(1).optional(),
  capability_id: z.string().min(1).optional(),
  result_count: z.number().int().min(0).optional(),
  sync_object_count: z.number().int().min(0).optional(),
  public_visibility: ocpActivityPublicVisibilitySchema.default('aggregate_only'),
  redaction_policy_version: z.string().min(1).default('ocp-redaction-v1'),
  payload_hash: z.string().min(1).optional(),
  metadata: ocpActivityMetadataSchema,
}).strict();

export const ocpActivityEventSchema = ocpActivityEventInputSchema.extend({
  event_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  observed_at: z.string().datetime(),
});

export const ocpPublicActivityEventSchema = z.object({
  public_event_id: z.string().min(1),
  raw_event_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  event_type: ocpActivityEventTypeSchema,
  source_kind: ocpActivitySourceKindSchema,
  client_kind: ocpActivityClientKindSchema,
  protocol_family: ocpActivityProtocolFamilySchema,
  catalog_id: z.string().min(1).nullable().default(null),
  provider_id: z.string().min(1).nullable().default(null),
  object_type: z.string().min(1).nullable().default(null),
  status_class: ocpActivityStatusClassSchema,
  duration_bucket: ocpActivityDurationBucketSchema,
  result_count_bucket: ocpActivityCountBucketSchema,
  public_summary: z.string().min(1),
  correlation_id_hash: z.string().min(1).nullable().default(null),
  created_at: z.string().datetime(),
});

export const ocpActivityBatchInputSchema = z.object({
  events: z.array(ocpActivityEventInputSchema).min(1).max(100),
}).strict();

export type OcpActivityEventType = z.infer<typeof ocpActivityEventTypeSchema>;
export type OcpActivitySourceKind = z.infer<typeof ocpActivitySourceKindSchema>;
export type OcpActivityClientKind = z.infer<typeof ocpActivityClientKindSchema>;
export type OcpActivityEndpointRole = z.infer<typeof ocpActivityEndpointRoleSchema>;
export type OcpActivityProtocolFamily = z.infer<typeof ocpActivityProtocolFamilySchema>;
export type OcpActivityPublicVisibility = z.infer<typeof ocpActivityPublicVisibilitySchema>;
export type OcpActivityEventInput = z.input<typeof ocpActivityEventInputSchema>;
export type OcpActivityEvent = z.infer<typeof ocpActivityEventSchema>;
export type OcpPublicActivityEvent = z.infer<typeof ocpPublicActivityEventSchema>;
export type OcpActivityBatchInput = z.input<typeof ocpActivityBatchInputSchema>;
