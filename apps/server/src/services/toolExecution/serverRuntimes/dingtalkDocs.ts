import {
  createDingtalkDocsRuntime,
  DingtalkDocsExecutionRuntime,
} from '@lobechat/builtin-tool-dingtalk-docs/executionRuntime';
import { DingtalkDocsIdentifier } from '@lobechat/builtin-tool-dingtalk-docs/manifest';

import type { DingtalkDocsApiName } from '@/server/enterprise/services/dingtalkDocs/types';
import { serverAppLinkResolver } from '@/server/utils/appLinks';

import type { ServerRuntimeRegistration } from './types';

export { createDingtalkDocsRuntime, DingtalkDocsExecutionRuntime };

export const dingtalkDocsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { serverDB, userId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for DingTalk docs execution');
    }

    const { runDingtalkDocsTool } = await import('@/server/enterprise/services/dingtalkDocs/tool');

    const resolveLink = serverAppLinkResolver(context.botPlatform);
    return createDingtalkDocsRuntime(
      {
        call: (apiName, args) =>
          runDingtalkDocsTool(serverDB, userId, apiName as DingtalkDocsApiName, args, {
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
  identifier: DingtalkDocsIdentifier,
};
