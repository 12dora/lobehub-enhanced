/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BeforeApproveRefusedError,
  getBeforeApproveSnapshot,
  runBeforeApproveWhenReady,
} from '../Messages/AssistantGroup/Tool/Detail/Intervention/beforeApproveRegistry';
import UserInterventionErrorBoundary, {
  InterventionRenderFallbackError,
} from './UserInterventionErrorBoundary';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  toolInterventionSelectors: { approvalMode: () => 'manual' },
}));

vi.mock('../Messages/AssistantGroup/Tool/Detail/Intervention/ApprovalActions', () => ({
  default: () => <div>fallback footer</div>,
}));

vi.mock('./interventionLabel', () => ({
  useInterventionLabel: () => '完成待办',
}));

const CrashingCard = () => {
  throw new Error('card crashed');
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderCrashed = (toolMessageId: string) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return render(
    <UserInterventionErrorBoundary
      apiName="completeTodo"
      identifier="lobe-dingtalk-personal"
      requestArgs='{"taskId":"1"}'
      toolCallId={`call_${toolMessageId}`}
      toolMessageId={toolMessageId}
    >
      <CrashingCard />
    </UserInterventionErrorBoundary>,
  );
};

describe('UserInterventionErrorBoundary fallback', () => {
  it('keeps the one-by-one footer', () => {
    renderCrashed('crashed-1');

    expect(screen.getByText('fallback footer')).toBeInTheDocument();
  });

  it('is never "on screen without checks": approve all is refused for a crashed card', async () => {
    renderCrashed('crashed-2');

    expect(getBeforeApproveSnapshot('crashed-2')).toMatchObject({ checkCount: 1, mounted: true });

    const error = await runBeforeApproveWhenReady('crashed-2').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BeforeApproveRefusedError);
    expect((error as BeforeApproveRefusedError).reason).toBeInstanceOf(
      InterventionRenderFallbackError,
    );
  });

  it('drops its registration when the fallback goes away', () => {
    const { unmount } = renderCrashed('crashed-3');
    unmount();

    expect(getBeforeApproveSnapshot('crashed-3')).toMatchObject({ checkCount: 0, mounted: false });
  });
});
