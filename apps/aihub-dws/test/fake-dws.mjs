#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

process.stdout.on('error', () => undefined);
process.stderr.on('error', () => undefined);

function loadControl() {
  const dir = process.env.DWS_CONFIG_DIR;
  if (!dir) return {};
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'fake-control.json'), 'utf8'));
  } catch {
    return {};
  }
}

function log(entry) {
  const dir = process.env.DWS_CONFIG_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'invocations.jsonl'), `${JSON.stringify(entry)}\n`);
}

function profileName(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && typeof item.profile === 'string') return item.profile;
  return '';
}

function saveControl(control) {
  const dir = process.env.DWS_CONFIG_DIR;
  if (!dir) return;
  try {
    fs.writeFileSync(path.join(dir, 'fake-control.json'), JSON.stringify(control));
  } catch {
    // the caller still exits; tests observe that
  }
}

function rememberProfile(control, profile) {
  if (!profile) return;
  const list = Array.isArray(control.profiles) ? control.profiles : [];
  if (!list.some((item) => profileName(item) === profile)) list.push(profile);
  control.profiles = list;
  saveControl(control);
}

function upsertProfile(control, record) {
  if (!record?.profile) return;
  const list = Array.isArray(control.profiles) ? control.profiles : [];
  const index = list.findIndex((item) => profileName(item) === record.profile);
  if (index >= 0) {
    const prev = list[index];
    list[index] = prev && typeof prev === 'object' ? { ...prev, ...record } : record;
  } else {
    list.push(record);
  }
  control.profiles = list;
  saveControl(control);
}

function loginRecord(login, corpId, userId, corpName, userName) {
  const record = {
    corpId,
    corpName,
    profile: `${corpId}:${userId}`,
    status: 'active',
    userId,
    userName,
  };
  if (login.lastLoginAt) record.lastLoginAt = login.lastLoginAt;
  return record;
}

