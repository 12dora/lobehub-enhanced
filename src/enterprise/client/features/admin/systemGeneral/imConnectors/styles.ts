import { createStaticStyles, cssVar } from 'antd-style';

/** Chrome for the IM 连接器 cards: one full-width card per platform, edited in place. */
export const imConnectorStyles = createStaticStyles(({ css }) => ({
  /** Secondary line inside a cell: the email under a name, the DingTalk name under its id. */
  bindingSecondary: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  /** The list is capped at 200 rows server-side, so it scrolls rather than paginates. */
  bindingsScroll: css`
    overflow: auto;
    max-height: 320px;
  `,
  bindingsTable: css`
    border-collapse: collapse;
    width: 100%;
    font-size: ${cssVar.fontSizeSM};
    text-align: start;

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      padding-block: 8px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      font-weight: 600;
      color: ${cssVar.colorTextSecondary};
      text-align: start;
      white-space: nowrap;

      background: ${cssVar.colorBgContainer};
    }

    td {
      padding-block: 8px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      vertical-align: top;
    }
  `,
  bindingsToolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
  `,
  /** Statuses and the master switch sit together on the right of the header. */
  headerControls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  `,
  /** The notification app's own actions: a probe, and the directory reading beside its sync. */
  notifyRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  `,
  /** 检查权限 answers per capability, so the three readings stack instead of running on. */
  probeList: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 20px;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    min-width: 0;
    padding-block-start: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorText};
  `,
  /** The card footer: the readings first, then what can be done about them. */
  stats: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  /** 查看近 30 天 — the per-day breakdown is only read when one day looks wrong. */
  statsDetails: css`
    & > summary {
      cursor: pointer;
      user-select: none;

      width: fit-content;

      font-size: ${cssVar.fontSizeSM};
      line-height: 20px;
      color: ${cssVar.colorTextSecondary};
      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }

      &:hover,
      &:focus-visible {
        color: ${cssVar.colorText};
      }
    }
  `,
  switchRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
}));
