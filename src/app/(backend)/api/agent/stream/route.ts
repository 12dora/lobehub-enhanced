import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { createStreamEventManager } from '@/server/modules/AgentRuntime';

const log = debug('api-route:agent:stream');
const timing = debug('lobe-server:agent-runtime:timing');

const jsonError = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

/**
 * Server-Sent Events (SSE) endpoint
 * Provides real-time Agent execution event stream for clients.
 *
 * Auth matches other backend routes via `checkAuth` (Better Auth session
 * cookies, `Oidc-Auth`, or `X-API-Key`). The SPA opens this with
 * `fetchEventSource` on the same origin (cookies); the CLI sends
 * `Oidc-Auth` / `X-API-Key`. JSON 401 is fine for both — neither uses a
 * native EventSource that cannot read the status.
 */
export const GET = checkAuth(async (request, { userId, serverDB }) => {
  // Initialize stream event manager (uses InMemory singleton in local dev, Redis in production)
  const streamManager = createStreamEventManager();

  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get('operationId');
  const lastEventId = searchParams.get('lastEventId') || '0';
  const includeHistory = searchParams.get('includeHistory') === 'true';

  if (!operationId) {
    return jsonError('operationId parameter is required', 400);
  }

  // Only the user who started the operation may observe its stream. The row is
  // recorded (`recordStart`) before execAgent returns the operationId, so it
  // exists by the time a client subscribes. Workspace scoping is deliberately
  // ignored: the SPA stream client sends no workspace header.
  // `recordStart` is best-effort for ordinary operations (a DB failure is
  // swallowed and must not block runtime startup), but this subscribe path
  // now requires the row: a swallowed insert surfaces here as 404.
  const operation = await new AgentOperationModel(serverDB, userId).findOwnedById(operationId);
  if (!operation) {
    return jsonError('operation not found', 404);
  }

  log(`Starting SSE connection for operation ${operationId} from eventId ${lastEventId}`);

  // Create Server-Sent Events stream
  const stream = new ReadableStream({
    cancel(reason) {
      log(`SSE connection cancelled for operation ${operationId}:`, reason);

      // Call cleanup function
      if ((this as any)._cleanup) {
        (this as any)._cleanup();
      }
    },

    start(controller) {
      const writer = createSSEWriter(controller);

      // Send connection confirmation event
      writer.writeConnection(operationId, lastEventId);
      log(`SSE connection established for operation ${operationId}`);

      // If needed, send historical events first
      if (includeHistory) {
        streamManager
          .getStreamHistory(operationId, 50)
          .then((history) => {
            // Send historical events in chronological order (earliest first)
            const sortedHistory = history.reverse();

            sortedHistory.forEach((event) => {
              // Only send events newer than lastEventId
              if (!lastEventId || lastEventId === '0' || event.timestamp.toString() > lastEventId) {
                try {
                  // Add SSE-specific fields, keeping format consistent with real-time events
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };
                  writer.writeStreamEvent(sseEvent, operationId);
                } catch (error) {
                  console.error('[Agent Stream] Error sending history event:', error);
                }
              }
            });

            if (sortedHistory.length > 0) {
              log(`Sent ${sortedHistory.length} historical events for operation ${operationId}`);
            }
          })
          .catch((error) => {
            console.error('[Agent Stream] Failed to load history:', error);

            try {
              writer.writeError(error, operationId, 'history_loading');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send error event:', controllerError);
            }
          });
      }

      // Create AbortController for canceling subscription
      const abortController = new AbortController();

      // Track if stream has ended (agent_runtime_end received)
      // Once set to true, no more events will be sent
      let streamEnded = false;

      // Send heartbeat periodically (every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        // Skip heartbeat if stream has ended
        if (streamEnded) {
          return;
        }

        try {
          const heartbeat = {
            operationId,
            timestamp: Date.now(),
            type: 'heartbeat',
          };

          controller.enqueue(`data: ${JSON.stringify(heartbeat)}\n\n`);
        } catch (error) {
          console.error('[Agent Stream] Heartbeat error:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Cleanup function
      const cleanup = () => {
        abortController.abort();
        clearInterval(heartbeatInterval);
        log(`SSE connection closed for operation ${operationId}`);
      };

      // Subscribe to new streaming events
      const subscribeToEvents = async () => {
        try {
          await streamManager.subscribeStreamEvents(
            operationId,
            lastEventId,
            (events) => {
              events.forEach((event) => {
                // Skip all events if stream has ended
                if (streamEnded) {
                  return;
                }

                try {
                  // Add SSE-specific fields
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };

                  const now = Date.now();
                  const totalLatency = now - sseEvent.timestamp;
                  writer.writeStreamEvent(sseEvent, operationId);
                  timing(
                    '[%s:%d] SSE sent %s, original timestamp %d, sent at %d, total latency %dms',
                    operationId,
                    event.stepIndex,
                    event.type,
                    sseEvent.timestamp,
                    now,
                    totalLatency,
                  );

                  // If agent_runtime_end event is received, terminate stream immediately
                  if (event.type === 'agent_runtime_end') {
                    log(
                      `Agent runtime ended for operation ${operationId}, terminating stream immediately`,
                    );

                    // Mark stream as ended to prevent any more events
                    streamEnded = true;

                    // Immediately cleanup and close connection
                    cleanup();
                    controller.close();
                    log(
                      `SSE connection closed after agent runtime end for operation ${operationId}`,
                    );
                  }
                } catch (error) {
                  console.error('[Agent Stream] Error sending event:', error);
                }
              });
            },
            abortController.signal,
          );
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.error('[Agent Stream] Subscription error:', error);

            try {
              writer.writeError(error as Error, operationId, 'stream_subscription');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send subscription error:', controllerError);
            }
          }
        }
      };

      // Start subscription
      subscribeToEvents();

      // Listen for connection close
      request.signal?.addEventListener('abort', cleanup);

      // Store cleanup function for calling during cancel
      (controller as any)._cleanup = cleanup;
    },
  });

  // Set SSE response headers
  return new Response(stream, {
    headers: createSSEHeaders(),
  });
});
