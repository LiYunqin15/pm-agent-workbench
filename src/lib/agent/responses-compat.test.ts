import {
  Usage,
  protocol,
  type AgentOutputItem,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from "@openai/agents";
import { describe, expect, it } from "vitest";
import {
  RelayResponsesModelProvider,
  isCustomResponsesEndpoint,
  isResponsesOutputValidationError,
  normalizeRelayModelResponse,
  normalizeRelayStreamEvent,
  mapRelayFailure,
} from "./responses-compat";

function assistantMessage(status?: unknown): AgentOutputItem {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "done" }],
    ...(status === undefined ? {} : { status }),
  } as unknown as AgentOutputItem;
}

function modelResponse(status?: unknown): ModelResponse {
  return {
    usage: new Usage(),
    output: [assistantMessage(status)],
    responseId: "resp_1",
  };
}

function responseDone(status?: unknown): StreamEvent {
  return {
    type: "response_done",
    response: {
      id: "resp_1",
      usage: new Usage(),
      output: [assistantMessage(status)],
    },
  } as unknown as StreamEvent;
}

describe("relay Responses compatibility", () => {
  it("only treats non-OpenAI endpoints as relay endpoints", () => {
    expect(isCustomResponsesEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isCustomResponsesEndpoint("https://relay.example.com/v1")).toBe(true);
    expect(isCustomResponsesEndpoint(undefined)).toBe(false);
  });

  it("fills a missing assistant message status", () => {
    const normalized = normalizeRelayModelResponse(modelResponse());
    expect(normalized.output[0]).toMatchObject({ status: "completed" });
  });

  it("replaces an invalid assistant message status", () => {
    const normalized = normalizeRelayModelResponse(modelResponse("finished"));
    expect(normalized.output[0]).toMatchObject({ status: "completed" });
  });

  it("preserves valid statuses", () => {
    for (const status of ["in_progress", "completed", "incomplete"] as const) {
      const normalized = normalizeRelayModelResponse(modelResponse(status));
      expect(normalized.output[0]).toMatchObject({ status });
    }
  });

  it("normalizes streamed response_done events before SDK validation", () => {
    const normalized = normalizeRelayStreamEvent(responseDone("finished"));
    expect(() => protocol.StreamEventResponseCompleted.parse(normalized)).not.toThrow();
    if (normalized.type === "response_done") {
      expect(normalized.response.output[0]).toMatchObject({ status: "completed" });
    }
  });

  it("wraps both non-streaming and streaming model calls", async () => {
    const inner: Model = {
      async getResponse() {
        return modelResponse();
      },
      async *getStreamedResponse() {
        yield responseDone();
      },
    };
    const provider = new RelayResponsesModelProvider({ getModel: () => inner });
    const model = await provider.getModel("relay-model");
    const request = {} as ModelRequest;

    expect((await model.getResponse(request)).output[0]).toMatchObject({ status: "completed" });
    const events: StreamEvent[] = [];
    for await (const event of model.getStreamedResponse(request)) events.push(event);
    expect(events[0]).toMatchObject({
      type: "response_done",
      response: { output: [{ status: "completed" }] },
    });
  });

  it("recognizes upstream output validation errors", () => {
    let validationError: unknown;
    try {
      protocol.StreamEventResponseCompleted.parse(responseDone("finished"));
    } catch (error) {
      validationError = error;
    }
    expect(isResponsesOutputValidationError(validationError)).toBe(true);
  });

  it("maps relay authentication, rate limit, and Web Search capability failures", () => {
    expect(mapRelayFailure(Object.assign(new Error("unauthorized"), { status: 401 })).code).toBe("UPSTREAM_AUTH_ERROR");
    expect(mapRelayFailure(Object.assign(new Error("rate limited"), { status: 429 })).code).toBe("UPSTREAM_RATE_LIMIT");
    expect(mapRelayFailure(Object.assign(new Error("web_search tool unsupported"), { status: 400 })).code).toBe("WEB_SEARCH_UNAVAILABLE");
  });
});
