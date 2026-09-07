/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type AdminToolScope, useAdminToolScope } from '@/features/AdminToolScope';

import {
  publishSkillStoreAdminScope,
  SkillStoreAdminScopeProvider,
  useSkillStoreAdminScopeSync,
} from './adminScope';

const makeScope = (enabled: boolean) =>
  ({
    isBuiltinSkillEnabled: () => enabled,
  }) as unknown as AdminToolScope;

const Consumer = () => {
  const scope = useAdminToolScope();

  if (!scope) return <span data-testid="scope">none</span>;

  return <span data-testid="scope">{String(scope.isBuiltinSkillEnabled('lobe-artifacts'))}</span>;
};

const Opener = ({ scope }: { scope: AdminToolScope | null }) => {
  useSkillStoreAdminScopeSync(scope);

  return null;
};

describe('Skill Store admin scope bridge', () => {
  afterEach(() => {
    act(() => {
      publishSkillStoreAdminScope(null);
    });
  });

  it('renders the modal subtree without a scope on user surfaces', () => {
    render(
      <SkillStoreAdminScopeProvider>
        <Consumer />
      </SkillStoreAdminScopeProvider>,
    );

    expect(screen.getByTestId('scope')).toHaveTextContent('none');
  });

  it('re-renders the modal subtree when a fresher scope is published', () => {
    publishSkillStoreAdminScope(makeScope(true));

    render(
      <SkillStoreAdminScopeProvider>
        <Consumer />
      </SkillStoreAdminScopeProvider>,
    );
    expect(screen.getByTestId('scope')).toHaveTextContent('true');

    // The org catalog refetched after a toggle: the opener publishes a new
    // scope object and the detached modal must follow it.
    act(() => {
      publishSkillStoreAdminScope(makeScope(false));
    });

    expect(screen.getByTestId('scope')).toHaveTextContent('false');
  });

  it('publishes the opener scope and clears it on unmount', () => {
    const first = makeScope(true);
    const { rerender, unmount } = render(
      <>
        <Opener scope={first} />
        <SkillStoreAdminScopeProvider>
          <Consumer />
        </SkillStoreAdminScopeProvider>
      </>,
    );

    expect(screen.getByTestId('scope')).toHaveTextContent('true');

    rerender(
      <>
        <Opener scope={makeScope(false)} />
        <SkillStoreAdminScopeProvider>
          <Consumer />
        </SkillStoreAdminScopeProvider>
      </>,
    );
    expect(screen.getByTestId('scope')).toHaveTextContent('false');

    unmount();

    render(
      <SkillStoreAdminScopeProvider>
        <Consumer />
      </SkillStoreAdminScopeProvider>,
    );
    expect(screen.getByTestId('scope')).toHaveTextContent('none');
  });
});
