'use client';

import { Empty } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import { adminDingtalkApprovalRulesService } from '@/enterprise/client/services/adminDingtalkApprovalRules';
import { useDingTalkApprovalEnabled } from '@/features/DingTalkApprovalRules/useDingTalkApprovalEnabled';
import type { AdminDingtalkApprovalRuleItem } from '@/server/enterprise/contracts/adminDingtalkApprovalRules';

import { DINGTALK_APPROVAL_RULE_AUTO_REASON } from '../audit/shared/auditReasonCodes';
import AdminPageTemplate from '../primitives/AdminPageTemplate';
import { openDangerConfirm } from '../primitives/DangerConfirm';
import DataTable from '../primitives/DataTable';
import FilterBar from '../primitives/FilterBar';
import { runAdminMutation } from '../primitives/runAdminMutation';
import { displayUserLabel } from '../primitives/userLabel';
import { deriveAdminSystemPermissions } from '../system/controller';
import { buildAdminDingtalkApprovalRuleColumns } from './columns';
import { useAdminDingtalkApprovalRulesList } from './hooks';
import { invalidateAdminDingtalkApprovalRules } from './swrKeys';

const ownerLabel = (row: AdminDingtalkApprovalRuleItem): string =>
  displayUserLabel({
    email: row.userEmail,
    fullName: row.userDisplayName,
    id: row.userId,
  });

/**
 * 自动审批规则 (platform view): every DingTalk auto-approval rule a user has asked
 * the assistant to create, with the one intervention an administrator needs —
 * stopping a rule that is approving on someone's behalf.
 *
 * Rules are authored by their owner in chat, so there is nothing to create or
 * edit here; an administrator can only stop one, and the owner keeps the record.
 *
 * The surface is fail-closed on `enterprise.capabilities.dingtalkApproval` with the
 * same reader as the owner-facing settings tab: without DingTalk approval there are
 * no rules to govern, and a deep link has to say so rather than show an empty table.
 */
const DingtalkApprovalRulesPage = memo(() => {
  const { t } = useTranslation('admin');
  // The condition summary is shared with the owner's own settings page, so its copy
  // lives in the `setting` namespace.
  const { t: tSetting } = useTranslation('setting');
  const { authMethod, permissions, status } = useAdminAccess();
  const { canOperate, canRead } = deriveAdminSystemPermissions(permissions);
  const approvalEnabled = useDingTalkApprovalEnabled();
  const allowed = status === 'allowed';
  const enabled = allowed && canRead && approvalEnabled;

  const [disablingRuleId, setDisablingRuleId] = useState<string | null>(null);
  const { error, isLoading, items, mutate, query, searchDraft, setQuery, setSearchDraft, total } =
    useAdminDingtalkApprovalRulesList(enabled);

  const handleForceDisable = useCallback(
    (row: AdminDingtalkApprovalRuleItem) => {
      openDangerConfirm({
        confirmText: t('dingtalkApprovalRules.forceDisable'),
        content: t('dingtalkApprovalRules.forceDisableConfirm', {
          rule: row.name,
          user: ownerLabel(row),
        }),
        title: t('dingtalkApprovalRules.forceDisableTitle'),
        onConfirm: async () => {
          setDisablingRuleId(row.id);
          try {
            const committed = await runAdminMutation({
              authMethod,
              mapErrorKey: () => 'dingtalkApprovalRules.toast.forceDisableFailed',
              run: async () => {
                await adminDingtalkApprovalRulesService.disable({
                  reason: DINGTALK_APPROVAL_RULE_AUTO_REASON.disable,
                  ruleId: row.id,
                });
              },
            });
            if (!committed) return;
            toast.success(t('dingtalkApprovalRules.toast.forceDisabled'));
            await invalidateAdminDingtalkApprovalRules();
          } finally {
            setDisablingRuleId(null);
          }
        },
      });
    },
    [authMethod, t],
  );

  const columns = useMemo(
    () =>
      buildAdminDingtalkApprovalRuleColumns({
        canOperate,
        disablingRuleId,
        onForceDisable: handleForceDisable,
        t,
        tSetting,
      }),
    [canOperate, disablingRuleId, handleForceDisable, t, tSetting],
  );

  const description = t('dingtalkApprovalRules.desc');
  const title = t('dingtalkApprovalRules.title');

  if (!approvalEnabled)
    return (
      <AdminPageTemplate description={description} title={title}>
        <Empty description={t('dingtalkApprovalRules.unavailable')} />
      </AdminPageTemplate>
    );

  if (allowed && !canRead)
    return (
      <AdminPageTemplate description={description} title={title}>
        <Empty description={t('dingtalkApprovalRules.noReadPermission')} />
      </AdminPageTemplate>
    );

  return (
    <AdminPageTemplate description={description} title={title}>
      <DataTable<AdminDingtalkApprovalRuleItem>
        columns={columns}
        dataSource={items}
        error={Boolean(error) && !items.length}
        loading={isLoading && !items.length}
        pagination={{ current: query.page, pageSize: query.pageSize, total }}
        rowKey="id"
        scroll={{ x: 1430 }}
        emptyDescription={
          query.q.length > 0
            ? t('dingtalkApprovalRules.emptyFiltered')
            : t('dingtalkApprovalRules.empty')
        }
        toolbar={
          <FilterBar
            searchPlaceholder={t('dingtalkApprovalRules.searchPlaceholder')}
            values={{ query: searchDraft }}
            onChange={(next) => setSearchDraft(next.query)}
          />
        }
        onPaginationChange={(nextPage, nextPageSize) =>
          setQuery((prev) => ({
            ...prev,
            // A page-size change re-slices the list, so the old offset is meaningless.
            page: nextPageSize === prev.pageSize ? nextPage : 1,
            pageSize: nextPageSize,
          }))
        }
        onRetry={() => {
          void mutate();
        }}
      />
    </AdminPageTemplate>
  );
});

DingtalkApprovalRulesPage.displayName = 'AdminDingtalkApprovalRulesPage';

export default DingtalkApprovalRulesPage;
