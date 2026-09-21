'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { memo } from 'react';

import type { DingtalkWorkspaceApiNameType } from '../apiNames';
import ConfirmCard from '../components/ConfirmCard';

/**
 * Intervention body for every `lobe-dingtalk-workspace` write API: one generic
 * confirm card driven by the server-side `preview`, so the summary always
 * matches what the write would actually do.
 *
 * The host (`Tool/Detail/Intervention`) renders the 批准 / 拒绝 + 提交 footer, so
 * the card takes `registerBeforeApprove` to keep the hard gate: approving a write
 * whose preview failed or has not returned yet is rejected there.
 */
const Confirm = memo<BuiltinInterventionProps<Record<string, unknown>>>(
  ({ apiName, args, registerBeforeApprove }) => {
    if (!apiName) return null;

    return (
      <ConfirmCard
        apiName={apiName as DingtalkWorkspaceApiNameType}
        args={args ?? {}}
        registerBeforeApprove={registerBeforeApprove}
      />
    );
  },
);

Confirm.displayName = 'DingtalkWorkspaceConfirm';

export default Confirm;
