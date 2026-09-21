import type { BuiltinRender } from '@lobechat/types';

import { DingtalkWorkspaceApiName, DingtalkWorkspaceWriteApiNames } from '../apiNames';
import DirectoryList from './DirectoryList';
import EventDetail from './EventDetail';
import EventList from './EventList';
import FreeBusyList from './FreeBusyList';
import RoomList from './RoomList';
import TodoList from './TodoList';
import WriteResult from './WriteResult';

/**
 * Render registry: each read API gets its own compact result view, every write
 * API a one-line success state (or the mapped error).
 */
export const DingtalkWorkspaceRenders: Record<string, BuiltinRender> = {
  [DingtalkWorkspaceApiName.getEvent]: EventDetail as BuiltinRender,
  [DingtalkWorkspaceApiName.listEvents]: EventList as BuiltinRender,
  [DingtalkWorkspaceApiName.listMeetingRooms]: RoomList as BuiltinRender,
  [DingtalkWorkspaceApiName.listTodos]: TodoList as BuiltinRender,
  [DingtalkWorkspaceApiName.queryFreeBusy]: FreeBusyList as BuiltinRender,
  [DingtalkWorkspaceApiName.searchDirectory]: DirectoryList as BuiltinRender,
  ...Object.fromEntries(
    DingtalkWorkspaceWriteApiNames.map((apiName) => [apiName, WriteResult as BuiltinRender]),
  ),
};

export { default as DingtalkWorkspaceDirectoryRender } from './DirectoryList';
export { default as DingtalkWorkspaceEventDetailRender } from './EventDetail';
export { default as DingtalkWorkspaceEventListRender } from './EventList';
export { default as DingtalkWorkspaceFreeBusyRender } from './FreeBusyList';
export { default as DingtalkWorkspaceRoomListRender } from './RoomList';
export { default as DingtalkWorkspaceTodoListRender } from './TodoList';
export { default as DingtalkWorkspaceWriteRender } from './WriteResult';
