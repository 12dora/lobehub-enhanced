import { createStaticStyles } from 'antd-style';

/**
 * Shared surface styles for the DingTalk approval cards (confirm card + result
 * cards), so an intervention and its post-execution render read as one family.
 */
export const cardStyles = createStaticStyles(({ css, cssVar }) => ({
  actionTag: css`
    flex-shrink: 0;
    margin: 0;
  `,
  body: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  cardTitle: css`
    flex-shrink: 0;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  dangerCard: css`
    border-color: ${cssVar.colorErrorBorder};
  `,
  /** Diagnostics affordance ("show arguments"): present, never competing for attention. */
  diagnosticButton: css`
    align-self: flex-start;
    height: 22px;
    padding-inline: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  footerButton: css`
    align-self: flex-start;
    height: 22px;
    padding-inline: 0;
    font-size: 12px;
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerMeta: css`
    overflow: hidden;

    flex: 1;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  headerText: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  label: css`
    flex-shrink: 0;

    min-width: 64px;
    max-width: 120px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    min-width: 0;
  `,
  rowMeta: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowTitle: css`
    overflow: hidden;

    flex: 1;

    min-width: 0;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rows: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  titleRow: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  `,
  value: css`
    overflow: hidden;

    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  warningItem: css`
    display: flex;
    gap: 6px;
    align-items: flex-start;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorWarningText};
    overflow-wrap: anywhere;
  `,
  warnings: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorWarningBg};
  `,
}));
