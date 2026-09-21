import { useServerConfigStore } from '@/store/serverConfig';

import { readDingTalkApprovalCapability } from './capability';

export { readDingTalkApprovalCapability } from './capability';

/** Live capability flag for the 自动审批规则 nav entry and page (fails closed). */
export const useDingTalkApprovalEnabled = (): boolean =>
  useServerConfigStore((s) => readDingTalkApprovalCapability(s.serverConfig.enterprise));
