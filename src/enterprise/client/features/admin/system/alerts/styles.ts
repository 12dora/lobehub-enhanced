import { createStaticStyles, cssVar } from 'antd-style';

/** Chrome for the 告警设置 drawer (告警 / 状态 API tabs). */
export const alertSettingsStyles = createStaticStyles(({ css }) => ({
  bannedBadge: css`
    margin-inline-start: 4px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  channelBody: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    margin-block-start: 12px;
    padding-block-start: 12px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
  `,
  /** Doubled selector so the accent wins over Block's own outlined border. */
  channelInvalid: css`
    && {
      border-color: ${cssVar.colorErrorBorder};
      box-shadow: inset 3px 0 0 ${cssVar.colorError};
    }
  `,
  channelHeader: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  channelTitle: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    min-width: 0;

    font-weight: ${cssVar.fontWeightStrong};
  `,
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    overflow-wrap: anywhere;
  `,
  endpointRow: css`
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;

    min-width: 0;

    @media (width <= 480px) {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  `,
  endpointLabel: css`
    color: ${cssVar.colorTextSecondary};

    @media (width <= 480px) {
      grid-column: 1 / -1;
    }
  `,
  footer: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  `,
  groupTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSize};
    font-weight: ${cssVar.fontWeightStrong};
  `,
  inlineRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  muted: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  panel: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-block: 16px;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  testFailed: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorError};
    overflow-wrap: anywhere;
  `,
  testSucceeded: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorSuccess};
  `,
  tokenBox: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorWarningBg};
  `,
  unavailable: css`
    margin-block-start: 8px;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  missingUser: css`
    color: ${cssVar.colorTextTertiary};
  `,
  unbound: css`
    display: inline-flex;
    align-items: center;
    color: ${cssVar.colorWarning};
  `,
  userTags: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  warning: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorWarningText};
  `,
}));
