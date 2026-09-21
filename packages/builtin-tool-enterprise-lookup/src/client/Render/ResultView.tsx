'use client';

import { Markdown } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type PresentedRow,
  type PresentedSection,
  type PresentedTable,
  presentEnterpriseResult,
} from './presenter';

const styles = createStaticStyles(({ css, cssVar }) => ({
  clamped: css`
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  empty: css`
    padding-block: 10px;
    padding-inline: 12px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  expand: css`
    align-self: flex-start;
    margin-inline-start: -4px;
  `,
  /* Wide enough for 统一社会信用代码; anything longer ellipsises and keeps its title tooltip. */
  label: css`
    overflow: hidden;
    flex: none;

    inline-size: 104px;
    max-inline-size: 45%;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  markdown: css`
    padding-block: 4px;
    padding-inline: 12px;
  `,
  pair: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    min-width: 0;
    padding-block: 5px;
    padding-inline: 12px;
  `,
  /* 经营范围 and friends read as a paragraph, so they take the whole row. */
  pairFull: css`
    grid-column: 1 / -1;
  `,
  pairs: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);

    margin: 0;

    font-size: 12px;
    line-height: 1.6;

    /* Two pairs fit side by side once each half still clears a label plus a readable value. */
    @container enterprise-pairs (min-width: 520px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  /* The query has to name an ancestor, so the grid cannot be the container it asks about. */
  pairsRoot: css`
    container: enterprise-pairs / inline-size;
    padding-block: 2px;
  `,
  raw: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    & > summary {
      cursor: pointer;
      user-select: none;

      padding-block: 8px;
      padding-inline: 12px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};

      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }
    }
  `,
  rawBody: css`
    margin: 0;
    padding-block: 0 10px;
    padding-inline: 12px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  root: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  scroll: css`
    overflow-x: auto;
    max-width: 100%;
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    text-align: start;

    th,
    td {
      padding-block: 7px;
      padding-inline: 12px;
      border-block-end: 1px solid ${cssVar.colorFillQuaternary};
      text-align: start;
      vertical-align: top;
    }

    th {
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      white-space: nowrap;
    }

    tr:last-child td {
      border-block-end: none;
    }
  `,
  tableTitle: css`
    padding-block: 10px 2px;
    padding-inline: 12px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  text: css`
    margin: 0;
    padding-block: 10px;
    padding-inline: 12px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  total: css`
    padding-block: 6px 10px;
    padding-inline: 12px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
    margin: 0;

    color: ${cssVar.colorText};
    word-break: break-word;
  `,
}));

/** Keys are written out in full so a rename is a compile-time miss rather than a runtime blank. */
const KEYS = {
  collapse: 'builtins.lobe-enterprise-lookup.render.collapse',
  empty: 'builtins.lobe-enterprise-lookup.render.empty',
  expand: 'builtins.lobe-enterprise-lookup.render.expand',
  result: 'builtins.lobe-enterprise-lookup.render.result',
  total: 'builtins.lobe-enterprise-lookup.render.total',
} as const;

/**
 * One 项目 / 内容 pair. A long value (经营范围, 历史沿革 …) is clamped to two lines so a single field
 * cannot push the rest of the record off screen, and it opens in place rather than in a tooltip —
 * the text is meant to be read and copied, not glanced at.
 */
const Pair = memo<{ row: PresentedRow }>(({ row }) => {
  const { t } = useTranslation('plugin');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={row.long ? cx(styles.pair, styles.pairFull) : styles.pair}>
      <dt className={styles.label} title={row.label}>
        {row.label}
      </dt>
      <dd className={styles.value}>
        {row.long ? (
          <>
            <span className={expanded ? undefined : styles.clamped}>{row.value}</span>
            <Button
              className={styles.expand}
              size={'small'}
              type={'text'}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? t(KEYS.collapse) : t(KEYS.expand)}
            </Button>
          </>
        ) : (
          row.value
        )}
      </dd>
    </div>
  );
});

Pair.displayName = 'EnterpriseLookupPair';

const RecordTable = memo<{ section: PresentedTable }>(({ section }) => {
  const { t } = useTranslation('plugin');

  return (
    <>
      {section.title && <div className={styles.tableTitle}>{section.title}</div>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {section.columns.map((column) => (
                <th key={column} scope={'col'}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* The provider gives records no id; their position is the only stable key here. */}
            {section.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.rows.length < section.total && (
        <div className={styles.total}>{t(KEYS.total, { count: section.total })}</div>
      )}
    </>
  );
});

RecordTable.displayName = 'EnterpriseLookupRecordTable';

const ResultSection = memo<{ section: PresentedSection }>(({ section }) => {
  if (section.type === 'markdown')
    return (
      <div className={styles.markdown}>
        <Markdown fontSize={13} variant={'chat'}>
          {section.text}
        </Markdown>
      </div>
    );

  if (section.type === 'text') return <pre className={styles.text}>{section.text}</pre>;

  if (section.type === 'table') return <RecordTable section={section} />;

  // Two pairs per row where the card is wide enough for them: a field per row wasted most of the
  // width on 状态 / 成立日期 and pushed the rest of the record out of sight.
  return (
    <div className={styles.pairsRoot}>
      <dl className={styles.pairs}>
        {section.rows.map((row) => (
          <Pair key={row.label} row={row} />
        ))}
      </dl>
    </div>
  );
});

ResultSection.displayName = 'EnterpriseLookupResultSection';

export interface EnterpriseResultViewProps {
  /** The upstream payload as it arrived: MCP content, a JSON string, or markdown text. */
  result?: unknown;
}

/**
 * The provider's answer as something an operator can read.
 *
 * Both providers are free-form — 企查查 answers in JSON, 天眼查 in markdown — so the shaping is left
 * to `presentEnterpriseResult` and this only decides how each shape looks. Nothing is hidden behind
 * a disclosure any more except the original payload, which stays reachable for the rare case where
 * a field was dropped as empty or folded into a cell.
 */
export const EnterpriseResultView = memo<EnterpriseResultViewProps>(({ result }) => {
  const { t } = useTranslation('plugin');
  const presented = useMemo(() => presentEnterpriseResult(result), [result]);

  if (presented.sections.length === 0) return <div className={styles.empty}>{t(KEYS.empty)}</div>;

  // Markdown and verbatim text ARE the original answer; offering it twice would only add chrome.
  const showRaw =
    !!presented.rawText &&
    presented.sections.some((section) => section.type === 'pairs' || section.type === 'table');

  return (
    <div className={styles.root}>
      {presented.sections.map((section, index) => (
        <ResultSection key={index} section={section} />
      ))}
      {showRaw && (
        <details className={styles.raw}>
          <summary>{t(KEYS.result)}</summary>
          <pre className={styles.rawBody}>{presented.rawText}</pre>
        </details>
      )}
    </div>
  );
});

EnterpriseResultView.displayName = 'EnterpriseResultView';

export default EnterpriseResultView;
