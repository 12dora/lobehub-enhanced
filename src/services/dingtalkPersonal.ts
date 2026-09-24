import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Mirrors of the `dingtalkPersonal` router shapes (contract §3). The service methods are annotated
 * with them, so a drift between the router's inferred output and these types is a type error here
 * rather than a silent mismatch in the card.
 */
export type DingtalkPersonalFeature = 'chat' | 'report' | 'todo' | 'write';

export type DingtalkPersonalLoginStatus =
  'cancelled' | 'expired' | 'failed' | 'pending' | 'succeeded';

export type DingtalkPersonalLoginErrorCode =
  'IDENTITY_MISMATCH' | 'LOGIN_FAILED' | 'LOGIN_TIMEOUT' | 'ORG_CLI_DISABLED';

export interface DingtalkPersonalLoginView {
  errorCode?: DingtalkPersonalLoginErrorCode;
  /** ISO. */
  expiresAt: string;
  jobId: string;
  /** Who actually authorized, on `IDENTITY_MISMATCH`. */
  mismatchUserName?: string;
  status: DingtalkPersonalLoginStatus;
  userCode: string;
  verificationUrl: string;
}

export type DingtalkPersonalIdentityCode =
  | 'DINGTALK_IDENTITY_INACTIVE'
  | 'DINGTALK_IDENTITY_UNBOUND'
  | 'DINGTALK_IDENTITY_UNVERIFIED'
  | 'DINGTALK_PERSONAL_CORP_ID_MISSING';

export type DingtalkPersonalStatus =
  | { state: 'disabled' }
  | { code: DingtalkPersonalIdentityCode; state: 'identity_required' }
  | { pendingLogin?: DingtalkPersonalLoginView; state: 'unauthorized' }
  | { dingtalkUserName?: string; lastErrorCode?: string; state: 'expired' }
  | {
      authorizedAt: string;
      corpName: string;
      dingtalkUserName: string;
      features: Record<DingtalkPersonalFeature, boolean>;
      lastCheckedAt?: string;
      state: 'authorized';
    };

export interface DingtalkPersonalPreview {
  danger: boolean;
  lines: string[];
  title: string;
  warnings: string[];
}

type CallToolInput = Parameters<typeof lambdaClient.dingtalkPersonal.callTool.mutate>[0];
type PreviewInput = Parameters<typeof lambdaClient.dingtalkPersonal.preview.query>[0];

/**
 * Client access to the 钉钉个人数据 lambda router: the member's own authorization of the `dws`
 * sidecar, and the builtin tool's server-side execution.
 */
class DingtalkPersonalService {
  getStatus = async (): Promise<DingtalkPersonalStatus> => {
    return lambdaClient.dingtalkPersonal.getStatus.query();
  };

  /** Asks the sidecar whether the stored authorization still works, and updates the row. */
  checkStatus = async (): Promise<DingtalkPersonalStatus> => {
    return lambdaClient.dingtalkPersonal.checkStatus.mutate();
  };

  /** Reuses this member's pending login when it has not expired yet. */
  startLogin = async (): Promise<DingtalkPersonalLoginView> => {
    return lambdaClient.dingtalkPersonal.startLogin.mutate();
  };

  getLoginJob = async (params: { jobId: string }): Promise<DingtalkPersonalLoginView> => {
    return lambdaClient.dingtalkPersonal.getLoginJob.query(params);
  };

  cancelLogin = async (params: { jobId: string }) => {
    return lambdaClient.dingtalkPersonal.cancelLogin.mutate(params);
  };

  revoke = async () => {
    return lambdaClient.dingtalkPersonal.revoke.mutate();
  };

  callTool = async (params: CallToolInput): Promise<BuiltinServerRuntimeOutput> => {
    return lambdaClient.dingtalkPersonal.callTool.mutate(params);
  };

  preview = async (params: PreviewInput): Promise<DingtalkPersonalPreview> => {
    return lambdaClient.dingtalkPersonal.preview.query(params);
  };
}

export const dingtalkPersonalService = new DingtalkPersonalService();
