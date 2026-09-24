'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { CircleHelp } from 'lucide-react';
import { memo, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { infraFormStyles as styles } from './styles';

/** Props a control must spread so the visible label, hint and error apply to it. */
export interface InfraFieldControlProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'id': string;
}

export interface InfraFieldRenderProps {
  control: InfraFieldControlProps;
  /** For controls that are not labelable elements (segmented groups): `aria-labelledby`. */
  labelId: string;
}

export interface InfraFieldProps {
  children: ReactNode | ((field: InfraFieldRenderProps) => ReactNode);
  /** Validation message for this control; announced through `aria-describedby`. */
  error?: string;
  /** Static guidance — lives in a tooltip so neighbouring rows stay aligned. */
  hint?: string;
  label: string;
  /** Small marker after the label (e.g. a tag saying where a pre-filled value came from). */
  labelExtra?: ReactNode;
  /** Extra line under the control (e.g. "will be cleared on save"), also described to the control. */
  note?: string;
  /** Span the whole field grid. */
  wide?: boolean;
}

export interface InfraHelpButtonProps {
  /** Static guidance shown in the tooltip. */
  hint: ReactNode;
  /** What the guidance is about — becomes the button's accessible name (「{{field}} 说明」). */
  label: string;
}

/**
 * The "?" beside a label, a section title or a switch.
 *
 * A real button rather than a hover-only icon: Tab reaches it, focus opens the tooltip and blur
 * closes it, so the guidance is not pointer-only. It sits beside the `<label>`, never inside it, so
 * its accessible name does not leak into the control's own name.
 */
export const InfraHelpButton = memo<InfraHelpButtonProps>(({ hint, label }) => {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} title={hint} onOpenChange={setOpen}>
      <button
        aria-label={t('systemGeneral.helpFor', { field: label })}
        className={styles.helpButton}
        type="button"
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
      >
        <Icon icon={CircleHelp} size={14} />
      </button>
    </Tooltip>
  );
});

InfraHelpButton.displayName = 'AdminInfraHelpButton';

/**
 * Label + optional help icon + control, with room for one validation line underneath.
 *
 * Guidance never sits under the control: in a two-column grid a paragraph on one field pushes its
 * neighbour out of alignment, which is what made the previous infrastructure cards hard to scan.
 *
 * The label is a real `<label htmlFor>` and the error/note ids are handed back through the render
 * prop, so screen readers get the same association the sighted layout implies.
 */
export const InfraField = memo<InfraFieldProps>(
  ({ children, error, hint, label, labelExtra, note, wide }) => {
    const reactId = useId();
    const controlId = `infra-${reactId}`;
    const labelId = `${controlId}-label`;
    const errorId = `${controlId}-error`;
    const noteId = `${controlId}-note`;

    const describedBy = [error ? errorId : null, note ? noteId : null].filter(Boolean).join(' ');
    const render: InfraFieldRenderProps = {
      control: {
        id: controlId,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
      labelId,
    };

    return (
      <div className={wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor={controlId} id={labelId}>
            {label}
          </label>
          {hint ? <InfraHelpButton hint={hint} label={label} /> : null}
          {labelExtra}
        </div>
        {typeof children === 'function' ? children(render) : children}
        {note ? (
          <span className={styles.hint} id={noteId}>
            {note}
          </span>
        ) : null}
        {error ? (
          <span className={styles.error} id={errorId}>
            {error}
          </span>
        ) : null}
      </div>
    );
  },
);

InfraField.displayName = 'AdminInfraField';

export interface InfraSwitchRowProps {
  /** Inline control between the label and the switch — e.g. the hours an idle rule waits. */
  addon?: ReactNode;
  checked: boolean;
  /** Extra class on the wrapper, e.g. the bordered tile a grid of switches uses. */
  className?: string;
  disabled?: boolean;
  /**
   * Static guidance behind a "?" beside the label. Preferred over `hint`: a row of switches stays
   * one line tall and neighbouring tiles stay aligned.
   */
  help?: string;
  /** One line under the row explaining what turning it on changes. */
  hint?: string;
  label: string;
  onChange: (checked: boolean) => void;
}

/**
 * A boolean setting as a labelled row. `Switch` renders a `<button role="switch">`, which is a
 * labelable element, so `<label htmlFor>` gives it its accessible name.
 */
export const InfraSwitchRow = memo<InfraSwitchRowProps>(
  ({ addon, checked, className, disabled, help, hint, label, onChange }) => {
    const reactId = useId();
    const controlId = `infra-switch-${reactId}`;

    return (
      <div className={className ? `${styles.switchField} ${className}` : styles.switchField}>
        <div className={styles.switchRow}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor={controlId}>
              {label}
            </label>
            {help ? <InfraHelpButton hint={help} label={label} /> : null}
          </div>
          <div className={styles.switchControls}>
            {addon}
            <Switch checked={checked} disabled={disabled} id={controlId} onChange={onChange} />
          </div>
        </div>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
    );
  },
);

InfraSwitchRow.displayName = 'AdminInfraSwitchRow';
