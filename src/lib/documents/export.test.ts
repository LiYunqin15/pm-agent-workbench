import { describe, expect, it } from "vitest";
import { exportDocumentContent } from "./export";

describe("document export", () => {
  it("exports Markdown, text, HTML and DOCX buffers", async () => {
    const content = "# 标题\n\n- 一条结论";
    const markdown = await exportDocumentContent("测试文档", content, "markdown");
    const text = await exportDocumentContent("测试文档", content, "txt");
    const html = await exportDocumentContent("测试文档", content, "html");
    const docx = await exportDocumentContent("测试文档", content, "docx");
    expect(markdown.filename).toBe("测试文档.md");
    expect(text.body.toString("utf8")).toContain("标题");
    expect(html.body.toString("utf8")).toContain("<html");
    expect(docx.body.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("returns a printable HTML page for PDF output", async () => {
    const pdf = await exportDocumentContent("测试文档", "# 标题", "pdf");
    expect(pdf.printable).toBe(true);
    expect(pdf.filename).toBe("测试文档.pdf");
    expect(pdf.body.toString("utf8")).toContain("window.print()");
  });
});
