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
    overflow-x: auto;
    max-height: 320px;
    overflow-y: auto;
  `,
  bindingsTable: css`
    width: 100%;
    border-collapse: collapse;

    font-size: ${cssVar.fontSizeSM};
    text-align: start;

    th {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;

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
  switchRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
}));
