// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DingtalkWorkspaceError } from '../errors';
import {
  DingtalkFormInvalidError,
  parseFormErrorHint,
  problemHint,
  remapFormsInvalidError,
} from './formError';

describe('parseFormErrorHint', () => {
  it('extracts component type and prop from props.error messages', () => {
    expect(parseFormErrorHint('formschema.error: DDDateField props.unit error')).toBe(
      'DDDateField.unit',
    );
    expect(parseFormErrorHint('TextField props.label error')).toBe('TextField.label');
  });

  it('extracts the prop from Missing<label> without returning the raw message', () => {
    expect(parseFormErrorHint('Missinglabel')).toBe('label');
    expect(parseFormErrorHint('MissingLabel')).toBe('label');
    expect(parseFormErrorHint('formschema.error: Missingoptions')).toBe('options');
  });

  it('extracts SeqNumberField from a rule error without returning the raw text', () => {
    expect(parseFormErrorHint('formschema.error: SeqNumberField rule error')).toBe(
      'SeqNumberField',
    );
  });

  it('never returns the raw upstream text', () => {
    const raw = 'formschema.error: DDDateField props.unit error; requestId=abc';
    const hint = parseFormErrorHint(raw);
    expect(hint).toBe('DDDateField.unit');
    expect(hint).not.toContain('formschema');
    expect(hint).not.toContain('requestId');
    expect(parseFormErrorHint('JSON parsing error')).toBeUndefined();
  });
});

describe('problemHint', () => {
  it('uses the component type for unsupported fields and type.issue otherwise', () => {
    expect(
      problemHint({
        componentType: 'SeqNumberField',
        index: 0,
        issue: 'unsupported',
        label: '流水号',
        suggestion: 'remove: DingTalk generates it',
      }),
    ).toBe('SeqNumberField');
    expect(
      problemHint({
        componentType: 'DDSelectField',
        index: 1,
        issue: 'options',
        label: '类型',
        suggestion: 'provide at least 2 options',
      }),
    ).toBe('DDSelectField.options');
  });
});

describe('remapFormsInvalidError', () => {
  it('wraps DINGTALK_INVALID as DingtalkFormInvalidError with a parsed hint', () => {
    const upstream = new DingtalkWorkspaceError(
      'DINGTALK_INVALID',
      'formschema.error: DDSelectField props.options error',
    );
    try {
      remapFormsInvalidError(upstream);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DingtalkFormInvalidError);
      expect(error).toBeInstanceOf(DingtalkWorkspaceError);
      expect((error as DingtalkFormInvalidError).code).toBe('DINGTALK_INVALID');
      expect((error as DingtalkFormInvalidError).hint).toBe('DDSelectField.options');
      expect((error as Error).message).toBe('DINGTALK_INVALID');
    }
  });

  it('preserves a pre-validation problem list', () => {
    const problems = [
      {
        componentType: 'SeqNumberField',
        index: 0,
        issue: 'unsupported',
        label: '流水号',
        suggestion: 'remove: DingTalk generates it',
      },
    ];
    const invalid = new DingtalkFormInvalidError('SeqNumberField', problems);
    try {
      remapFormsInvalidError(invalid);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBe(invalid);
      expect((error as DingtalkFormInvalidError).problems).toEqual(problems);
    }
  });

  it('passes through non-invalid errors unchanged', () => {
    const unavailable = new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
    expect(() => remapFormsInvalidError(unavailable)).toThrow(unavailable);
  });
});
