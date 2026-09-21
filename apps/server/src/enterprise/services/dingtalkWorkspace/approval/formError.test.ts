// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DingtalkWorkspaceError } from '../errors';
import { DingtalkFormInvalidError, parseFormErrorHint, remapFormsInvalidError } from './formError';

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

  it('never returns the raw upstream text', () => {
    const raw = 'formschema.error: DDDateField props.unit error; requestId=abc';
    const hint = parseFormErrorHint(raw);
    expect(hint).toBe('DDDateField.unit');
    expect(hint).not.toContain('formschema');
    expect(hint).not.toContain('requestId');
    expect(parseFormErrorHint('JSON parsing error')).toBeUndefined();
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

  it('passes through non-invalid errors unchanged', () => {
    const unavailable = new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
    expect(() => remapFormsInvalidError(unavailable)).toThrow(unavailable);
  });
});
