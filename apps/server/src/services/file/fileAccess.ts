import type { LobeChatDatabase } from '@lobechat/database';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { PlatformAuditPolicyModel } from '@/database/models/platform';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { isPlatformAdminFeatureEnabled } from '@/server/enterprise/featureFlags';
import { loadPlatformAuthContext } from '@/server/enterprise/guards/platformPermission';
import { appendAuditAccessLog } from '@/server/enterprise/services/audit/accessLog';
import { resolveConversationContentAccess } from '@/server/enterprise/services/audit/contentPolicy';
import { isModuleEnabled } from '@/server/enterprise/services/moduleSettings';

export type FileAccessFile = {
  id: string;
  userId: string;
  visibility?: string | null;
  workspaceId?: string | null;
};

export type FileAccessDecision =
  { allowed: true; reason: 'owner' | 'workspace' | 'auditor' } | { allowed: false };

// Topic link-shares are served through `/f/:id?share=<shareId>` (see
// `shareFileAccess.ts`), a capability checked per request; they never take the
// session rules below.
const isWorkspaceMemberVisible = (visibility?: string | null): boolean =>
  visibility == null || visibility === 'public';

const tryAuditorAccess = async (db: LobeChatDatabase, viewerUserId: string): Promise<boolean> => {
  if (!isPlatformAdminFeatureEnabled()) return false;
  if (!(await isModuleEnabled('audit'))) return false;

  let permissions: string[];
  try {
    const platformAuth = await loadPlatformAuthContext({ db, userId: viewerUserId });
    permissions = platformAuth.permissions;
  } catch {
    // RBAC lookup failed — not an auditor.
    return false;
  }

  if (!permissions.includes(PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ)) {
    return false;
  }

  const policy = await new PlatformAuditPolicyModel(db).getOrCreate();
  return resolveConversationContentAccess(policy.contentAccessMode).allowBody;
};

/**
 * Resolve whether `viewerUserId` may open `file` via GET /f/:id.
 * Rules are cheapest-first and stop at the first match: owner, workspace
 * member (public/NULL), topic link-share, auditor with conversation body access.
 */
export const resolveFileAccess = async (params: {
  db: LobeChatDatabase;
  file: FileAccessFile;
  viewerUserId: string;
}): Promise<FileAccessDecision> => {
  const { db, file, viewerUserId } = params;

  if (file.userId === viewerUserId) {
    return { allowed: true, reason: 'owner' };
  }

  if (file.workspaceId && isWorkspaceMemberVisible(file.visibility)) {
    const member = await new WorkspaceMemberModel(db, viewerUserId).getMember(
      file.workspaceId,
      viewerUserId,
    );
    if (member) return { allowed: true, reason: 'workspace' };
  }

  if (await tryAuditorAccess(db, viewerUserId)) {
    return { allowed: true, reason: 'auditor' };
  }

  return { allowed: false };
};

export const recordAuditorFileOpen = async (
  db: LobeChatDatabase,
  params: { actorUserId: string; fileId: string },
): Promise<void> => {
  await appendAuditAccessLog(db, {
    action: 'admin.audit.files.open',
    actorUserId: params.actorUserId,
    required: true,
    result: 'success',
    targetId: params.fileId,
    targetType: 'file',
  });
};
