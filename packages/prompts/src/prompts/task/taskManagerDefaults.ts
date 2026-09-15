export interface TaskManagerPromptDefaults {
  defaultAssigneeAgentId?: string;
  defaultAssigneeDisplayName?: string;
}

export const buildTaskManagerDefaultsBlock = ({
  defaultAssigneeAgentId,
  defaultAssigneeDisplayName,
}: TaskManagerPromptDefaults): string[] => {
  if (!defaultAssigneeAgentId) return [];

  const assistantName = defaultAssigneeDisplayName?.trim() || 'the default assistant';

  return [
    '<task_manager_defaults>',
    `Default assistant agent id: ${defaultAssigneeAgentId}`,
    `Use this id as assigneeAgentId when you decide a task should be assigned to ${assistantName}.`,
    `Do not use it as a listTasks filter unless the user asks for ${assistantName}'s tasks.`,
    '</task_manager_defaults>',
    '',
  ];
};

export const buildTaskManagerDefaultsPrompt = (defaults: TaskManagerPromptDefaults): string =>
  buildTaskManagerDefaultsBlock(defaults).join('\n').trim();
