export const isImageFileType = (fileType: string): boolean =>
  fileType.trim().toLowerCase().startsWith('image/');
