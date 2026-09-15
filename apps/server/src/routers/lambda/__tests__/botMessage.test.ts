// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mergeBotProviderCredentials } from '../botMessage';

describe('mergeBotProviderCredentials', () => {
  it('sets robotCode for dingtalk from settings when it is a non-empty string', () => {
    expect(
      mergeBotProviderCredentials('dingtalk', { clientSecret: 'sec' }, { robotCode: 'robot_1' }),
    ).toEqual({ clientSecret: 'sec', robotCode: 'robot_1' });
  });

  it('keeps credentials.robotCode when settings omit it', () => {
    expect(
      mergeBotProviderCredentials('dingtalk', { clientSecret: 'sec', robotCode: 'from_creds' }, {}),
    ).toEqual({ clientSecret: 'sec', robotCode: 'from_creds' });
  });

  it('does not overwrite credentials.robotCode with an empty settings value', () => {
    expect(
      mergeBotProviderCredentials(
        'dingtalk',
        { clientSecret: 'sec', robotCode: 'from_creds' },
        { robotCode: '' },
      ),
    ).toEqual({ clientSecret: 'sec', robotCode: 'from_creds' });
  });

  it('does not set robotCode when both settings and credentials omit a non-empty value', () => {
    expect(mergeBotProviderCredentials('dingtalk', { clientSecret: 'sec' }, {})).toEqual({
      clientSecret: 'sec',
    });
  });

  it('does not copy settings.robotCode onto other platforms', () => {
    expect(
      mergeBotProviderCredentials('slack', { botToken: 'xoxb' }, { robotCode: 'robot_1' }),
    ).toEqual({ botToken: 'xoxb' });
  });
});
