import { createStaticStyles } from 'antd-style';

/**
 * Shared surface styles for the DingTalk personal-data cards (confirm card +
 * result cards), kept in the same family as the workspace toolset.
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
    overflow: hidden;
    flex-shrink: 1;

    min-width: 0;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
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
  fileChip: css`
    overflow: hidden;
    display: inline-flex;
    gap: 4px;
    align-items: center;

    max-width: 100%;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  fileChips: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
  line: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    font-size: 12px;
    color: ${cssVar.colorPrimary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimaryHover};
    }
  `,
  message: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding-block-end: 8px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-of-type {
      padding-block-end: 0;
      border-block-end: none;
    }
  `,
  messageHead: css`
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  `,
  messageSender: css`
    overflow: hidden;

    min-width: 0;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  messageText: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  muted: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  overdue: css`
    color: ${cssVar.colorError};
  `,
  preview: css`
    overflow: auto;

    max-height: 280px;
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    min-width: 0;
  `,
  rowMeta: css`
    overflow: hidden;
    flex-shrink: 0;

    max-width: 50%;

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
    white-space: pre-wrap;
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
