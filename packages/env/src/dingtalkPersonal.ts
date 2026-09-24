import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const getDingtalkPersonalEnvConfig = () => {
  return createEnv({
    runtimeEnv: {
      DINGTALK_PERSONAL_BROKER_TOKEN: process.env.DINGTALK_PERSONAL_BROKER_TOKEN,
      DINGTALK_PERSONAL_BROKER_URL: process.env.DINGTALK_PERSONAL_BROKER_URL,
    },
    server: {
      DINGTALK_PERSONAL_BROKER_TOKEN: z.preprocess(
        emptyStringToUndefined,
        z.string().min(32).optional(),
      ),
      DINGTALK_PERSONAL_BROKER_URL: z.preprocess(
        emptyStringToUndefined,
        z.string().url().optional(),
      ),
    },
  });
};

export const dingtalkPersonalEnv = getDingtalkPersonalEnvConfig();
