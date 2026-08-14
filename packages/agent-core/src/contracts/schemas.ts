/**
 * Zod-schemas voor de canonieke AIOS-contracten. Twee doelen:
 *  1. Structured-output-validatie voor LLM-calls (router-classify,
 *     specialist-produce, aggregator-output).
 *  2. Roundtrip-validatie op de store-mapping (snake_case ↔ camelCase) zodat
 *     schemadrift in de Supabase-laag niet stil breekt.
 *
 * Deze schemas zijn afgeleid van de types in `./index.ts` — houd ze in sync.
 * Wijzig eerst de type, dan het schema. De tests in `./schemas.test.ts`
 * dwingen roundtrip-consistentie af.
 */

import { z } from 'zod';
import type {
  Automation,
  CompoundMetadata,
  CompoundTaskSummary,
  GroundingRef,
  IntentClassification,
  IntentFlags,
  MemoryEntry,
  PartialResponse,
  PartialResponseStatus,
  PartialToolCall,
  ReviewItem,
  Signal,
  SpecialistId,
  TaskDescriptor,
} from './index.js';

// ────────────────────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────────────────────

export const SignalStatusSchema = z.enum([
  'NEW',
  'PROCESSING',
  'DONE',
  'IGNORED',
  'FAILED',
]);

export const ReviewStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'EDITED',
  'REJECTED',
  'EXECUTED',
]);

export const MemoryScopeSchema = z.enum(['GLOBAL', 'CLIENT', 'PROCESS']);
export const AutonomySchema = z.enum(['REVIEW', 'AUTO']);
export const MemoryLabelSchema = z.enum(['GOOD', 'BAD']);

export const PartialResponseStatusSchema = z.enum([
  'ok',
  'needs_human',
  'error',
]);

/**
 * Kern-specialisten zijn expliciet; onbekende strings zijn ook toegestaan
 * (data-driven experimentele specialisten uit `aios_experimental_specialists`).
 * Dit spiegelt de `SpecialistId = ... | (string & {})` in de types.
 */
export const SpecialistIdSchema: z.ZodType<SpecialistId> = z.string().min(1);

// ────────────────────────────────────────────────────────────────────────────
// Bouwstenen
// ────────────────────────────────────────────────────────────────────────────

export const GroundingRefSchema: z.ZodType<GroundingRef> = z.object({
  claim: z.string(),
  toolCallId: z.string(),
  tool: z.string(),
});

export const IntentFlagsSchema: z.ZodType<IntentFlags> = z.object({
  hasImage: z.boolean(),
  urgent: z.boolean(),
  juridicalLanguage: z.boolean(),
  gdprSignals: z.boolean(),
  complaintSignals: z.boolean(),
  compound: z.boolean(),
  secondary: SpecialistIdSchema.nullable().optional(),
});

export const TaskDescriptorSchema: z.ZodType<TaskDescriptor> = z.object({
  id: z.string().min(1),
  intent: SpecialistIdSchema,
  subject: z.string(),
  briefing: z.string().optional(),
  refs: z.record(z.string(), z.string().nullable()),
  flags: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
});

export const TopCandidateSchema = z.object({
  specialist: SpecialistIdSchema,
  score: z.number().min(0).max(1),
});

export const IntentClassificationSchema: z.ZodType<IntentClassification> =
  z.object({
    primary: SpecialistIdSchema,
    confidence: z.number().min(0).max(1),
    compound: z.boolean(),
    tasks: z.array(TaskDescriptorSchema).min(1),
    flags: IntentFlagsSchema,
    reasoning: z.string(),
    lowConfidence: z.boolean().optional(),
    topCandidates: z.array(TopCandidateSchema).optional(),
  });

export const PartialToolCallSchema = z.object({
  tool: z.string(),
  params: z.record(z.string(), z.unknown()),
  // `unknown` in de TS-type wordt door Zod als optional geïnfereerd; gebruik
  // `z.any()` zodat de field verplicht blijft (accepteert nog steeds elke
  // waarde inclusief `null`/`undefined`).
  result: z.any(),
  ok: z.boolean(),
  toolCallId: z.string().optional(),
}) satisfies z.ZodType<PartialToolCall>;

export const PartialResponseSchema: z.ZodType<PartialResponse> = z.object({
  signalId: z.string(),
  taskId: z.string(),
  intent: SpecialistIdSchema,
  status: PartialResponseStatusSchema,
  resolvedRefs: z.record(z.string(), z.string().nullable()),
  facts: z.record(z.string(), z.unknown()),
  proposedContent: z.string(),
  confidence: z.number().min(0).max(1),
  grounding: z.array(GroundingRefSchema),
  toolCalls: z.array(PartialToolCallSchema).optional(),
  reason: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const CompoundTaskSummarySchema: z.ZodType<CompoundTaskSummary> =
  z.object({
    taskId: z.string(),
    intent: SpecialistIdSchema,
    status: PartialResponseStatusSchema,
    confidence: z.number().min(0).max(1),
    summary: z.string(),
    reason: z.string().nullable().optional(),
  });

export const CompoundMetadataSchema: z.ZodType<CompoundMetadata> = z.object({
  compound: z.literal(true),
  tasks: z.array(CompoundTaskSummarySchema),
  precedenceIntent: SpecialistIdSchema.nullable().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Canonieke top-level entiteiten
// ────────────────────────────────────────────────────────────────────────────

export const SignalSchema: z.ZodType<Signal> = z.object({
  id: z.string(),
  organizationId: z.string(),
  domain: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: SignalStatusSchema,
  contactId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
  receivedAt: z.string(),
  processedAt: z.string().nullable().optional(),
});

export const ReviewItemSchema: z.ZodType<ReviewItem> = z.object({
  id: z.string(),
  organizationId: z.string(),
  signalId: z.string().nullable().optional(),
  kind: z.string(),
  summary: z.string(),
  proposed: z.record(z.string(), z.unknown()),
  confidence: z.number().nullable().optional(),
  grounding: z.array(GroundingRefSchema).nullable().optional(),
  status: ReviewStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().nullable().optional(),
  executedAt: z.string().nullable().optional(),
  compound: z.boolean().nullable().optional(),
  tasks: z.array(CompoundTaskSummarySchema).nullable().optional(),
  precedenceIntent: SpecialistIdSchema.nullable().optional(),
});

export const MemoryEntrySchema: z.ZodType<MemoryEntry> = z.object({
  id: z.string(),
  organizationId: z.string(),
  scope: MemoryScopeSchema,
  pinned: z.boolean(),
  title: z.string(),
  body: z.string(),
  embedding: z.array(z.number()).nullable().optional(),
  source: z.string(),
  sourceRef: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  createdAt: z.string(),
  label: MemoryLabelSchema.nullable().optional(),
  supersededDraft: z.string().nullable().optional(),
});

export const AutomationSchema: z.ZodType<Automation> = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  trigger: z.string(),
  schedule: z.string().nullable().optional(),
  autonomy: AutonomySchema,
  enabled: z.boolean(),
  toolScope: z.array(z.string()),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
});
