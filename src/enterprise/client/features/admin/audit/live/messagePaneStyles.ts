'use client';

import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  root: css`
    display: flex;
    flex: 1;
    flex-direction: column;

    min-width: 0;
    min-height: 0;

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  /** Positioning context for the jump overlay; fills the fixed-height pane below the header. */
  streamViewport: css`
    position: relative;

    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  stream: css`
    overflow: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;

    min-height: 0;
    padding-block: 16px;
    padding-inline: 16px;
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    padding: 24px;
  `,
  /** Overlay anchored to the stream viewport (not the scrolled content). */
  jump: css`
    position: absolute;
    z-index: 2;
    inset-block-end: 16px;
    inset-inline-end: 24px;
  `,
  older: css`
    display: flex;
    justify-content: center;
    margin-block-end: 8px;
  `,
}));