function finish(code, stdout = '', stderr = '') {
  const pending = [];
  if (stderr) pending.push(new Promise((resolve) => process.stderr.write(stderr, () => resolve())));
  if (stdout) pending.push(new Promise((resolve) => process.stdout.write(stdout, () => resolve())));
  Promise.all(pending).then(() => process.exit(code));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function loginText(code, seconds) {
  return [
    '● Step 1: Requesting device authorization code...',
    `  authorization code: ${code}`,
    `  Authorization code will expire in ${seconds} seconds.`,
    '  Authorization link (code included):',
    `https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=test&user_code=${code}`,
    '  Link for entering the code manually:',
    'https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=test',
    '● Step 2: Waiting for user authorization...',
    '',
  ].join('\n');
}

async function doLogin(control) {
  const login = control.login ?? {};
  const action = login.action ?? 'ok';
  await sleep(login.readyMs ?? 20);
  if (action === 'persist-hang') {
    const corpId = login.corp_id ?? 'dingcorp0123456789';
    const userId = login.user_id ?? '012345678901234567';
    upsertProfile(
      control,
      loginRecord(
        login,
        corpId,
        userId,
        login.corp_name ?? '示例科技有限公司',
        login.user_name ?? '张三',
      ),
    );
    if (login.stray_corp_id && login.stray_user_id) {
      upsertProfile(control, {
        corpId: login.stray_corp_id,
        corpName: login.stray_corp_name ?? '别的公司',
        profile: `${login.stray_corp_id}:${login.stray_user_id}`,
        status: 'active',
        userId: login.stray_user_id,
        userName: login.stray_user_name ?? '李四',
      });
    }
    await new Promise((resolve) =>
      process.stderr.write(loginText(login.code ?? 'JCHB-KBXF', login.expireSeconds ?? 900), () =>
        resolve(),
      ),
    );
    await new Promise(() => setInterval(() => undefined, 60_000));
    return;
  }
  if (action !== 'no-code') {
    process.stderr.write(loginText(login.code ?? 'JCHB-KBXF', login.expireSeconds ?? 900));
  }
  if (action === 'hang' || action === 'no-code') {
    await new Promise(() => setInterval(() => undefined, 60_000));
    return;
  }
  await sleep(login.exitMs ?? 40);
  if (action === 'org-disabled') {
    finish(8, '', 'organization CLI disabled: developerSettings CLI 未开启\n');
    return;
  }
  const identity = {
    corp_id: login.corp_id ?? 'dingcorp0123456789',
    corp_name: login.corp_name ?? '示例科技有限公司',
    expires_at: '2026-09-24T12:28:16.162Z',
    message: '登录成功',
    refresh_expires_at: '2026-10-24T10:28:16.162Z',
    refresh_token_valid: true,
    success: true,
    token_valid: true,
    user_id: login.user_id ?? '012345678901234567',
    user_name: login.user_name ?? '张三',
  };
  rememberProfile(control, `${identity.corp_id}:${identity.user_id}`);
  finish(0, JSON.stringify(identity));
}

async function doExec(control) {
  const exec = control.exec ?? {};
  const action = exec.action ?? 'ok';
  if (exec.delayMs) await sleep(exec.delayMs);
  if (action === 'hang') {
    await new Promise(() => setInterval(() => undefined, 60_000));
    return;
  }
  if (action === 'huge') {
    const bytes = exec.bytes ?? 1_200_000;
    await new Promise((resolve) =>
      process.stdout.write(Buffer.alloc(bytes, 0x61), () => resolve()),
    );
    finish(0);
    return;
  }
  if (action === 'rate') {
    finish(1, '', '调用频率超限，请稍后重试\n');
    return;
  }
  if (action === 'pat') {
    finish(
      4,
      '',
      `${JSON.stringify({ code: 'PAT_REQUIRED', data: { uri: exec.patUri ?? 'https://open.dingtalk.com/dev/pat?x=1' } })}\n`,
    );
    return;
  }
  if (action === 'pat-org') {
    finish(
      4,
      '',
      `${JSON.stringify({ code: 'PAT_ORG_POLICY_DENIED', data: { uri: 'https://open.dingtalk.com/dev/cli' } })}\n`,
    );
    return;
  }
  if (action === 'exit') {
    finish(exec.exitCode ?? 1, exec.stdout ?? '', exec.stderr ?? '');
    return;
  }
  if (action === 'ok-false') {
    finish(0, JSON.stringify({ message: exec.message ?? '模板不存在', ok: false }));
    return;
  }
  if (action === 'success-false') {
    finish(0, JSON.stringify({ errorMsg: '失败原因', success: false }));
    return;
  }
  if (action === 'not-json') {
    finish(0, 'not-json');
    return;
  }
  if (action === 'validation') {
    finish(3, '', '参数校验失败\n');
    return;
  }
  if (action === 'unauthorized') {
    finish(2, '', '未登录\n');
    return;
  }
  if (action === 'token-leak') {
    finish(1, '', 'access_token=supersecretvalue\n');
    return;
  }
  finish(0, `${JSON.stringify({ data: { echo: true }, ok: true, outcome: 'success' })}\n`);
}

function downloadBody(shape, relativePath, size) {
  if (shape === 'savedPath') {
    return {
      data: { nodeId: 'node1', savedPath: relativePath, sizeBytes: size, success: true },
      ok: true,
      outcome: 'success',
    };
  }
  return {
    localPath: relativePath,
    messageVerified: true,
    resourceType: 'fileId',
    sizeBytes: size,
  };
}

function doDownload(control, shape = 'localPath') {
  const download = control.download ?? {};
  const action = download.action ?? 'ok';
  if (action === 'axls' || action === 'alidoc') {
    const extension = action === 'axls' ? 'axls' : 'alidoc';
    const kind = action === 'axls' ? '钉钉表格' : '钉钉文档';
    finish(
      1,
      JSON.stringify({
        error: {
          exit_code: 1,
          message: `nodeId 指向的节点是${kind}（extension=${extension}），在线${action === 'axls' ? '表格' : '文档'}不支持直接下载。请使用 getRange 工具获取表格数据。`,
          subtype: 'business_error',
          type: 'api',
          upstream_code: 'invalidRequest.inputArgs.invalid',
        },
        ok: false,
        outcome: 'failure',
      }),
    );
    return;
  }
  if (action === 'fail') {
    finish(1, '', '下载失败\n');
    return;
  }
  if (action === 'nopath') {
    finish(0, JSON.stringify({ data: { sizeBytes: 1 }, ok: true, outcome: 'success' }));
    return;
  }
  if (action === 'escape') {
    finish(0, JSON.stringify(downloadBody(shape, '../secret.txt', 1)));
    return;
  }
  if (action === 'absolute') {
    finish(0, JSON.stringify(downloadBody(shape, '/etc/passwd', 1)));
    return;
  }
  if (action === 'missing') {
    finish(0, JSON.stringify(downloadBody(shape, 'files/missing.bin', 1)));
    return;
  }
  const name = download.name ?? '报表.xlsx';
  const dir = path.resolve(process.cwd(), 'files');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const bytes = download.bytes ?? Buffer.byteLength('hello-dws');
  fs.writeFileSync(file, download.bytes === undefined ? 'hello-dws' : Buffer.alloc(bytes, 0x61));
  const size = fs.statSync(file).size;
  finish(0, JSON.stringify(downloadBody(shape, `files/${name}`, size)));
}

const args = process.argv.slice(2);
const stdin = await readStdin();
const control = loadControl();

log({
  argv: args,
  cwd: process.cwd(),
  env: {
    DINGTALK_DWS_AGENTCODE: process.env.DINGTALK_DWS_AGENTCODE ?? null,
    DWS_CONFIG_DIR: process.env.DWS_CONFIG_DIR ?? null,
    DWS_KEYCHAIN_DIR: process.env.DWS_KEYCHAIN_DIR ?? null,
    HOME: process.env.HOME ?? null,
    HTTP_PROXY: process.env.HTTP_PROXY ?? null,
    HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
    NO_COLOR: process.env.NO_COLOR ?? null,
    NO_PROXY: process.env.NO_PROXY ?? null,
    PATH: process.env.PATH ?? null,
    TZ: process.env.TZ ?? null,
    http_proxy: process.env.http_proxy ?? null,
    https_proxy: process.env.https_proxy ?? null,
    no_proxy: process.env.no_proxy ?? null,
  },
  envKeys: Object.keys(process.env).sort(),
  hasBrokerToken: Object.hasOwn(process.env, 'DWS_BROKER_TOKEN'),
  pid: process.pid,
  stdin,
  t: Date.now(),
});

if (args[0] === 'version') {
  if (control.versionAction === 'hang') {
    await new Promise(() => setInterval(() => undefined, 60_000));
  } else if (control.versionExit) {
    finish(
      control.versionExit,
      control.versionStdout ?? '',
      control.versionStderr ?? 'version failed\n',
    );
  } else finish(0, `${control.version ?? 'v1.0.62'}\n`);
} else if (args[0] === 'profile' && args[1] === 'list') {
  if (control.profileListHangFrom) {
    const seen = (control.profileListSeen ?? 0) + 1;
    control.profileListSeen = seen;
    saveControl(control);
    if (seen >= control.profileListHangFrom) {
      await new Promise(() => setInterval(() => undefined, 60_000));
    }
  }
  if (control.profileListAction === 'hang') {
    await new Promise(() => setInterval(() => undefined, 60_000));
  } else if (control.profileListExit) {
    finish(
      control.profileListExit,
      control.profileListStdout ?? '',
      control.profileListStderr ?? '无法读取身份列表\n',
    );
  } else {
    const profiles = (control.profiles ?? []).map((profile) =>
      typeof profile === 'string' ? { profile, status: 'active' } : profile,
    );
    finish(
      0,
      JSON.stringify({ currentProfile: profiles[0]?.profile ?? '', profiles, success: true }),
    );
  }
} else if (args[0] === 'auth' && args[1] === 'status') {
  if (control.statusAction === 'hang') {
    await new Promise(() => setInterval(() => undefined, 60_000));
  }
  const status = control.status ?? {
    authenticated: true,
    corp_name: '示例科技有限公司',
    refresh_expires_at: '2026-10-24T00:00:00.000Z',
    refresh_token_valid: true,
    success: true,
    token_valid: true,
    user_name: '张三',
  };
  const stdout = control.statusStdout === undefined ? JSON.stringify(status) : control.statusStdout;
  finish(control.statusExit ?? 0, stdout, control.statusStderr ?? '');
} else if (args[0] === 'auth' && args[1] === 'logout') {
  if (control.logoutAction === 'hang') {
    await new Promise(() => setInterval(() => undefined, 60_000));
  } else {
    const code = control.logoutExit ?? 0;
    if (code === 0 && control.logoutKeep !== true) {
      const flag = args.find((arg) => arg.startsWith('--profile='));
      const name = flag ? flag.slice('--profile='.length) : '';
      if (name && Array.isArray(control.profiles)) {
        control.profiles = control.profiles.filter((item) => profileName(item) !== name);
        saveControl(control);
      }
    }
    finish(code, control.logoutStdout ?? '[OK] 已清除认证信息\n', control.logoutStderr ?? '');
  }
} else if (args[0] === 'auth' && args[1] === 'login') {
  await doLogin(control);
} else if (args.includes('+messages-resource-download')) {
  doDownload(control, 'localPath');
} else if (args.includes('drive') && args.includes('+download')) {
  doDownload(control, 'savedPath');
} else {
  await doExec(control);
}
