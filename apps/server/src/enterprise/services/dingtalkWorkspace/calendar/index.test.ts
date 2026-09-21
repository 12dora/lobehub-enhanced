// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssertFeature = vi.fn();
const mockRequireIdentity = vi.fn();
const mockRequest = vi.fn();
const mockResolveStaff = vi.fn();
const mockAppend = vi.fn();

vi.mock('@/server/enterprise/services/dingtalkWorkspace/capabilities', () => ({
  assertDingtalkFeature: (...args: unknown[]) => mockAssertFeature(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/identity', () => ({
  requireVerifiedDingtalkIdentity: (...args: unknown[]) => mockRequireIdentity(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/directory', () => ({
  resolveStaff: (...args: unknown[]) => mockResolveStaff(...args),
}));

vi.mock('@/server/enterprise/services/platformAudit', () => ({
  PlatformAuditService: vi.fn(() => ({ append: mockAppend })),
}));

const { DingtalkCalendarService, resetCalendarRoomListCacheForTest } = await import('./index');
const { DingtalkWorkspaceError } = await import('../errors');

const identity = { name: '张三', staffId: 'staff-me', unionId: 'union-me' };

const myEvent = {
  id: 'evt-1',
  organizer: { id: 'union-me', self: true },
  start: { dateTime: '2026-09-22T10:00:00+08:00', timeZone: 'Asia/Shanghai' },
  end: { dateTime: '2026-09-22T11:00:00+08:00', timeZone: 'Asia/Shanghai' },
  summary: '周会',
};

const directoryDb = (
  rows: Array<{ deptPath: string; name: string; staffId: string; unionId: string }>,
) => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  })),
});

const eventsViewWithRooms = (rooms: Array<{ displayName?: string; roomId: string }>) => ({
  events: [{ id: 'evt-1', meetingRooms: rooms }],
});

