import { describe, expect, it } from 'vitest';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { ADMIN_NAV_ICONS } from '@/enterprise/client/nav/adminIcons';
import {
  ADMIN_NAV_FLAT,
  ADMIN_NAV_ITEMS,
  filterAdminNavByPermissions,
} from '@/enterprise/client/nav/adminNavMeta';
import { getAdminPageComponentId } from '@/enterprise/client/nav/adminPageCatalog';
import { createAdminRouteTree } from '@/enterprise/client/routes/admin/createAdminRouteTree';

const NAV_ID = 'dingtalk-approval-rules';

describe('DingTalk approval rules nav registration', () => {
  it('is a child of the 系统 group, right after 通用设置', () => {
    const system = ADMIN_NAV_ITEMS.find((item) => item.id === 'system');
    const ids = (system?.children ?? [])
      .filter((child) => !child.hideFromNav)
      .map((child) => child.id);

    expect(ids).toContain(NAV_ID);
    // The DingTalk connector and its automation tier are configured in 通用设置;
    // this page is the data those switches govern.
    expect(ids.indexOf(NAV_ID)).toBe(ids.indexOf('system-general') + 1);
  });

  it('declares the system read permission and its own path', () => {
    const item = ADMIN_NAV_FLAT.find((entry) => entry.id === NAV_ID);
    expect(item).toBeDefined();
    expect(item?.path).toBe('/admin/system/dingtalk-approval-rules');
    expect(item?.labelKey).toBe('nav.dingtalkApprovalRules');
    expect(item?.requiredPermissions).toEqual([PLATFORM_PERMISSIONS.SYSTEM_READ]);
    // Owned by the 审批与自动审批 module (a child of 钉钉 on 模块配置)…
    expect(item?.moduleId).toBe('dingtalkApproval');
    // …and there is nothing to govern where the deployment has no DingTalk approval.
    expect(item?.capabilityId).toBe('dingtalkApproval');
  });

  it('is hidden from the side nav unless the DingTalk approval capability is on', () => {
    const granted = [PLATFORM_PERMISSIONS.SYSTEM_READ];
    const visibleIds = (capability: boolean) =>
      filterAdminNavByPermissions(ADMIN_NAV_ITEMS, granted, undefined, {
        dingtalkApproval: capability,
      }).flatMap((item) => [item.id, ...(item.children?.map((child) => child.id) ?? [])]);

    expect(visibleIds(true)).toContain(NAV_ID);
    // Fail-closed, exactly like the owner-facing settings tab.
    expect(visibleIds(false)).not.toContain(NAV_ID);
    // The rest of the 系统 group is unaffected.
    expect(visibleIds(false)).toContain('system-general');
  });

  it('has an icon and a real page component (never the 404 fallback)', () => {
    expect(ADMIN_NAV_ICONS[NAV_ID]).toBeDefined();
    expect(getAdminPageComponentId(NAV_ID)).toBe('DingtalkApprovalRulesPage');
  });

  it('is reachable through the shared admin route tree with its permission attached', () => {
    const tree = createAdminRouteTree();
    const adminRoot = tree.find((route) => route.path === '/admin');
    const leaf = (adminRoot?.children ?? []).find(
      (route) => route.path === 'system/dingtalk-approval-rules',
    );

    expect(leaf).toBeDefined();
    expect(
      (leaf?.handle as { admin?: { requiredPermissions?: readonly string[] } })?.admin
        ?.requiredPermissions,
    ).toEqual([PLATFORM_PERMISSIONS.SYSTEM_READ]);
  });
});
