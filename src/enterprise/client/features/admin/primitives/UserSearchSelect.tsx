'use client';

import { Flexbox } from '@lobehub/ui';
import { AutoComplete, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminUsersService } from '@/enterprise/client/services/adminUsers';
import type { UserPublicRef } from '@/server/enterprise/contracts/adminUsers';

import { displayUserLabel, displayUserSecondary } from './userLabel';

const DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 20;
/** Synthetic option value for the explicit "use this as an id" row. */
const USE_TYPED_PREFIX = '__use_typed__:';

const styles = createStaticStyles(({ css }) => ({
  optionSecondary: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  root: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 220px;
  `,
}));

export interface UserSearchSelectProps {
  'allowClear'?: boolean;
  /**
   * When true, append an explicit "use this as a user id" option so legal holds and
   * offline paste can target an id that is not in the directory yet. Default false —
   * typed text never silently becomes a userId.
   */
  'allowRawId'?: boolean;
  'aria-label'?: string;
  'disabled'?: boolean;
  /** When false, skip the remote search and show the no-permission hint. */
  'enabled'?: boolean;
  'id'?: string;
  'onChange': (userId: string | undefined, ref?: UserPublicRef) => void;
  'placeholder'?: string;
  'style'?: React.CSSProperties;
  /** Controlled selected user id. */
  'userId'?: string;
  /** Pre-seeded input label when the selected id is known but not in search results. */
  'valueLabel'?: string;
}

interface OptionRow {
  label: React.ReactNode;
  value: string;
}

const UserSearchSelect = memo<UserSearchSelectProps>(
  ({
    allowClear = true,
    allowRawId = false,
    'aria-label': ariaLabel,
    disabled,
    enabled = true,
    id,
    onChange,
    placeholder,
    style,
    userId,
    valueLabel,
  }) => {
    const { t } = useTranslation('admin');
    const [options, setOptions] = useState<OptionRow[]>([]);
    const [inputValue, setInputValue] = useState(valueLabel ?? '');
    const [errorHint, setErrorHint] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [open, setOpen] = useState(false);
    const debounceRef = useRef<number | null>(null);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(true);
    const rootRef = useRef<HTMLDivElement>(null);
    const usersById = useRef(new Map<string, UserPublicRef>());

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        requestIdRef.current += 1;
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
      };
    }, []);

    useEffect(() => {
      if (!userId) {
        setInputValue('');
        return;
      }
      if (valueLabel) {
        setInputValue(valueLabel);
        return;
      }
      if (usersById.current.has(userId)) {
        setInputValue(displayUserLabel(usersById.current.get(userId)!));
      } else {
        setInputValue(userId);
      }
    }, [userId, valueLabel]);

    const withRawIdOption = useCallback(
      (base: OptionRow[], typed: string): OptionRow[] => {
        if (!allowRawId) return base;
        const trimmed = typed.trim();
        if (!trimmed) return base;
        if (base.some((row) => row.value === trimmed)) return base;
        return [
          ...base,
          {
            label: t('primitives.userSearch.useId', {
              defaultValue: `Use ID: ${trimmed}`,
              id: trimmed,
            }),
            value: `${USE_TYPED_PREFIX}${trimmed}`,
          },
        ];
      },
      [allowRawId, t],
    );

    const runSearch = useCallback(
      async (query: string) => {
        const trimmed = query.trim();
        if (!enabled) {
          requestIdRef.current += 1;
          setLoading(false);
          setSearched(false);
          setErrorHint(t('primitives.userSearch.noPermission'));
          setOptions(withRawIdOption([], trimmed));
          return;
        }
        if (trimmed.length < 1) {
          requestIdRef.current += 1;
          setLoading(false);
          setSearched(false);
          setOptions([]);
          setErrorHint(null);
          return;
        }
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setSearched(false);
        try {
          const result = await adminUsersService.search({ limit: SEARCH_LIMIT, q: trimmed });
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setErrorHint(null);
          for (const item of result.items) usersById.current.set(item.id, item);
          const mapped = result.items.map((item) => {
            const secondary = displayUserSecondary(item);
            return {
              label: (
                <Flexbox horizontal align={'center'} gap={8}>
                  <span>{displayUserLabel(item)}</span>
                  {secondary ? <span className={styles.optionSecondary}>{secondary}</span> : null}
                </Flexbox>
              ),
              value: item.id,
            };
          });
          setOptions(withRawIdOption(mapped, trimmed));
        } catch {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setErrorHint(t('primitives.userSearch.failed'));
          setOptions(withRawIdOption([], trimmed));
        } finally {
          if (mountedRef.current && requestId === requestIdRef.current) {
            setLoading(false);
            setSearched(true);
          }
        }
      },
      [enabled, t, withRawIdOption],
    );

    const scheduleSearch = useCallback(
      (query: string) => {
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => void runSearch(query), DEBOUNCE_MS);
      },
      [runSearch],
    );

    const clear = useCallback(() => {
      requestIdRef.current += 1;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      setInputValue('');
      setOptions([]);
      setErrorHint(null);
      setLoading(false);
      setSearched(false);
      setOpen(false);
      onChange(undefined);
    }, [onChange]);

    const handleValueChange = useCallback(
      (next?: string) => {
        const text = next ?? '';
        if (!text.trim()) {
          clear();
          return;
        }
        if (text.startsWith(USE_TYPED_PREFIX)) {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          requestIdRef.current += 1;
          const id = text.slice(USE_TYPED_PREFIX.length).trim();
          setInputValue(id);
          setOpen(false);
          setOptions([]);
          onChange(id || undefined);
          return;
        }
        const picked = usersById.current.get(text);
        if (picked) {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          requestIdRef.current += 1;
          setInputValue(displayUserLabel(picked));
          setOpen(false);
          onChange(picked.id, picked);
          return;
        }
        setInputValue(text);
        setOpen(true);
        scheduleSearch(text);
      },
      [clear, onChange, scheduleSearch],
    );

    const hasDropdownRows = options.length > 0;
    const showDropdown = open && inputValue.trim().length > 0 && hasDropdownRows;

    // AutoComplete forwards leftover props to Autocomplete.Root (no DOM). `id` still
    // reaches ComboboxInput via root context; `aria-label` does not, so stamp it on
    // the actual input the three labelled call sites need.
    useLayoutEffect(() => {
      const input = rootRef.current?.querySelector('input');
      if (!input) return;
      if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
      else input.removeAttribute('aria-label');
    }, [ariaLabel, inputValue]);

    return (
      <div className={styles.root} ref={rootRef} style={style}>
        <AutoComplete
          allowClear={allowClear}
          disabled={disabled}
          filter={null}
          id={id}
          open={showDropdown}
          options={options}
          placeholder={placeholder ?? t('primitives.userSearch.placeholder')}
          style={{ width: '100%' }}
          value={inputValue}
          onChange={handleValueChange}
          onOpenChange={setOpen}
        />
        {errorHint ? (
          <Text role="status" style={{ fontSize: 12 }} type="secondary">
            {errorHint}
          </Text>
        ) : loading ? (
          <Text role="status" style={{ fontSize: 12 }} type="secondary">
            {t('primitives.userSearch.loading')}
          </Text>
        ) : searched && options.length === 0 && inputValue.trim().length > 0 ? (
          <Text role="status" style={{ fontSize: 12 }} type="secondary">
            {t('primitives.userSearch.empty')}
          </Text>
        ) : null}
      </div>
    );
  },
);

UserSearchSelect.displayName = 'AdminUserSearchSelect';

export default UserSearchSelect;
