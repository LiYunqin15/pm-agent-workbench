import { describe, expect, it } from "vitest";
import { extractCitations, extractEvidence } from "./citations";

describe("citation extraction", () => {
  it("finds and deduplicates URL annotations", () => {
    const input = {
      content: [
        { type: "url_citation", url: "https://example.com/a", title: "Source A" },
        { nested: { type: "url_citation", url: "https://example.com/a", title: "Source A" } },
      ],
    };

    expect(extractCitations(input)).toEqual([
      { url: "https://example.com/a", title: "Source A" },
    ]);
  });

  it("ignores malformed annotations", () => {
    expect(extractCitations({ type: "url_citation", url: "javascript:alert(1)" })).toEqual([]);
  });

  it("combines inline citations with the complete web-search source list", () => {
    const input = [
      {
        type: "output_text",
        text: "市场规模增长显著",
        providerData: {
          annotations: [
            {
              type: "url_citation",
              url: "https://www.example.com/report#summary",
              title: "行业报告",
              start_index: 0,
              end_index: 4,
            },
          ],
        },
      },
      {
        type: "hosted_tool_call",
        name: "web_search_call",
        providerData: {
          action: {
            type: "search",
            sources: [
              { type: "url", url: "https://www.example.com/report" },
              { type: "url", url: "https://second.example.org/data" },
            ],
          },
        },
      },
    ];

    const result = extractEvidence(input, "2026-08-17T00:00:00.000Z");

    expect(result.citations).toEqual([
      { url: "https://www.example.com/report", title: "行业报告" },
    ]);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]).toMatchObject({
      cited: true,
      excerpt: "市场规模",
      publisher: "example.com",
    });
    expect(result.evidence[1]).toMatchObject({
      cited: false,
      publisher: "second.example.org",
    });
  });
});
