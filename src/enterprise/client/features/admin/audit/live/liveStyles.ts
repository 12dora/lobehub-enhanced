'use client';

import { createStaticStyles, cssVar } from 'antd-style';

/** Shared by LivePage and its panes/banners so the layout stays one visual system. */
export const styles = createStaticStyles(({ css }) => ({
  /**
   * Two independently scrolling boxes of one fixed height: the page never grows with the
   * transcript. The offset covers shell header + page header + toolbar.
   */
  layout: css`
    display: flex;
    flex-shrink: 0;
    gap: 16px;
    align-items: stretch;

    height: calc(100vh - 240px);
    min-height: 420px;
  `,
  pane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-height: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    /* In-pane feed interruptions (LiveGapBanner) sit inset from the pane border. */
    & > [role='alert'],
    & > [role='status'] {
      margin: 8px;
    }
  `,
  left: css`
    flex: 0 0 320px;
    width: 320px;
    min-width: 260px;
    max-width: 360px;
  `,
  right: css`
    flex: 1;
    min-width: 0;
  `,
  /** Body access is audited — the page description reads as a standing warning. */
  description: css`
    color: ${cssVar.colorWarningText};
  `,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  `,
  liveDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${cssVar.colorSuccess};

    @keyframes audit-live-pulse {
      0% {
        opacity: 1;
        box-shadow: 0 0 0 0 ${cssVar.colorSuccess};
      }

      70% {
        opacity: 0.7;
        box-shadow: 0 0 0 6px transparent;
      }

      100% {
        opacity: 1;
        box-shadow: 0 0 0 0 transparent;
      }
    }

    &[data-on='true'] {
      animation: audit-live-pulse 1.6s ease-out infinite;
    }

    &[data-on='false'] {
      background: ${cssVar.colorTextQuaternary};
    }
  `,
  gapBanner: css`
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorWarningBg};
  `,
  emptyGuide: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    padding: 48px;
  `,
}));
