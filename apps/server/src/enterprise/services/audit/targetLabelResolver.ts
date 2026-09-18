import { inArray } from 'drizzle-orm';

import type { PlatformAuditPolicyItem } from '@/database/models/platform';
import { applyAuditConversationRedaction } from '@/database/models/platform';
import {
  files,
  platformAgents,
  platformAgentTemplates,
  platformConnectors,
  platformIdentityProviders,
  platformSkills,
  platformTaskTemplates,
  topics,
} from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

import { resolveUserRefs } from '../shared/userRefResolver';
import { resolveAgentRefs } from './agentRefResolver';

const FIND_BY_IDS_CHUNK = 200;

/** Target ids that name a singleton scope rather than a row. */
const SENTINEL_TARGET_IDS = new Set(['global', '__global__']);

const TARGET_LABEL_TYPES = [
  'agent',
  'agent_template',
  'connector',
  'file',
  'identity_provider',
  'skill',
  'task_template',
  'topic',
  'user',
] as const;

type TargetLabelType = (typeof TARGET_LABEL_TYPES)[number];

const TARGET_LABEL_TYPE_SET: ReadonlySet<string> = new Set(TARGET_LABEL_TYPES);

export interface TargetRef {
  targetId: string | null;
  targetType: string;
}

type NamedRow = { id: string; label: string | null };

const nonempty = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const targetLabelKey = (type: string, id: string): string => `${type}:${id}`;

export const targetLabelOf = (
  type: string,
  id: string | null | undefined,
  labels: Map<string, string>,
): string | null => (id ? (labels.get(targetLabelKey(type, id)) ?? null) : null);

const collectIdsByType = (rows: Iterable<TargetRef>): Map<TargetLabelType, string[]> => {
  const buckets = new Map<TargetLabelType, Set<string>>();
  for (const row of rows) {
    const id = row.targetId?.trim() ?? '';
    if (!id || SENTINEL_TARGET_IDS.has(id)) continue;
    if (!TARGET_LABEL_TYPE_SET.has(row.targetType)) continue;
    const type = row.targetType as TargetLabelType;
    const set = buckets.get(type) ?? new Set<string>();
    set.add(id);
    buckets.set(type, set);
  }
  return new Map([...buckets].map(([type, ids]) => [type, [...ids]]));
};

const loadNamedRows = async (
  ids: string[],
  query: (chunk: string[]) => Promise<NamedRow[]>,
): Promise<NamedRow[]> => {
  const rows: NamedRow[] = [];
  for (let i = 0; i < ids.length; i += FIND_BY_IDS_CHUNK) {
    rows.push(...(await query(ids.slice(i, i + FIND_BY_IDS_CHUNK))));
  }
  return rows;
};

const setLabels = (
  labels: Map<string, string>,
  type: string,
  rows: NamedRow[],
  mapLabel: (label: string | null) => string | null = nonempty,
) => {
  for (const row of rows) {
    const label = mapLabel(row.label);
    if (label) labels.set(targetLabelKey(type, row.id), label);
  }
};

const maskConversationEvidenceLabel = (
  value: string | null,
  redactionProfile: PlatformAuditPolicyItem['redactionProfile'] | null | undefined,
): string | null => {
  if (value == null) return null;
  return nonempty(applyAuditConversationRedaction(value, redactionProfile));
};

export interface ResolveTargetLabelsOptions {
  /**
   * Topic titles and file names are conversation evidence. Callers must pass true
   * only when policy `contentAccessMode !== 'disabled'` AND the actor has
   * `AUDIT_CONVERSATION_READ`. Omitted/false skips those lookups (UI falls back to id).
   */
  canSeeConversationEvidence?: boolean;
  redactionProfile?: PlatformAuditPolicyItem['redactionProfile'] | null;
}

/**
 * Batch-resolve audit target ids to human display names. One chunked lookup per
 * resolvable targetType. Sentinel ids (`global`) and unknown types/rows are omitted
 * (callers treat a missing map entry as `null`).
 */
