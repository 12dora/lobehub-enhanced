import { createHmac } from 'node:crypto';

export const signDingtalkRobotWebhook = (
  webhookUrl: string,
  secret: string,
  timestampMs: number,
): string => {
  const timestamp = String(timestampMs);
  const sign = encodeURIComponent(
    createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'),
  );
  return `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
};

export interface StatusAlertChannelMessage {
  text: string;
  title: string;
}

const logChannelFailure = (channel: string, error: unknown): void => {
  console.error('[status-alert] channel failed', {
    channel,
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
};

export const postDingtalkRobotMarkdown = async (input: {
  fetchImpl?: typeof fetch;
  keyword: string | null;
  now?: number;
  secret: string | null;
  text: string;
  title: string;
  webhookUrl: string;
}): Promise<void> => {
  const keyword = input.keyword?.trim();
  const text = keyword ? `${keyword}\n${input.text}` : input.text;
  const timestamp = input.now ?? Date.now();
  const url =
    input.secret && input.secret.length > 0
      ? signDingtalkRobotWebhook(input.webhookUrl, input.secret, timestamp)
      : input.webhookUrl;
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    body: JSON.stringify({
      markdown: { text, title: input.title },
      msgtype: 'markdown',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as { errcode?: unknown } | null;
  const errcode = typeof body?.errcode === 'number' ? body.errcode : response.ok ? 0 : -1;
  if (!response.ok || errcode !== 0) {
    throw new Error('dingtalk_robot_send_failed');
  }
};

export const sendStatusAlertEmail = async (input: {
  recipients: string[];
  send?: (payload: { subject: string; text: string; to: string[] }) => Promise<void>;
  text: string;
  title: string;
}): Promise<void> => {
  if (input.send) {
    await input.send({ subject: input.title, text: input.text, to: input.recipients });
    return;
  }
  const { EmailService } = await import('@/server/services/email');
  const service = await EmailService.create();
  await service.sendMail({
    subject: input.title,
    text: input.text,
    to: input.recipients,
  });
};

export interface StatusAlertDeliveryCounts {
  email: number;
  robot: number;
  workNotice: number;
}

/**
 * Each channel is independent. A failure is logged and does not block the others.
 * Email is skipped with no log when mail is not configured.
 */
export const deliverStatusAlertChannels = async (input: {
  fetchImpl?: typeof fetch;
  mailConfigured: boolean;
  message: StatusAlertChannelMessage;
  now?: number;
  sendEmail?: (payload: { subject: string; text: string; to: string[] }) => Promise<void>;
  sendWorkNotice?: (payload: { staffIds: string[]; text: string; title: string }) => Promise<void>;
  target: {
    email: { enabled: boolean; recipients: readonly string[] };
    robot: {
      enabled: boolean;
      keyword: string | null;
      secret: string | null;
      webhookUrl: string | null;
    };
    workNotice: { enabled: boolean; staffIds: readonly string[] };
  };
}): Promise<StatusAlertDeliveryCounts> => {
  const counts: StatusAlertDeliveryCounts = { email: 0, robot: 0, workNotice: 0 };
  const { message, target } = input;

  if (target.workNotice.enabled && target.workNotice.staffIds.length > 0 && input.sendWorkNotice) {
    try {
      await input.sendWorkNotice({
        staffIds: [...target.workNotice.staffIds],
        text: message.text,
        title: message.title,
      });
      counts.workNotice = target.workNotice.staffIds.length;
    } catch (error) {
      logChannelFailure('workNotice', error);
    }
  }

  if (target.robot.enabled && target.robot.webhookUrl) {
    try {
      await postDingtalkRobotMarkdown({
        fetchImpl: input.fetchImpl,
        keyword: target.robot.keyword,
        now: input.now,
        secret: target.robot.secret,
        text: message.text,
        title: message.title,
        webhookUrl: target.robot.webhookUrl,
      });
      counts.robot = 1;
    } catch (error) {
      logChannelFailure('dingtalkRobot', error);
    }
  }

  if (target.email.enabled && target.email.recipients.length > 0 && input.mailConfigured) {
    try {
      await sendStatusAlertEmail({
        recipients: [...target.email.recipients],
        send: input.sendEmail,
        text: message.text,
        title: message.title,
      });
      counts.email = target.email.recipients.length;
    } catch (error) {
      logChannelFailure('email', error);
    }
  }

  return counts;
};
