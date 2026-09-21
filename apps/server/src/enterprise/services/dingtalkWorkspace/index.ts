export {
  assertDingtalkFeature,
  type DingtalkPermissionProbe,
  type DingtalkWorkspaceCapabilities,
  type DingtalkWorkspaceFeature,
  type DingtalkWorkspacePermissionProbe,
  getDingtalkWorkspaceCapabilities,
  invalidateDingtalkWorkspaceCapabilities,
  peekDingtalkWorkspaceCapabilities,
  probeWorkspacePermissions,
  resetDingtalkWorkspaceCapabilitiesCacheForTest,
} from './capabilities';
export {
  type DingtalkWorkspaceRequest,
  dingtalkWorkspaceRequest,
  setDingtalkWorkspaceFetchForTest,
} from './client';
export { type DingtalkStaffCandidate, resolveStaff, type ResolveStaffResult } from './directory';
export {
  DINGTALK_APPROVAL_TOOL_IDENTIFIER,
  DINGTALK_WORKSPACE_ERROR_CODES,
  DINGTALK_WORKSPACE_TOOL_IDENTIFIER,
  DingtalkWorkspaceError,
  type DingtalkWorkspaceErrorCode,
  isDingtalkWorkspaceErrorCode,
} from './errors';
export {
  type DingtalkIdentityError,
  isDingtalkApprovalAdmin,
  requireVerifiedDingtalkIdentity,
  resetDingtalkIdentityCacheForTest,
  resolveVerifiedDingtalkIdentity,
  type VerifiedDingtalkIdentity,
} from './identity';
export { type DingtalkWorkNoticePayload, notifyUser } from './notify';
