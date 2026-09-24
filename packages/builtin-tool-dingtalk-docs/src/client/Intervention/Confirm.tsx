'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { memo } from 'react';

import { isDingtalkDocsWriteApiName } from '../apiNames';
import ConfirmCard from '../components/ConfirmCard';

/**
 * Intervention body for every `lobe-dingtalk-docs` write API (appendDoc, createDoc,
 * appendSheetRows, createAitableRecords, updateAitableRecords): one confirm card driven by the
 * server-side `preview`, so the summary always matches what the write would actually do.
 *
 * The host (`Tool/Detail/Intervention`) renders the 批准 / 拒绝 + 提交 footer, so the card takes
 * `registerBeforeApprove` to keep the hard gate: approving a write whose preview failed or has not
 * returned yet is rejected there. A read never reaches this card.
 */
const Confirm = memo<BuiltinInterventionProps<Record<string, unknown>>>(
  ({ apiName, args, messageId, registerBeforeApprove }) => {
    if (!isDingtalkDocsWriteApiName(apiName)) return null;

    return (
      <ConfirmCard
        apiName={apiName}
        args={args ?? {}}
        messageId={messageId}
        registerBeforeApprove={registerBeforeApprove}
      />
    );
  },
);

Confirm.displayName = 'DingtalkDocsConfirm';

export default Confirm;
