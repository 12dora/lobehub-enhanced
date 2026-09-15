import { createStaticStyles, cssVar } from 'antd-style';

/** Chrome for the IM 连接器 cards: one full-width card per platform, edited in place. */
export const imConnectorStyles = createStaticStyles(({ css }) => ({
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
