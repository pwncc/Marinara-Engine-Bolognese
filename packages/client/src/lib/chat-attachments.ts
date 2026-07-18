const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "json",
  "jsonl",
  "log",
  "markdown",
  "md",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const VIDEO_ATTACHMENT_EXTENSIONS = new Set(["m4v", "mov", "mp4", "mpeg", "mpg", "webm"]);
const GENERIC_ATTACHMENT_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function getFileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function inferChatAttachmentType(file: File): string {
  const extension = getFileExtension(file.name);
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  if (extension === "mpeg" || extension === "mpg") return "video/mpeg";
  if (file.type && !GENERIC_ATTACHMENT_TYPES.has(file.type.toLowerCase())) return file.type;
  if (extension === "json" || extension === "jsonl") return "application/json";
  if (extension === "csv") return "text/csv";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "xml") return "application/xml";
  if (extension === "yaml" || extension === "yml") return "application/yaml";
  if (extension === "txt" || extension === "log") return "text/plain";
  return "application/octet-stream";
}

export function isVideoChatAttachmentType(type: string | null | undefined): boolean {
  return typeof type === "string" && type.toLowerCase().startsWith("video/");
}

export function isVideoChatAttachmentDataUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^data:video\//i.test(value);
}

export function isSupportedChatAttachment(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type.startsWith("video/")) return true;
  if (file.type.startsWith("text/")) return true;
  const type = inferChatAttachmentType(file);
  if (
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/yaml" ||
    type === "application/x-yaml"
  ) {
    return true;
  }
  const extension = getFileExtension(file.name);
  return TEXT_ATTACHMENT_EXTENSIONS.has(extension) || VIDEO_ATTACHMENT_EXTENSIONS.has(extension);
}

export function readFileAsDataUrl(file: Blob, mediaType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    const blob = mediaType && file.type !== mediaType ? file.slice(0, file.size, mediaType) : file;
    reader.readAsDataURL(blob);
  });
}
