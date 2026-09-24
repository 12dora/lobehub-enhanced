export class BrokerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BrokerError';
    this.status = status;
    this.code = code;
  }
}

export class InvalidArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArgsError';
  }
}

export class QueueTimeoutError extends Error {
  constructor(message = '排队等待超时') {
    super(message);
    this.name = 'QueueTimeoutError';
  }
}

/** The HTTP client went away. Callers should stop a read, not a write. */
export class ClientClosedError extends Error {
  constructor() {
    super('客户端已断开');
    this.name = 'ClientClosedError';
  }
}
