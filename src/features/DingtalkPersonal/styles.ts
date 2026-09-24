import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    letter-spacing: 1px;
  `,
  countdown: css`
    font-variant-numeric: tabular-nums;
  `,
  details: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-width: 200px;
  `,
  header: css`
    align-items: flex-start;
  `,
  loginBody: css`
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
  `,
  /** Scanners read dark-on-light; the frame stays white in the dark theme too. */
  qr: css`
    flex-shrink: 0;

    padding: 6px;
    border-radius: ${cssVar.borderRadius};

    line-height: 0;

    background: #fff;
  `,
  root: css`
    min-width: 0;
  `,
  waiting: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));