describe('DingtalkCalendarService', () => {
  const service = new DingtalkCalendarService({} as never, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    resetCalendarRoomListCacheForTest();
    mockAssertFeature.mockResolvedValue(undefined);
    mockRequireIdentity.mockResolvedValue(identity);
    mockAppend.mockResolvedValue({});
    mockResolveStaff.mockResolvedValue({
      deptPath: '研发',
      name: '张三',
      staffId: 'staff-me',
      unionId: 'union-me',
    });
  });

  it('listEvents uses eventsview with the requested window', async () => {
    mockRequest.mockResolvedValueOnce({ events: [myEvent] });
    const result = await service.listEvents({
      from: '2026-09-22T00:00:00+08:00',
      to: '2026-09-23T00:00:00+08:00',
    });
    expect(mockAssertFeature).toHaveBeenCalledWith('calendar');
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/v1.0/calendar/users/union-me/calendars/primary/eventsview',
        query: expect.objectContaining({ maxResults: 100 }),
      }),
    );
    expect(result.items[0]?.id).toBe('evt-1');
  });

  it('queryFreeBusy strips titles and extra fields from other people', async () => {
    mockResolveStaff.mockResolvedValueOnce({
      deptPath: '财务',
      name: '李四',
      staffId: 'staff-li',
      unionId: 'union-li',
    });
    mockRequest.mockResolvedValueOnce({
      scheduleInformation: [
        {
          error: undefined,
          scheduleItems: [
            {
              end: { dateTime: '2026-09-22T11:00:00+08:00' },
              eventId: 'secret-event',
              organizer: { id: 'union-li' },
              start: { dateTime: '2026-09-22T10:00:00+08:00' },
              status: 'BUSY',
              summary: '保密会议',
            },
          ],
          userId: 'union-li',
        },
      ],
    });
    const result = await service.queryFreeBusy({
      from: '2026-09-22T00:00:00+08:00',
      staffTokens: ['staff:staff-li'],
      to: '2026-09-22T23:59:00+08:00',
    });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ userIds: ['union-li'] }),
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/querySchedule',
      }),
    );
    expect(result.people[0]?.blocks).toEqual([
      {
        end: { dateTime: '2026-09-22T11:00:00+08:00' },
        start: { dateTime: '2026-09-22T10:00:00+08:00' },
        status: 'BUSY',
      },
    ]);
    expect(result.people[0]).toMatchObject({
      name: '李四 · 财务',
      staffToken: 'staff:staff-li',
    });
    expect(result.people[0]).not.toHaveProperty('unionId');
    expect(JSON.stringify(result)).not.toContain('保密会议');
    expect(JSON.stringify(result)).not.toContain('secret-event');
    expect(JSON.stringify(result)).not.toContain('union-li');
  });

  it('queryFreeBusy maps per-user upstream errors to a stable code', async () => {
    mockResolveStaff.mockResolvedValueOnce({
      deptPath: '财务',
      name: '李四',
      staffId: 'staff-li',
      unionId: 'union-li',
    });
    mockRequest.mockResolvedValueOnce({
      scheduleInformation: [
        { error: 'user not in calendar scope', scheduleItems: [], userId: 'union-li' },
      ],
    });
    const result = await service.queryFreeBusy({
      from: '2026-09-22T00:00:00+08:00',
      staffTokens: ['staff:staff-li'],
      to: '2026-09-22T23:59:00+08:00',
    });
    expect(result.people[0]).toEqual({
      blocks: [],
      error: 'DINGTALK_UNAVAILABLE',
      name: '李四 · 财务',
      staffToken: 'staff:staff-li',
    });
    expect(JSON.stringify(result)).not.toContain('union-li');
    expect(JSON.stringify(result)).not.toContain('user not in calendar scope');
  });

  it('updateEvent and deleteEvent require organizer, checked before the write', async () => {
    mockRequest.mockResolvedValueOnce({
      id: 'evt-2',
      organizer: { id: 'union-other', self: false },
      summary: '别人的会',
    });
    await expect(service.updateEvent({ eventId: 'evt-2', summary: '改名' })).rejects.toMatchObject({
      code: 'DINGTALK_FORBIDDEN',
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0].method).toBe('GET');
    expect(mockRequest.mock.calls[0][0].path).toContain('/events/evt-2');

    mockRequest.mockResolvedValueOnce({
      id: 'evt-2',
      organizer: { id: 'union-other', self: false },
      summary: '别人的会',
    });
    await expect(service.deleteEvent({ eventId: 'evt-2' })).rejects.toMatchObject({
      code: 'DINGTALK_FORBIDDEN',
    });
    expect(mockRequest.mock.calls.at(-1)?.[0].method).toBe('GET');
  });

  it('deleteEvent as organizer calls DELETE after the GET check', async () => {
    mockRequest.mockResolvedValueOnce(myEvent);
    mockRequest.mockResolvedValueOnce({});
    await service.deleteEvent({ eventId: 'evt-1' });
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: 'GET', path: expect.stringContaining('/events/evt-1') }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'DELETE',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1',
        query: { pushNotification: true },
      }),
    );
  });

  it('createEvent books rooms in a follow-up call', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent, id: 'evt-new' })
      .mockResolvedValueOnce({ result: true })
      .mockResolvedValueOnce({
        events: [{ id: 'evt-new', meetingRooms: [{ displayName: 'A', roomId: 'room-1' }] }],
      });
    const created = await service.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      roomIds: ['room-1'],
      start: '2026-09-22T10:00:00+08:00',
      summary: '周会',
    });
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: { meetingRoomsToAdd: [{ roomId: 'room-1' }] },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-new/meetingRooms',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: 'GET',
        path: '/v1.0/calendar/users/union-me/calendars/primary/eventsview',
        query: expect.objectContaining({
          timeMax: '2026-09-22T11:00:00+08:00',
          timeMin: '2026-09-22T10:00:00+08:00',
        }),
      }),
    );
    expect(created.meetingRooms).toEqual([{ displayName: 'A', roomId: 'room-1' }]);
  });

  it('createEvent falls back to requested roomIds when eventsview omits rooms', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent, id: 'evt-new' })
      .mockResolvedValueOnce({ result: true })
      .mockResolvedValueOnce({ events: [{ id: 'evt-new' }] });
    const created = await service.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      roomIds: ['room-1'],
      start: '2026-09-22T10:00:00+08:00',
      summary: '周会',
    });
    expect(created.meetingRooms).toEqual([{ roomId: 'room-1' }]);
  });

  it('preview(deleteEvent) is dangerous and re-validates organizer', async () => {
    mockRequest.mockResolvedValueOnce(myEvent);
    const preview = await service.preview({ apiName: 'deleteEvent', args: { eventId: 'evt-1' } });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('删除日程');
    expect(preview.lines).toEqual(expect.arrayContaining([{ label: '日程', value: '周会' }]));
  });

  it('preview(createEvent) accepts reminders as minute numbers', async () => {
    const preview = await service.preview({
      apiName: 'createEvent',
      args: {
        end: '2026-09-22T11:00:00+08:00',
        reminders: [15],
        start: '2026-09-22T10:00:00+08:00',
        summary: '周会',
      },
    });
    expect(preview.title).toBe('创建日程');
    expect(preview.danger).toBe(false);
  });

  it('createEvent sends number[] reminders as DingTalk reminder objects', async () => {
    mockRequest.mockResolvedValueOnce({ ...myEvent, id: 'evt-new' });
    await service.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      reminders: [15],
      start: '2026-09-22T10:00:00+08:00',
      summary: '周会',
    });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          reminders: [{ method: 'dingtalk', minutes: 15 }],
        }),
      }),
    );
  });

  it('updateEvent.roomIds adds first then removes when under the 5-room cap', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms([{ displayName: 'A', roomId: 'room-A' }]))
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(eventsViewWithRooms([{ displayName: 'B', roomId: 'room-B' }]));
    const updated = await service.updateEvent({ eventId: 'evt-1', roomIds: ['room-B'] });
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'GET',
        path: '/v1.0/calendar/users/union-me/calendars/primary/eventsview',
        query: expect.objectContaining({
          timeMax: '2026-09-22T11:00:00+08:00',
          timeMin: '2026-09-22T10:00:00+08:00',
        }),
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: 'PUT',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        body: { meetingRoomsToAdd: [{ roomId: 'room-B' }] },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1/meetingRooms',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        body: { meetingRoomsToRemove: [{ roomId: 'room-A' }] },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1/meetingRooms/batchRemove',
      }),
    );
    expect(updated.meetingRooms).toEqual([{ displayName: 'B', roomId: 'room-B' }]);
  });

  it('updateEvent loads current rooms before PUT and reloads on the new window', async () => {
    const moved = {
      ...myEvent,
      end: { dateTime: '2026-09-22T15:00:00+08:00', timeZone: 'Asia/Shanghai' },
      start: { dateTime: '2026-09-22T14:00:00+08:00', timeZone: 'Asia/Shanghai' },
    };
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms([{ displayName: 'A', roomId: 'room-A' }]))
      .mockResolvedValueOnce(moved)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(eventsViewWithRooms([{ displayName: 'B', roomId: 'room-B' }]));
    const updated = await service.updateEvent({
      end: '2026-09-22T15:00:00+08:00',
      eventId: 'evt-1',
      roomIds: ['room-B'],
      start: '2026-09-22T14:00:00+08:00',
    });
    const eventsViewCalls = mockRequest.mock.calls.filter((call) =>
      String(call[0]?.path ?? '').endsWith('/eventsview'),
    );
    expect(eventsViewCalls).toHaveLength(2);
    expect(eventsViewCalls[0]?.[0]?.query).toEqual(
      expect.objectContaining({
        timeMax: '2026-09-22T11:00:00+08:00',
        timeMin: '2026-09-22T10:00:00+08:00',
      }),
    );
    expect(mockRequest.mock.calls[2]?.[0]?.method).toBe('PUT');
    expect(eventsViewCalls[1]?.[0]?.query).toEqual(
      expect.objectContaining({
        timeMax: '2026-09-22T15:00:00+08:00',
        timeMin: '2026-09-22T14:00:00+08:00',
      }),
    );
    expect(updated.meetingRooms).toEqual([{ displayName: 'B', roomId: 'room-B' }]);
  });

  it('updateEvent falls back to requested roomIds when post-PUT eventsview omits rooms', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms([{ roomId: 'room-A' }]))
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ events: [{ id: 'evt-1' }] });
    const updated = await service.updateEvent({ eventId: 'evt-1', roomIds: ['room-B'] });
    expect(updated.meetingRooms).toEqual([{ roomId: 'room-B' }]);
  });

  it('updateEvent.roomIds empty list clears booked rooms from eventsview', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms([{ roomId: 'room-A' }]))
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(eventsViewWithRooms([]));
    const updated = await service.updateEvent({ eventId: 'evt-1', roomIds: [] });
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'GET',
        path: '/v1.0/calendar/users/union-me/calendars/primary/eventsview',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: 'PUT',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        body: { meetingRoomsToRemove: [{ roomId: 'room-A' }] },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1/meetingRooms/batchRemove',
      }),
    );
    expect(
      mockRequest.mock.calls.some(
        (call) =>
          String(call[0]?.path ?? '').endsWith('/meetingRooms') && call[0]?.body?.meetingRoomsToAdd,
      ),
    ).toBe(false);
    expect(updated.meetingRooms).toEqual([]);
  });

  it('updateEvent does not treat missing eventsview meetingRooms as none booked', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent, meetingRooms: [] })
      .mockResolvedValueOnce({ events: [{ id: 'evt-1' }] });
    await expect(
      service.updateEvent({ eventId: 'evt-1', roomIds: ['room-B'] }),
    ).rejects.toMatchObject({ code: 'DINGTALK_UNAVAILABLE' });
    expect(mockRequest.mock.calls.some((call) => call[0]?.method === 'PUT')).toBe(false);
    expect(
      mockRequest.mock.calls.some(
        (call) =>
          String(call[0]?.path ?? '').includes('/meetingRooms') && call[0]?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('replaceRooms rolls back a required remove when the subsequent add fails', async () => {
    const fiveRooms = [1, 2, 3, 4, 5].map((n) => ({ roomId: `room-old-${n}` }));
    const nextRooms = [1, 2, 3, 4, 5].map((n) => `room-new-${n}`);
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms(fiveRooms))
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'))
      .mockResolvedValueOnce({});
    await expect(
      service.updateEvent({ eventId: 'evt-1', roomIds: nextRooms }),
    ).rejects.toMatchObject({ code: 'DINGTALK_UNAVAILABLE' });
    expect(mockRequest).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        body: { meetingRoomsToRemove: fiveRooms.map((room) => ({ roomId: room.roomId })) },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1/meetingRooms/batchRemove',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        body: { meetingRoomsToAdd: nextRooms.map((roomId) => ({ roomId })) },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1/meetingRooms',
      }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        body: { meetingRoomsToAdd: fiveRooms.map((room) => ({ roomId: room.roomId })) },
        method: 'POST',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-1/meetingRooms',
      }),
    );
  });

  it('createEvent deletes the created event when room booking fails', async () => {
    mockRequest
      .mockResolvedValueOnce({ ...myEvent, id: 'evt-new' })
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'))
      .mockResolvedValueOnce({});
    await expect(
      service.createEvent({
        end: '2026-09-22T11:00:00+08:00',
        roomIds: ['room-1'],
        start: '2026-09-22T10:00:00+08:00',
        summary: '周会',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_UNAVAILABLE' });
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: 'DELETE',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-new',
        query: { pushNotification: true },
      }),
    );
  });

  it('createEvent room-unavailable keeps compensation and attaches roomIssues', async () => {
    const bookingError = new DingtalkWorkspaceError(
      'DINGTALK_ROOM_UNAVAILABLE',
      'meetingRoomNotAvailable',
    );
    bookingError.upstreamMessage =
      'code: 321001, developerMessage: [{"roomName":"捷发2楼会议室","text":"The reservation period shall not be less than 30 minutes."}]';
    mockRequest
      .mockResolvedValueOnce({ ...myEvent, id: 'evt-new' })
      .mockRejectedValueOnce(bookingError)
      .mockResolvedValueOnce({});
    await expect(
      service.createEvent({
        end: '2026-09-22T11:00:00+08:00',
        roomIds: ['room-1'],
        start: '2026-09-22T10:00:00+08:00',
        summary: '周会',
      }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_ROOM_UNAVAILABLE',
      roomIssues: [{ reason: '预订时长不得少于 30 分钟', roomName: '捷发2楼会议室' }],
    });
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: 'DELETE',
        path: '/v1.0/calendar/users/union-me/calendars/primary/events/evt-new',
        query: { pushNotification: true },
      }),
    );
  });

  it('updateEvent room-unavailable after a time change sets timeApplied', async () => {
    const bookingError = new DingtalkWorkspaceError(
      'DINGTALK_ROOM_UNAVAILABLE',
      'meetingRoomNotAvailable',
    );
    bookingError.upstreamMessage =
      'code: 321001, developerMessage: [{"roomName":"捷发2楼会议室","text":"The reservation period shall not be less than 30 minutes."}]';
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms([{ roomId: 'room-A' }]))
      .mockResolvedValueOnce({ ...myEvent })
      .mockRejectedValueOnce(bookingError);
    await expect(
      service.updateEvent({
        end: '2026-09-22T15:00:00+08:00',
        eventId: 'evt-1',
        roomIds: ['room-B'],
        start: '2026-09-22T14:00:00+08:00',
      }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_ROOM_UNAVAILABLE',
      roomIssues: [expect.objectContaining({ roomName: '捷发2楼会议室' })],
      timeApplied: true,
    });
    expect(mockRequest.mock.calls.some((call) => call[0]?.method === 'PUT')).toBe(true);
  });

  it('updateEvent room-only replacement failure does not set timeApplied', async () => {
    const bookingError = new DingtalkWorkspaceError(
      'DINGTALK_ROOM_UNAVAILABLE',
      'meetingRoomNotAvailable',
    );
    bookingError.upstreamMessage =
      'developerMessage: [{"roomName":"捷发2楼会议室","text":"already booked"}]';
    mockRequest
      .mockResolvedValueOnce({ ...myEvent })
      .mockResolvedValueOnce(eventsViewWithRooms([{ roomId: 'room-A' }]))
      .mockResolvedValueOnce({ ...myEvent })
      .mockRejectedValueOnce(bookingError);
    let caught: { code?: string; roomIssues?: unknown; timeApplied?: boolean } | undefined;
    try {
      await service.updateEvent({ eventId: 'evt-1', roomIds: ['room-B'] });
    } catch (error) {
      caught = error as { code?: string; roomIssues?: unknown; timeApplied?: boolean };
    }
    expect(caught).toMatchObject({
      code: 'DINGTALK_ROOM_UNAVAILABLE',
      roomIssues: [{ reason: '该时段已被预订', roomName: '捷发2楼会议室' }],
    });
    expect(caught?.timeApplied).toBeUndefined();
  });

  it('listEvents maps attendee unionIds to staff tokens and drops unionIds', async () => {
    const mapped = new DingtalkCalendarService(
      directoryDb([
        { deptPath: '财务', name: '李四', staffId: 'li', unionId: 'union-li' },
        { deptPath: '研发', name: '张三', staffId: 'staff-me', unionId: 'union-me' },
      ]) as never,
      'user-1',
    );
    mockRequest.mockResolvedValueOnce({
      events: [
        {
          ...myEvent,
          attendees: [
            { displayName: '李四', id: 'union-li' },
            { displayName: '外部客户', id: 'union-ext' },
          ],
        },
      ],
    });
    const result = await mapped.listEvents({
      from: '2026-09-22T00:00:00+08:00',
      to: '2026-09-23T00:00:00+08:00',
    });
    expect(result.items[0]?.attendees).toEqual([
      expect.objectContaining({ displayName: '李四', staffToken: 'staff:li' }),
      expect.objectContaining({ displayName: '外部客户', unresolved: true }),
    ]);
    expect(result.items[0]?.attendees[0]).not.toHaveProperty('id');
    expect(result.items[0]?.attendees[1]).not.toHaveProperty('staffToken');
    expect(result.items[0]?.organizer).toEqual(
      expect.objectContaining({ displayName: '张三', staffToken: 'staff:staff-me' }),
    );
    expect(result.items[0]?.organizer).not.toHaveProperty('id');
    expect(JSON.stringify(result)).not.toContain('union-li');
    expect(JSON.stringify(result)).not.toContain('union-me');
    expect(JSON.stringify(result)).not.toContain('union-ext');
  });

  it('getEvent maps attendee unionIds to staff tokens', async () => {
    const mapped = new DingtalkCalendarService(
      directoryDb([
        { deptPath: '财务', name: '李四', staffId: 'li', unionId: 'union-li' },
        { deptPath: '研发', name: '张三', staffId: 'staff-me', unionId: 'union-me' },
      ]) as never,
      'user-1',
    );
    mockRequest.mockResolvedValueOnce({
      ...myEvent,
      attendees: [{ displayName: '李四', id: 'union-li' }],
    });
    const event = await mapped.getEvent({ eventId: 'evt-1' });
    expect(event.attendees).toEqual([
      expect.objectContaining({ displayName: '李四', staffToken: 'staff:li' }),
    ]);
    expect(event.organizer).toEqual(
      expect.objectContaining({ displayName: '张三', staffToken: 'staff:staff-me' }),
    );
    expect(event.organizer).not.toHaveProperty('id');
    expect(JSON.stringify(event)).not.toContain('union-li');
    expect(JSON.stringify(event)).not.toContain('union-me');
  });

  it('getEvent keeps unresolved attendees when directory lookup misses', async () => {
    const mapped = new DingtalkCalendarService(
      directoryDb([
        { deptPath: '研发', name: '张三', staffId: 'staff-me', unionId: 'union-me' },
      ]) as never,
      'user-1',
    );
    mockRequest.mockResolvedValueOnce({
      ...myEvent,
      attendees: [{ displayName: '外部客户', id: 'union-ext' }],
    });
    const event = await mapped.getEvent({ eventId: 'evt-1' });
    expect(event.attendees).toEqual([
      expect.objectContaining({ displayName: '外部客户', unresolved: true }),
    ]);
    expect(event.attendees[0]).not.toHaveProperty('id');
    expect(JSON.stringify(event)).not.toContain('union-ext');
  });

  it('getEvent fails closed when the directory lookup throws', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockRejectedValue(new Error('select failed')),
        })),
      })),
    };
    const mapped = new DingtalkCalendarService(db as never, 'user-1');
    mockRequest.mockResolvedValueOnce({
      ...myEvent,
      attendees: [{ displayName: '李四', id: 'union-li' }],
    });
    await expect(mapped.getEvent({ eventId: 'evt-1' })).rejects.toMatchObject({
      code: 'DINGTALK_UNAVAILABLE',
    });
  });

  it('rejects a time window longer than one year', async () => {
    await expect(
      service.listEvents({ from: '2025-01-01T00:00:00+08:00', to: '2026-09-01T00:00:00+08:00' }),
    ).rejects.toBeInstanceOf(DingtalkWorkspaceError);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('queryFreeBusy emits one unknown row per requested person missing from the response', async () => {
    mockResolveStaff
      .mockResolvedValueOnce({
        deptPath: '财务',
        name: '李四',
        staffId: 'staff-li',
        unionId: 'union-li',
      })
      .mockResolvedValueOnce({
        deptPath: '研发',
        name: '王五',
        staffId: 'staff-wang',
        unionId: 'union-wang',
      });
    mockRequest.mockResolvedValueOnce({
      scheduleInformation: [
        {
          scheduleItems: [{ status: 'BUSY', start: { dateTime: '2026-09-22T10:00:00+08:00' } }],
          userId: 'union-li',
        },
      ],
    });
    const result = await service.queryFreeBusy({
      from: '2026-09-22T00:00:00+08:00',
      staffTokens: ['staff:staff-li', 'staff:staff-wang'],
      to: '2026-09-22T23:59:00+08:00',
    });
    expect(result.people).toHaveLength(2);
    expect(result.people[0]).toMatchObject({
      name: '李四 · 财务',
      staffToken: 'staff:staff-li',
    });
    expect(result.people[1]).toEqual({
      blocks: [],
      error: 'DINGTALK_UNAVAILABLE',
      name: '王五 · 研发',
      staffToken: 'staff:staff-wang',
      status: 'unknown',
    });
  });

  it('preview(updateEvent) shows the room replacement including a clear', async () => {
    mockRequest
      .mockResolvedValueOnce(myEvent)
      .mockResolvedValueOnce({ result: [{ roomId: 'room-B', roomName: '捷发2楼会议室' }] });
    const replaced = await service.preview({
      apiName: 'updateEvent',
      args: { eventId: 'evt-1', roomIds: ['room-B'] },
    });
    expect(replaced.lines).toEqual(
      expect.arrayContaining([{ label: '会议室', value: '捷发2楼会议室' }]),
    );

    mockRequest.mockResolvedValueOnce(myEvent);
    const cleared = await service.preview({
      apiName: 'updateEvent',
      args: { eventId: 'evt-1', roomIds: [] },
    });
    expect(cleared.lines).toEqual(
      expect.arrayContaining([{ label: '会议室', value: '清除会议室' }]),
    );
  });

  it('preview resolves room names and reuses the 10-minute in-process cache', async () => {
    mockRequest.mockResolvedValue({
      result: [{ roomId: '57e7f532-room', roomName: '捷发2楼会议室' }],
    });
    const args = {
      end: '2026-09-22T11:00:00+08:00',
      roomIds: ['57e7f532-room'],
      start: '2026-09-22T10:00:00+08:00',
      summary: '周会',
    };
    const first = await service.preview({ apiName: 'createEvent', args });
    expect(first.lines).toEqual(
      expect.arrayContaining([{ label: '会议室', value: '捷发2楼会议室' }]),
    );
    expect(first.warnings).toEqual([]);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    await service.preview({ apiName: 'createEvent', args });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('preview shows 未知会议室 and a warning for unknown room ids', async () => {
    mockRequest.mockResolvedValue({ result: [] });
    const preview = await service.preview({
      apiName: 'createEvent',
      args: {
        end: '2026-09-22T11:00:00+08:00',
        roomIds: ['57e7f532-unknown'],
        start: '2026-09-22T10:00:00+08:00',
        summary: '周会',
      },
    });
    expect(preview.lines).toEqual(
      expect.arrayContaining([{ label: '会议室', value: '未知会议室' }]),
    );
    expect(preview.warnings).toEqual(
      expect.arrayContaining(['有会议室无法识别，请先列出会议室后使用返回的 roomId']),
    );
    expect(JSON.stringify(preview.lines)).not.toContain('57e7f532');
  });
});
