import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Mirror of the `dingtalkDocs.preview` output (contract §E.3). The method is annotated with it,
 * so a drift between the router's inferred output and this type is a type error here rather than a
 * silent mismatch in the confirm card.
 */
export interface DingtalkDocsPreview {
  danger: boolean;
  lines: string[];
  title: string;
  warnings: string[];
}

type CallToolInput = Parameters<typeof lambdaClient.dingtalkDocs.callTool.mutate>[0];
type PreviewInput = Parameters<typeof lambdaClient.dingtalkDocs.preview.query>[0];

/**
 * Client access to the 钉钉文档与表格 lambda router (`lobe-dingtalk-docs`). It runs on the member's
 * own 钉钉个人数据 authorization, so login and status stay on `dingtalkPersonalService`; this service
 * only executes the tool server-side and fetches the confirm-card preview of a write.
 */
class DingtalkDocsService {
  callTool = async (params: CallToolInput): Promise<BuiltinServerRuntimeOutput> => {
    return lambdaClient.dingtalkDocs.callTool.mutate(params);
  };

  preview = async (params: PreviewInput): Promise<DingtalkDocsPreview> => {
    return lambdaClient.dingtalkDocs.preview.query(params);
  };
}

export const dingtalkDocsService = new DingtalkDocsService();
