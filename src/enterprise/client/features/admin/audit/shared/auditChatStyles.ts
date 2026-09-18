'use client';

import { createStaticStyles, cssVar } from 'antd-style';

/**
 * Read-only mirror of the end-user chat item (src/features/Conversation/ChatItem): same avatar
 * header, same user bubble fill and radius, assistant replies flowing full-width.
 */
export const styles = createStaticStyles(({ css }) => ({
  list: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  item: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    min-width: 0;
    max-width: 100%;
    padding-block: 8px;
  `,
  itemRight: css`
    align-items: flex-end;
    padding-inline-start: 36px;
  `,
  itemLeft: css`
    align-items: flex-start;
  `,
  itemCenter: css`
    align-items: center;
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  headerReverse: css`
    flex-direction: row-reverse;
  `,
  name: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  time: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  body: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 8px;

    min-width: 0;
    max-width: 100%;
  `,
  bodyAssistant: css`
    width: 100%;
  `,
  bubble: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background-color: ${cssVar.colorFillTertiary};
  `,
  system: css`
    overflow: hidden;

    width: min(90%, 720px);
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  systemHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  plain: css`
    margin-block-start: 6px;

    font-family: ${cssVar.fontFamilyCode};
    line-height: 1.55;
    word-break: break-word;
    white-space: pre-wrap;
  `,
  toggle: css`
    cursor: pointer;

    padding: 0;
    border: none;

    font-size: 12px;
    color: ${cssVar.colorPrimary};

    background: none;
  `,
  error: css`
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorErrorText};
    word-break: break-word;

    background: ${cssVar.colorErrorBg};
  `,
}));
