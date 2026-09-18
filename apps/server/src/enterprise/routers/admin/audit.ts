/**
 * admin.audit.* — A2 evidence query + A3 export/retention surface.
 *
 * Endpoints:
 * - policy.get / policy.update
 * - events.list / get / facets / stats (+ list/get aliases)
 * - conversations.list / get / messages
 * - users.search moved to admin.users.search; users.summary / timeline remain
 * - legalHolds.list / get / create / release
 * - legalHolds.list / get / create / release
 * - exports.create / list / get / download / cancel
 * - retention.dryRun / run / listRuns / getRun / status / cancel
 */

import { router } from '@/libs/trpc/lambda';

import {
  adminAuditEventsGetInputSchema,
  adminAuditEventsGetOutputSchema,
  adminAuditEventsListInputSchema,
  adminAuditEventsListOutputSchema,
} from '../../contracts/adminAudit';
import { AdminAuditService } from '../../services/audit';
import { auditRead, canSeeConversationEvidence } from './audit.procedure';
import { conversationsRouter, eventsRouter, policyRouter, usersRouter } from './audit.reads';
import { exportsRouter, legalHoldsRouter, retentionRouter } from './audit.writes';

/**
 * Compatibility aliases `list` / `get` → events.list / events.get.
 * Keep shapes aligned with the events surface (list omits diffs; get returns full stored diffs).
 */
export const adminAuditRouter = router({
  conversations: conversationsRouter,
  events: eventsRouter,
  exports: exportsRouter,
  get: auditRead
    .input(adminAuditEventsGetInputSchema)
    .output(adminAuditEventsGetOutputSchema)
    .query(async ({ ctx, input }) => {
      const service = new AdminAuditService(ctx.serverDB);
      return service.getEvent({
        accessAction: 'admin.audit.get',
        actorUserId: ctx.userId!,
        canSeeConversationEvidence: canSeeConversationEvidence(ctx),
        id: input.id,
      });
    }),
  legalHolds: legalHoldsRouter,
  list: auditRead
    .input(adminAuditEventsListInputSchema)
    .output(adminAuditEventsListOutputSchema)
    .query(async ({ ctx, input }) => {
      const service = new AdminAuditService(ctx.serverDB);
      return service.listEvents({
        accessAction: 'admin.audit.list',
        actorUserId: ctx.userId!,
        canSeeConversationEvidence: canSeeConversationEvidence(ctx),
        input,
      });
    }),
  policy: policyRouter,
  retention: retentionRouter,
  users: usersRouter,
});
