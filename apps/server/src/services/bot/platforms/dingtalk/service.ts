import type {
  CreatePollParams,
  CreatePollState,
  CreateThreadParams,
  CreateThreadState,
  DeleteMessageParams,
  DeleteMessageState,
  EditMessageParams,
  EditMessageState,
  GetChannelInfoParams,
  GetChannelInfoState,
  GetMemberInfoParams,
  GetMemberInfoState,
  GetReactionsParams,
  GetReactionsState,
  ListChannelsParams,
  ListChannelsState,
  ListPinsParams,
  ListPinsState,
  ListThreadsParams,
  ListThreadsState,
  PinMessageParams,
  PinMessageState,
  ReactToMessageParams,
  ReactToMessageState,
  ReadMessagesParams,
  ReadMessagesState,
  ReplyToThreadParams,
  ReplyToThreadState,
  SearchMessagesParams,
  SearchMessagesState,
  SendDirectMessageParams,
  SendDirectMessageState,
  SendMessageParams,
  SendMessageState,
  UnpinMessageParams,
  UnpinMessageState,
} from '@lobechat/builtin-tool-message/executionRuntime';
import type { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';

import type { MessageRuntimeService } from '@/server/services/toolExecution/serverRuntimes/message/adapters/types';
import { PlatformUnsupportedError } from '@/server/services/toolExecution/serverRuntimes/message/PlatformUnsupportedError';

import { sendDingTalkAttachments } from './sendAttachments';

export class DingTalkMessageService implements MessageRuntimeService {
  constructor(
    private api: DingTalkApiClient,
    private robotCode: string,
  ) {}

  private markdownParam(content: string) {
    const title =
      content
        .split('\n')
        .find((line) => line.trim())
        ?.slice(0, 32) || 'Reply';
    return JSON.stringify({ text: content, title });
  }

  sendDirectMessage = async (params: SendDirectMessageParams): Promise<SendDirectMessageState> => {
    if (params.content?.trim()) {
      await this.api.sendOtoMessage({
        msgKey: 'sampleMarkdown',
        msgParam: this.markdownParam(params.content),
        robotCode: this.robotCode,
        userIds: [params.userId],
      });
    }
    if (params.attachments?.length) {
      await sendDingTalkAttachments(
        this.api,
        { robotCode: this.robotCode, userIds: [params.userId] },
        params.attachments,
      );
    }
    return { channelId: params.userId, platform: 'dingtalk' };
  };

  sendMessage = async (params: SendMessageParams): Promise<SendMessageState> => {
    if (params.content?.trim()) {
      await this.api.sendGroupMessage({
        msgKey: 'sampleMarkdown',
        msgParam: this.markdownParam(params.content),
        openConversationId: params.channelId,
        robotCode: this.robotCode,
      });
    }
    if (params.attachments?.length) {
      await sendDingTalkAttachments(
        this.api,
        { openConversationId: params.channelId, robotCode: this.robotCode },
        params.attachments,
      );
    }
    return { channelId: params.channelId, platform: 'dingtalk' };
  };

  readMessages = async (_params: ReadMessagesParams): Promise<ReadMessagesState> => {
    throw new PlatformUnsupportedError('DingTalk', 'readMessages');
  };

  editMessage = async (_params: EditMessageParams): Promise<EditMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'editMessage');
  };

  deleteMessage = async (_params: DeleteMessageParams): Promise<DeleteMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'deleteMessage');
  };

  searchMessages = async (_params: SearchMessagesParams): Promise<SearchMessagesState> => {
    throw new PlatformUnsupportedError('DingTalk', 'searchMessages');
  };

  reactToMessage = async (_params: ReactToMessageParams): Promise<ReactToMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'reactToMessage');
  };

  getReactions = async (_params: GetReactionsParams): Promise<GetReactionsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'getReactions');
  };

  pinMessage = async (_params: PinMessageParams): Promise<PinMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'pinMessage');
  };

  unpinMessage = async (_params: UnpinMessageParams): Promise<UnpinMessageState> => {
    throw new PlatformUnsupportedError('DingTalk', 'unpinMessage');
  };

  listPins = async (_params: ListPinsParams): Promise<ListPinsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'listPins');
  };

  getChannelInfo = async (_params: GetChannelInfoParams): Promise<GetChannelInfoState> => {
    throw new PlatformUnsupportedError('DingTalk', 'getChannelInfo');
  };

  listChannels = async (_params: ListChannelsParams): Promise<ListChannelsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'listChannels');
  };

  getMemberInfo = async (_params: GetMemberInfoParams): Promise<GetMemberInfoState> => {
    throw new PlatformUnsupportedError('DingTalk', 'getMemberInfo');
  };

  createThread = async (_params: CreateThreadParams): Promise<CreateThreadState> => {
    throw new PlatformUnsupportedError('DingTalk', 'createThread');
  };

  listThreads = async (_params: ListThreadsParams): Promise<ListThreadsState> => {
    throw new PlatformUnsupportedError('DingTalk', 'listThreads');
  };

  replyToThread = async (_params: ReplyToThreadParams): Promise<ReplyToThreadState> => {
    throw new PlatformUnsupportedError('DingTalk', 'replyToThread');
  };

  createPoll = async (_params: CreatePollParams): Promise<CreatePollState> => {
    throw new PlatformUnsupportedError('DingTalk', 'createPoll');
  };
}
