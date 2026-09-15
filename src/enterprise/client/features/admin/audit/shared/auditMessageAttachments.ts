/**
 * Local overlay for the optional audit-message `attachments` field until the
 * server DTO lands. Present only when bodies are loadable; otherwise omitted.
 */
export interface AuditMessageAttachment {
  fileId: string;
  fileType: string;
  name: string;
  size: number;
  url: string;
}

export const isImageFileType = (fileType: string): boolean =>
  fileType.trim().toLowerCase().startsWith('image/');
