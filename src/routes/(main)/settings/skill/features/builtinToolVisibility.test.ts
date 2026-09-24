import { describe, expect, it } from 'vitest';

import {
  type EnterpriseToolCapabilities,
  isBuiltinToolAvailableInDeployment,
  isPlatformManagedBuiltinTool,
} from './builtinToolVisibility';

describe('isPlatformManagedBuiltinTool', () => {
  // The tools engine keys these on the deployment capability flag and
  // ignores `uninstalledBuiltinTools`, so no per-user control may be offered.
  it.each([
    'lobe-dingtalk-approval',
    'lobe-dingtalk-personal',
    'lobe-dingtalk-workspace',
    'lobe-enterprise-lookup',
  ])('reports %s as administrator-governed', (identifier) => {
    expect(isPlatformManagedBuiltinTool(identifier)).toBe(true);
  });

  it.each(['lobe-calculator', 'lobe-creds', 'lobe-task'])(
    'leaves %s under per-user control',
    (identifier) => {
      expect(isPlatformManagedBuiltinTool(identifier)).toBe(false);
    },
  );

  it('covers exactly the tools the capability gate knows about', () => {
    const gated = [
      'lobe-dingtalk-approval',
      'lobe-dingtalk-personal',
      'lobe-dingtalk-workspace',
      'lobe-enterprise-lookup',
    ];
    const allOn: EnterpriseToolCapabilities = {
      dingtalkApproval: true,
      dingtalkCalendar: true,
      dingtalkPersonal: true,
      dingtalkTodo: true,
      enterpriseLookup: true,
    };

    for (const identifier of gated) {
      expect(isBuiltinToolAvailableInDeployment(identifier, undefined)).toBe(false);
      expect(isBuiltinToolAvailableInDeployment(identifier, allOn)).toBe(true);
      expect(isPlatformManagedBuiltinTool(identifier)).toBe(true);
    }
  });
});

describe('isBuiltinToolAvailableInDeployment', () => {
  it('lists ungated builtin tools whatever the capability payload says', () => {
    expect(isBuiltinToolAvailableInDeployment('lobe-calculator', undefined)).toBe(true);
    expect(isBuiltinToolAvailableInDeployment('lobe-creds', {})).toBe(true);
  });

  it.each([
    ['lobe-dingtalk-approval', { dingtalkApproval: true }],
    ['lobe-dingtalk-personal', { dingtalkPersonal: true }],
    ['lobe-dingtalk-workspace', { dingtalkTodo: true }],
    ['lobe-dingtalk-workspace', { dingtalkCalendar: true }],
    ['lobe-enterprise-lookup', { enterpriseLookup: true }],
  ] as [string, EnterpriseToolCapabilities][])(
    'lists %s once its capability is on',
    (identifier, capabilities) => {
      expect(isBuiltinToolAvailableInDeployment(identifier, capabilities)).toBe(true);
    },
  );

  // Fails closed: a missing / unknown payload must hide the tool rather than
  // advertise one whose backend is switched off.
  it.each([
    'lobe-dingtalk-approval',
    'lobe-dingtalk-personal',
    'lobe-dingtalk-workspace',
    'lobe-enterprise-lookup',
  ])('hides %s while its capability is unknown or off', (identifier) => {
    expect(isBuiltinToolAvailableInDeployment(identifier, undefined)).toBe(false);
    expect(isBuiltinToolAvailableInDeployment(identifier, {})).toBe(false);
    expect(
      isBuiltinToolAvailableInDeployment(identifier, {
        dingtalkApproval: false,
        dingtalkCalendar: false,
        dingtalkPersonal: false,
        dingtalkTodo: false,
        enterpriseLookup: false,
      }),
    ).toBe(false);
  });

  it('keeps personal data and the workspace tool on separate flags', () => {
    expect(
      isBuiltinToolAvailableInDeployment('lobe-dingtalk-personal', {
        dingtalkCalendar: true,
        dingtalkTodo: true,
      }),
    ).toBe(false);
    expect(
      isBuiltinToolAvailableInDeployment('lobe-dingtalk-workspace', { dingtalkPersonal: true }),
    ).toBe(false);
  });

  it('keeps the DingTalk workspace tool hidden when only approval is on', () => {
    expect(
      isBuiltinToolAvailableInDeployment('lobe-dingtalk-workspace', { dingtalkApproval: true }),
    ).toBe(false);
  });
});
