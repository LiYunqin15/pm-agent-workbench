import { diffLines } from "diff";

export type VersionDiffSegment = {
  type: "added" | "removed";
  text: string;
};

export type VersionDiffSummary = {
  addedLines: number;
  removedLines: number;
  segments: VersionDiffSegment[];
};

function countLines(value: string): number {
  if (!value) return 0;
  return value.replace(/\r\n/g, "\n").split("\n").filter((line, index, lines) => !(index === lines.length - 1 && line === "")).length;
}

export function summarizeVersionDiff(previous: string | null, current: string, maxSegments = 6): VersionDiffSummary {
  if (previous === null) return { addedLines: countLines(current), removedLines: 0, segments: [] };
  const changes = diffLines(previous, current);
  let addedLines = 0;
  let removedLines = 0;
  const segments: VersionDiffSegment[] = [];

  changes.forEach((change) => {
    if (!change.added && !change.removed) return;
    const type = change.added ? "added" : "removed";
    const lineCount = countLines(change.value);
    if (type === "added") addedLines += lineCount;
    else removedLines += lineCount;
    if (segments.length < maxSegments) {
      const lines = change.value.replace(/\r\n/g, "\n").split("\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
      segments.push({ type, text: lines.slice(0, 3).join("\n") || "（空行）" });
    }
  });

  return { addedLines, removedLines, segments };
}
