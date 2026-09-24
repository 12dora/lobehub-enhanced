import {
  createDingtalkPersonalRuntime,
  DingtalkPersonalExecutionRuntime,
} from '@lobechat/builtin-tool-dingtalk-personal/executionRuntime';
import { DingtalkPersonalIdentifier } from '@lobechat/builtin-tool-dingtalk-personal/manifest';

import { serverAppLinkResolver } from '@/server/utils/appLinks';

import type { ServerRuntimeRegistration } from './types';

export { createDingtalkPersonalRuntime, DingtalkPersonalExecutionRuntime };

export const dingtalkPersonalRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { serverDB, userId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for DingTalk personal data execution');
    }

    // Domain handler is owned by B3b. Loaded lazily so the registry can list
    // this identifier without pulling the broker client at startup.
    const { runDingtalkPersonalTool } =
      await import('@/server/enterprise/services/dingtalkPersonal/tool');

    const resolveLink = serverAppLinkResolver(context.botPlatform);
    return createDingtalkPersonalRuntime(
      {
        call: (apiName, args) =>
          runDingtalkPersonalTool(serverDB, userId, apiName, args, {
            botPlatform: context.botPlatform,
            botThreadId: context.botThreadId,
            resolveLink,
            topicId: context.topicId,
            workspaceId: context.workspaceId,
          }),
      },
      { resolveLink },
    );
  },
  identifier: DingtalkPersonalIdentifier,
};
