'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  CompanyProfileCandidate,
  CompanyProfileParams,
  CompanyProfileState,
} from '../../../types';
import { isEnterpriseLookupProvider } from '../../../types';
import { formatCompanySummary } from '../presenter';
import { EnterpriseLookupRenderView } from '../shared';

const styles = createStaticStyles(({ css, cssVar }) => ({
  candidate: css`
    padding-block: 5px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;

    & + & {
      border-block-start: 1px solid ${cssVar.colorFillQuaternary};
    }
  `,
  candidates: css`
    display: flex;
    flex-direction: column;

    padding-block: 0 12px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    padding-block: 8px 2px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  summary: css`
    padding-block: 0 10px;
    padding-inline: 12px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
  `,
}));

/**
 * The state as the execution runtime writes it.
 *
 * `CompanyProfileState` in `../../../types` currently declares only the counters (`match`,
 * `candidateCount`, `resultText`); the runtime also writes the candidate records, the anchored
 * company and the raw profile payload, which is what this card actually shows. Declared here as an
 * extension so the two can be reconciled in the shared type without touching this file.
 */
export interface CompanyProfileRenderState extends CompanyProfileState {
  candidates?: CompanyProfileCandidate[];
  company?: CompanyProfileCandidate;
  /** The upstream payload for the anchored company, in whatever shape the provider answers. */
  profile?: unknown;
}

export type { CompanyProfileParams };

/**
 * 企业档案 — one company, anchored and read in a single step.
 *
 * Two outcomes share the card. A unique match shows the company's identity line above its profile
 * table; an ambiguous name shows the candidates instead, as the same 「名称 · 统一社会信用代码 ·
 * 法定代表人 · 状态」 line the assistant will ask about, so a user can tell two identically named
 * companies apart before another paid query is spent on the wrong one.
 */
export const CompanyProfileRender = memo<
  BuiltinRenderProps<CompanyProfileParams, CompanyProfileRenderState>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');

  const provider = pluginState?.provider ?? args?.provider;
  const unique = pluginState?.match === 'unique';
  const company = pluginState?.company;
  const candidates = pluginState?.candidates ?? [];
  const summary = company ? formatCompanySummary(company) : '';

  // The anchored company's own payload is what the table is for. `resultText` is the fallback: it
  // carries the same reading (plus the assistant's instructions), so a card is never left blank.
  const result = unique ? (pluginState?.profile ?? pluginState?.resultText) : undefined;

  return (
    <EnterpriseLookupRenderView
      capability={company?.name?.trim() || args?.name?.trim() || undefined}
      provider={isEnterpriseLookupProvider(provider) ? provider : undefined}
      result={result}
      truncated={pluginState?.truncated}
    >
      {summary.length > 0 && <div className={styles.summary}>{summary}</div>}
      {!unique && candidates.length > 0 && (
        <div className={styles.candidates}>
          <span className={styles.label}>
            {t('builtins.lobe-enterprise-lookup.render.candidates', { count: candidates.length })}
          </span>
          {candidates.map((candidate, index) => (
            <div className={styles.candidate} key={`${candidate.creditCode ?? ''}-${index}`}>
              {formatCompanySummary(candidate)}
            </div>
          ))}
        </div>
      )}
    </EnterpriseLookupRenderView>
  );
});

CompanyProfileRender.displayName = 'CompanyProfileRender';

export default CompanyProfileRender;
