'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { adminDingtalkApprovalRulesService } from '@/enterprise/client/services/adminDingtalkApprovalRules';
import { useClientDataSWR } from '@/libs/swr';

import { DEFAULT_PAGE_SIZE } from '../primitives/dataTableChange';
import { buildAdminDingtalkApprovalRulesKey } from './swrKeys';

/** Same cadence as the other admin search boxes. */
const SEARCH_DEBOUNCE_MS = 300;

export interface AdminDingtalkApprovalRulesQuery {
  page: number;
  pageSize: number;
  q: string;
}

/**
 * List state of the 自动审批规则 admin page: a debounced server-side search plus
 * offset pagination.
 *
 * The search runs on the server so it covers every rule, not only the loaded
 * page — a client-side filter would report "no results" for rows that were never
 * fetched.
 */
export const useAdminDingtalkApprovalRulesList = (enabled: boolean) => {
  const [query, setQuery] = useState<AdminDingtalkApprovalRulesQuery>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    q: '',
  });
  const [searchDraft, setSearchDraft] = useState('');
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const next = searchDraft.trim();
      // A new search always starts from the first page: keeping the offset would
      // land the operator on an empty page of a smaller result set.
      setQuery((prev) => (prev.q === next ? prev : { ...prev, page: 1, q: next }));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [searchDraft]);

  const swr = useClientDataSWR(
    buildAdminDingtalkApprovalRulesKey(enabled, query.page, query.pageSize, query.q),
    () =>
      adminDingtalkApprovalRulesService.list({
        page: query.page,
        pageSize: query.pageSize,
        ...(query.q.length > 0 ? { q: query.q } : {}),
      }),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  // A forced disable on the last page can empty it; clamp back instead of
  // leaving the operator on a page that no longer exists.
  useEffect(() => {
    const total = swr.data?.total;
    if (total === undefined) return;
    const lastPage = Math.max(1, Math.ceil(total / query.pageSize) || 1);
    if (query.page <= lastPage) return;
    setQuery((prev) => ({ ...prev, page: lastPage }));
  }, [query.page, query.pageSize, swr.data?.total]);

  const items = useMemo(() => swr.data?.items ?? [], [swr.data]);

  return {
    ...swr,
    items,
    query,
    searchDraft,
    setQuery,
    setSearchDraft,
    total: swr.data?.total ?? 0,
  };
};
