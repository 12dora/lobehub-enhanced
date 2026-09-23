/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zh from '../../../../../../../locales/zh-CN/chat.json';
import { CANCEL_INTERVENTION_REASON } from './Intervention/CancelInterventionButton';
import RejectedResponse from './RejectedResponse';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: keyof typeof zh, params?: Record<string, string>) =>
      String(zh[key]).replace('{{reason}}', params?.reason ?? ''),
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
}));

describe('RejectedResponse', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the localized "you cancelled" line for a cancelled approval, not the model-facing sentence', () => {
    render(<RejectedResponse reason={CANCEL_INTERVENTION_REASON} />);

    expect(screen.getByText(zh['tool.intervention.toolAbort'])).toBeTruthy();
    expect(screen.queryByText(new RegExp(CANCEL_INTERVENTION_REASON))).toBeNull();
  });

  it('keeps the user-typed reason for a real rejection', () => {
    render(<RejectedResponse reason="先别删" />);

    expect(screen.getByText('本次技能调用已被拒绝：先别删')).toBeTruthy();
  });

  it('falls back to the plain rejected line without a reason', () => {
    render(<RejectedResponse />);

    expect(screen.getByText(zh['tool.intervention.toolRejected'])).toBeTruthy();
  });
});
