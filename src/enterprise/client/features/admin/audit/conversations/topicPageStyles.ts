'use client';

import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  banner: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorWarningBg};
  `,
  bodyToggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 8px;
    align-items: center;

    font-size: 14px;
    white-space: nowrap;
  `,
  /** provider · model · agent · updated — one row that wraps between segments on narrow screens. */
  metaRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: center;

    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  metaSeparator: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  /** Fixed-height transcript box: the page never grows with the conversation. */
  streamBox: css`
    overflow: auto;
    flex-shrink: 0;

    height: calc(100vh - 300px);
    min-height: 360px;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  stream: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
}));
