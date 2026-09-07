import { AgentBrowserIdentifier } from '@lobechat/builtin-skills';
import { isDesktop } from '@lobechat/const';
import { type BuiltinSkill, type SkillItem, type SkillListItem } from '@lobechat/types';

export interface BuiltinSkillFilterContext {
  /**
   * Whether the current run can execute commands on a local device. Server-side
   * callers must derive this from the run's execution plan (`activeDeviceId`
   * presence) — the compile-time `isDesktop` constant is always false there.
   */
  canExecuteOnDevice: boolean;
}

const DEVICE_ONLY_BUILTIN_SKILLS = new Set([AgentBrowserIdentifier]);
const USER_HIDDEN_BUILTIN_SKILLS = new Set(['task']);

// Client default: the desktop app is itself the execution device.
const DEFAULT_CONTEXT: BuiltinSkillFilterContext = {
  canExecuteOnDevice: isDesktop,
};

const resolveBuiltinSkillFilterContext = (
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): BuiltinSkillFilterContext => ({
  canExecuteOnDevice: context.canExecuteOnDevice ?? DEFAULT_CONTEXT.canExecuteOnDevice,
});

export const shouldEnableBuiltinSkill = (
  skillId: string,
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): boolean => {
  const resolvedContext = resolveBuiltinSkillFilterContext(context);

  if (USER_HIDDEN_BUILTIN_SKILLS.has(skillId)) return false;

  if (DEVICE_ONLY_BUILTIN_SKILLS.has(skillId)) return resolvedContext.canExecuteOnDevice;

  return true;
};

export const filterBuiltinSkills = (
  skills: BuiltinSkill[],
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): BuiltinSkill[] => {
  return skills.filter((skill) => shouldEnableBuiltinSkill(skill.identifier, context));
};

export { USER_HIDDEN_BUILTIN_SKILLS };

/**
 * User-scope disable inputs for the client skill pool.
 *
 * `uninstalledBuiltinTools` covers bundled builtin skills (a listed identifier
 * means disabled), `disabledSkillIdentifiers` covers installed market/user
 * skills and platform catalog skills. Both lists are already resolved for the
 * active context (personal or workspace) by the tool store.
 */
export interface DisabledSkillScope {
  /** Installed `agent_skills` identifiers / platform `skillKey`s the user disabled. */
  disabledSkillIdentifiers?: readonly string[];
  /** Catalog keys the organization marks mandatory — never disableable by a user. */
  mandatorySkillIds?: Iterable<string>;
  /** Bundled builtin skill / builtin tool identifiers the user uninstalled. */
  uninstalledBuiltinTools?: readonly string[];
}

/**
 * Union of the user's disabled skill identifiers, minus mandatory catalog keys.
 *
 * A disabled skill must behave exactly like an uninstalled one: dropped from the
 * candidate pool AND unresolvable by name, so a model that already knows the
 * name cannot activate it.
 */
export const collectDisabledSkillIds = ({
  disabledSkillIdentifiers,
  mandatorySkillIds,
  uninstalledBuiltinTools,
}: DisabledSkillScope): Set<string> => {
  const disabled = new Set<string>([
    ...(uninstalledBuiltinTools ?? []),
    ...(disabledSkillIdentifiers ?? []),
  ]);

  // Mandatory distribution wins over any stale user entry.
  for (const id of mandatorySkillIds ?? []) disabled.delete(id);

  return disabled;
};

/** Minimal skill-lookup surface shared by the client skill runtime services. */
interface SkillLookupService {
  findAll: () => Promise<{ data: SkillListItem[]; total: number }>;
  findById: (id: string) => Promise<SkillItem | undefined>;
  findByName: (name: string) => Promise<SkillItem | undefined>;
}

/**
 * Wrap a skill runtime service so disabled skills are invisible to it.
 *
 * The lookups are keyed by id / name, so the guard matches on the resolved
 * item's `identifier` — the same key the disable lists store.
 */
export const withDisabledSkillGuard = <T extends SkillLookupService>(
  service: T,
  disabledIds: ReadonlySet<string>,
): T => {
  if (disabledIds.size === 0) return service;

  const guard = (skill: SkillItem | undefined) =>
    skill && disabledIds.has(skill.identifier) ? undefined : skill;

  // Spreading a generic keeps the extra members (execScript, readResource…) that
  // the concrete runtime services add on top of the lookup surface.
  return {
    ...service,
    findAll: async () => {
      const { data } = await service.findAll();
      const filtered = data.filter((skill) => !disabledIds.has(skill.identifier));
      return { data: filtered, total: filtered.length };
    },
    findById: async (id: string) => guard(await service.findById(id)),
    findByName: async (name: string) => guard(await service.findByName(name)),
  } as T;
};
