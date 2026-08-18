import { describe, expect, it } from "vitest";
import { DocumentFileError, parseUploadedDocument } from "./office";

describe("document import parsing", () => {
  it("wraps plain text as editable Markdown", async () => {
    const result = await parseUploadedDocument("meeting.txt", Buffer.from("结论：下周验证。", "utf8"));
    expect(result.title).toBe("meeting");
    expect(result.content).toContain("结论：下周验证。");
  });

  it("preserves JSON as a fenced code block", async () => {
    const result = await parseUploadedDocument("research.json", Buffer.from('{"score": 4}', "utf8"));
    expect(result.content).toContain("```json");
    expect(result.content).toContain('"score": 4');
  });

  it("reads Markdown and rejects unsupported extensions", async () => {
    const markdown = await parseUploadedDocument("brief.markdown", Buffer.from("# 标题\n\n正文", "utf8"));
    expect(markdown.content).toContain("标题");
    await expect(parseUploadedDocument("archive.zip", Buffer.from("not supported"))).rejects.toBeInstanceOf(DocumentFileError);
  });

  it("removes executable HTML content before parsing", async () => {
    const result = await parseUploadedDocument("unsafe.html", Buffer.from("<h1>研究</h1><script>alert('x')</script><p onclick=alert(1)>正文</p>", "utf8"));
    expect(result.content).toContain("研究");
    expect(result.content).toContain("正文");
    expect(result.content).not.toMatch(/script|onclick|javascript:/i);
  });
});
