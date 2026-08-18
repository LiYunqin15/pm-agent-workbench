import { parseOffice, type SupportedFileType } from "officeparser";

const OFFICE_EXTENSIONS = new Set([
  "docx", "pptx", "xlsx", "odt", "odp", "ods", "pdf", "rtf", "md", "markdown", "html", "htm", "csv", "epub",
]);

export class DocumentFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFileError";
  }
}

function extensionOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

function cleanTitle(name: string): string {
  const title = name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, " ").trim();
  return title.slice(0, 180) || "导入文档";
}

function sanitizeHtml(source: string): string {
  return source
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:\s*text\/html/gi, "");
}

export function supportedImportExtensions(): string[] {
  return [...OFFICE_EXTENSIONS, "txt", "json"];
}

export async function parseUploadedDocument(name: string, buffer: Buffer): Promise<{ title: string; content: string }> {
  const extension = extensionOf(name) === "markdown" ? "md" : extensionOf(name);
  if (extension === "txt" || extension === "json") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    if (!text) throw new DocumentFileError("文件内容为空。");
    const content = extension === "json"
      ? `# ${cleanTitle(name)}\n\n\`\`\`json\n${text}\n\`\`\``
      : `# ${cleanTitle(name)}\n\n${text}`;
    return { title: cleanTitle(name), content };
  }
  if (!OFFICE_EXTENSIONS.has(extension)) {
    throw new DocumentFileError("暂不支持此文件格式。可导入 DOCX、PPTX、XLSX、PDF、HTML、Markdown、CSV、TXT 或 JSON。");
  }
  try {
    const safeBuffer = extension === "html" || extension === "htm"
      ? Buffer.from(sanitizeHtml(buffer.toString("utf8")), "utf8")
      : buffer;
    const config = extension === "md" || extension === "html" || extension === "htm" || extension === "csv"
      ? { fileType: (extension === "htm" ? "html" : extension) as SupportedFileType }
      : undefined;
    const ast = await parseOffice(safeBuffer, config);
    const result = await ast.to("md");
    const content = String(result.value ?? "").trim();
    if (!content) throw new DocumentFileError("文件没有可读取的文本内容。");
    return { title: cleanTitle(name), content };
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    throw new DocumentFileError(`文件读取失败：${error instanceof Error ? error.message : "解析器无法识别该文件"}`);
  }
}
