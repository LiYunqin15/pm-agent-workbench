import { describe, expect, it } from "vitest";
import { maxTurnsFor, selectModel } from "./router";

describe("model router", () => {
  it("uses the balanced model by default", () => {
    expect(selectModel("standard", {})).toBe("gpt-5.6-terra");
  });

  it("allows explicit environment overrides", () => {
    expect(selectModel("deep", { OPENAI_MODEL_DEEP: "custom-model" })).toBe("custom-model");
  });

  it("caps turns according to run depth", () => {
    expect(maxTurnsFor("quick")).toBeLessThan(maxTurnsFor("standard"));
    expect(maxTurnsFor("standard")).toBeLessThan(maxTurnsFor("deep"));
  });
});