export const resolveTargetLabels = async (
  db: LobeChatDatabase | Transaction,
  rows: Iterable<TargetRef>,
  options?: ResolveTargetLabelsOptions,
): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  const byType = collectIdsByType(rows);
  if (byType.size === 0) return labels;
  const canSeeConversationEvidence = options?.canSeeConversationEvidence === true;
  const redactionProfile = options?.redactionProfile;

  const loaders: Array<Promise<void>> = [];

  const userIds = byType.get('user');
  if (userIds) {
    loaders.push(
      (async () => {
        const refs = await resolveUserRefs(db, userIds);
        for (const [id, ref] of refs) {
          const label = nonempty(ref.fullName) ?? nonempty(ref.username) ?? nonempty(ref.email);
          if (label) labels.set(targetLabelKey('user', id), label);
        }
      })(),
    );
  }

  const agentIds = byType.get('agent');
  if (agentIds) {
    loaders.push(
      (async () => {
        const refs = await resolveAgentRefs(db, agentIds);
        const leftover: string[] = [];
        for (const id of agentIds) {
          const title = nonempty(refs.get(id)?.title);
          if (title) labels.set(targetLabelKey('agent', id), title);
          else leftover.push(id);
        }
        if (leftover.length === 0) return;
        // Platform catalog identities share targetType `agent` but live in platform_agents.
        const platformRows = await loadNamedRows(leftover, (chunk) =>
          db
            .select({ id: platformAgents.id, label: platformAgents.title })
            .from(platformAgents)
            .where(inArray(platformAgents.id, chunk)),
        );
        setLabels(labels, 'agent', platformRows);
      })(),
    );
  }

  const topicIds = byType.get('topic');
  if (topicIds && canSeeConversationEvidence) {
    loaders.push(
      loadNamedRows(topicIds, (chunk) =>
        db
          .select({ id: topics.id, label: topics.title })
          .from(topics)
          .where(inArray(topics.id, chunk)),
      ).then((named) => {
        setLabels(labels, 'topic', named, (title) =>
          maskConversationEvidenceLabel(title, redactionProfile),
        );
      }),
    );
  }

  const templateIds = byType.get('agent_template');
  if (templateIds) {
    loaders.push(
      loadNamedRows(templateIds, (chunk) =>
        db
          .select({ id: platformAgentTemplates.id, label: platformAgentTemplates.title })
          .from(platformAgentTemplates)
          .where(inArray(platformAgentTemplates.id, chunk)),
      ).then((named) => setLabels(labels, 'agent_template', named)),
    );
  }

  const taskTemplateIds = byType.get('task_template');
  if (taskTemplateIds) {
    loaders.push(
      loadNamedRows(taskTemplateIds, (chunk) =>
        db
          .select({ id: platformTaskTemplates.id, label: platformTaskTemplates.title })
          .from(platformTaskTemplates)
          .where(inArray(platformTaskTemplates.id, chunk)),
      ).then((named) => setLabels(labels, 'task_template', named)),
    );
  }

  const skillIds = byType.get('skill');
  if (skillIds) {
    loaders.push(
      loadNamedRows(skillIds, (chunk) =>
        db
          .select({ id: platformSkills.id, label: platformSkills.name })
          .from(platformSkills)
          .where(inArray(platformSkills.id, chunk)),
      ).then((named) => setLabels(labels, 'skill', named)),
    );
  }

  const fileIds = byType.get('file');
  if (fileIds && canSeeConversationEvidence) {
    loaders.push(
      loadNamedRows(fileIds, (chunk) =>
        db.select({ id: files.id, label: files.name }).from(files).where(inArray(files.id, chunk)),
      ).then((named) => {
        setLabels(labels, 'file', named, (name) =>
          maskConversationEvidenceLabel(name, redactionProfile),
        );
      }),
    );
  }

  const connectorIds = byType.get('connector');
  if (connectorIds) {
    loaders.push(
      loadNamedRows(connectorIds, (chunk) =>
        db
          .select({ id: platformConnectors.id, label: platformConnectors.displayName })
          .from(platformConnectors)
          .where(inArray(platformConnectors.id, chunk)),
      ).then((named) => setLabels(labels, 'connector', named)),
    );
  }

  const idpIds = byType.get('identity_provider');
  if (idpIds) {
    loaders.push(
      loadNamedRows(idpIds, (chunk) =>
        db
          .select({
            id: platformIdentityProviders.id,
            label: platformIdentityProviders.displayName,
          })
          .from(platformIdentityProviders)
          .where(inArray(platformIdentityProviders.id, chunk)),
      ).then((named) => setLabels(labels, 'identity_provider', named)),
    );
  }

  await Promise.all(loaders);
  return labels;
};
