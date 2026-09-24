import { createStaticStyles, cssVar } from 'antd-style';

/**
 * Chrome for the IM 连接器 tab: one card per platform, edited in place.
 *
 * The card reads top to bottom in dependency order — credentials, what the robot does, the
 * notification app, what runs on it, personal data, the bound users — and every group has the
 * same shape: a titled header (help behind a "?"), then a two-column field grid or a row of
 * switch tiles. Explanations never sit inline, so no group is taller than its controls.
 */
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
    overflow: auto;
    max-height: 320px;
  `,
  bindingsTable: css`
    border-collapse: collapse;
    width: 100%;
    font-size: ${cssVar.fontSizeSM};
    text-align: start;

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

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
  /** Labels above inputs, two columns; one column once the card is too narrow for two. */
  fieldGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
    align-items: start;

    @media (width < 768px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  `,
  /** The test action and the master switch sit together on the right of the header. */
  headerControls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  `,
  /** Platform name, status and — one line below — the counters. */
  headerMain: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  headerTitle: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  /** The idle duration beside the switch it belongs to. */
  hoursInput: css`
    width: 88px;
  `,
  /** A row of small actions and readings: a probe and its answer, the directory and its sync. */
  inlineRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  `,
  /** 检查权限 answers per capability, so the readings stack instead of running on. */
  probeList: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 20px;
  `,
  /** One reading, with DingTalk's apply-for-permission link beside it when there is one. */
  probeRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  `,
  /**
   * Save / cancel, pinned to the bottom of the viewport while the card below it has unsaved edits:
   * the card is long, and the old footer sat far from the field an admin had just changed.
   */
  saveBar: css`
    position: sticky;
    z-index: 2;
    inset-block-end: 0;

    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    justify-content: flex-end;

    margin-block-end: -16px;
    margin-inline: -16px;
    padding-block: 10px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    border-end-start-radius: ${cssVar.borderRadiusLG};
    border-end-end-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 -4px 12px rgb(0 0 0 / 6%);
  `,
  saveBarText: css`
    margin-inline-end: auto;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    min-width: 0;
    padding-block-start: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  sectionExtra: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  `,
  sectionHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    justify-content: space-between;

    min-height: 24px;
  `,
  sectionTitle: css`
    margin: 0;

    font-size: 14px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
  `,
  /** The title of a folding group is its own disclosure button (接口调用量). */
  sectionToggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding: 0;
    border: none;

    font: inherit;
    color: inherit;

    background: none;

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusXS};
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
  sectionTitleRow: css`
    display: flex;
    gap: 4px;
    align-items: center;
    min-width: 0;
  `,
  /** The counters under the platform name. */
  stats: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  /** 查看近 30 天 — the per-day breakdown is only read when one day looks wrong. */
  statsDetails: css`
    & > summary {
      cursor: pointer;
      user-select: none;

      width: fit-content;

      font-size: ${cssVar.fontSizeSM};
      line-height: 20px;
      color: ${cssVar.colorTextSecondary};
      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }

      &:hover,
      &:focus-visible {
        color: ${cssVar.colorText};
      }
    }
  `,
  switchRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  /** One switch as a compact bordered tile: label and "?" on the left, the switch on the right. */
  tile: css`
    justify-content: center;

    min-height: 40px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  /** Switch tiles, three to a row; fewer as the card narrows. */
  tileGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 12px;
    align-items: stretch;

    @media (width < 960px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (width < 560px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  /** A label only assistive technology needs (the unit beside the input says it visually). */
  visuallyHidden: css`
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;

    white-space: nowrap;

    clip-path: inset(50%);
  `,
  /** The IM tab is a form: capped so a wide screen does not stretch every input across it. */
  tab: css`
    display: flex;
    flex-direction: column;
    gap: 16px;

    width: 100%;
    max-inline-size: 1080px;
  `,
}));
