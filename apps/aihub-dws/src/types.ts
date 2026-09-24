export type LoginStatus = 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export type LoginErrorCode =
  'IDENTITY_MISMATCH' | 'ORG_CLI_DISABLED' | 'LOGIN_TIMEOUT' | 'LOGIN_FAILED';

export interface LoginIdentity {
  corpId: string;
  corpName: string;
  userId: string;
  userName: string;
}

export interface LoginJobView {
  errorCode?: LoginErrorCode;
  expiresAt: string;
  identity?: LoginIdentity;
  jobId: string;
  status: LoginStatus;
  userCode: string;
  verificationUrl: string;
}

export type ExecErrorCode =
  | 'NOT_AUTHORIZED'
  | 'PAT_REQUIRED'
  | 'ORG_POLICY_DENIED'
  | 'VALIDATION'
  | 'API_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'OUTPUT_TOO_LARGE'
  | 'FILE_TOO_LARGE'
  | 'INTERNAL';

export interface ExecError {
  code: ExecErrorCode;
  exitCode?: number;
  message: string;
  patUri?: string;
}

export type ExecResult =
  | { data: unknown; durationMs: number; ok: true; stdoutBytes: number }
  | {
      durationMs: number;
      file: { contentBase64: string; name: string; sizeBytes: number };
      ok: true;
    }
  | { error: ExecError; ok: false };

export interface StatusBody {
  authenticated: boolean;
  corpName?: string;
  refreshExpiresAt?: string;
  refreshTokenValid?: boolean;
  tokenValid?: boolean;
  userName?: string;
}

export interface RunResult {
  durationMs: number;
  exitCode: number | null;
  outputTooLarge: boolean;
  signal: NodeJS.Signals | null;
  spawnError?: string;
  stderr: string;
  stdout: string;
  stdoutBytes: number;
  timedOut: boolean;
}
