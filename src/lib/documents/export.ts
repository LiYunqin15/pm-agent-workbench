import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseOffice } from "officeparser";

export type ExportFormat = "markdown" | "html" | "txt" | "docx" | "pdf";

function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 120) || "产品文档";
}

function markdownToPlainText(content: string): string {
  return content
    .replace(/^```[a-z]*\s*$/gim, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim();
}

async function markdownToHtml(content: string): Promise<string> {
  const ast = await parseOffice(Buffer.from(content, "utf8"), { fileType: "md" });
  const result = await ast.to("html");
  return String(result.value ?? "");
}

function markdownToDocxChildren(title: string, content: string): Paragraph[] {
  const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const line of content.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(value);
    if (heading) {
      const level = heading[1].length === 1 ? HeadingLevel.HEADING_1 : heading[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ text: heading[2], heading: level }));
      continue;
    }
    const bullet = /^(?:[-*+] |\d+\. )(.+)$/.exec(value);
    children.push(new Paragraph({
      children: [new TextRun({ text: bullet?.[1] ?? value })],
      ...(bullet ? { bullet: { level: 0 } } : {}),
    }));
  }
  return children;
}

async function markdownToDocx(title: string, content: string): Promise<Buffer> {
  const document = new Document({ sections: [{ children: markdownToDocxChildren(title, content) }] });
  return Packer.toBuffer(document);
}

export async function exportDocumentContent(title: string, content: string, format: ExportFormat) {
  const name = safeFileName(title);
  if (format === "markdown") {
    return { body: Buffer.from(content, "utf8"), contentType: "text/markdown; charset=utf-8", filename: `${name}.md` };
  }
  if (format === "txt") {
    return { body: Buffer.from(markdownToPlainText(content), "utf8"), contentType: "text/plain; charset=utf-8", filename: `${name}.txt` };
  }
  if (format === "html") {
    const html = await markdownToHtml(content);
    return { body: Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title></head><body>${html}</body></html>`, "utf8"), contentType: "text/html; charset=utf-8", filename: `${name}.html` };
  }
  if (format === "docx") {
    return { body: await markdownToDocx(title, content), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: `${name}.docx` };
  }
  const html = await markdownToHtml(content);
  const printHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;max-width:850px;margin:40px auto;color:#202124;line-height:1.7}h1,h2,h3{line-height:1.3}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9dde5;padding:7px;text-align:left}@media print{body{margin:0;max-width:none}}</style></head><body>${html}<script>window.addEventListener('load',()=>window.print())</script></body></html>`;
  return { body: Buffer.from(printHtml, "utf8"), contentType: "text/html; charset=utf-8", filename: `${name}.pdf`, printable: true };
}
