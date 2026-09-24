// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getDingtalkPersonalEnvConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DINGTALK_PERSONAL_BROKER_URL;
    delete process.env.DINGTALK_PERSONAL_BROKER_TOKEN;
  });

  it('treats empty strings as unset', async () => {
    process.env.DINGTALK_PERSONAL_BROKER_URL = '';
    process.env.DINGTALK_PERSONAL_BROKER_TOKEN = '';

    const { getDingtalkPersonalEnvConfig } = await import('../dingtalkPersonal');
    const config = getDingtalkPersonalEnvConfig();

    expect(config.DINGTALK_PERSONAL_BROKER_URL).toBeUndefined();
    expect(config.DINGTALK_PERSONAL_BROKER_TOKEN).toBeUndefined();
  });

  it('accepts a url and a token of at least 32 characters', async () => {
    process.env.DINGTALK_PERSONAL_BROKER_URL = 'http://aihub-dws:8080';
    process.env.DINGTALK_PERSONAL_BROKER_TOKEN = 't'.repeat(32);

    const { dingtalkPersonalEnv } = await import('../dingtalkPersonal');

    expect(dingtalkPersonalEnv.DINGTALK_PERSONAL_BROKER_URL).toBe('http://aihub-dws:8080');
    expect(dingtalkPersonalEnv.DINGTALK_PERSONAL_BROKER_TOKEN).toHaveLength(32);
  });

  it('rejects a token shorter than 32 characters', async () => {
    process.env.DINGTALK_PERSONAL_BROKER_TOKEN = 't'.repeat(31);

    await expect(import('../dingtalkPersonal')).rejects.toThrow();
  });

  it('rejects a broker url that is not a url', async () => {
    process.env.DINGTALK_PERSONAL_BROKER_URL = 'not a url';
    process.env.DINGTALK_PERSONAL_BROKER_TOKEN = 't'.repeat(32);

    await expect(import('../dingtalkPersonal')).rejects.toThrow();
  });
});
