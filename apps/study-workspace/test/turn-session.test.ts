import { describe, expect, test } from "bun:test";
import {
  TUTOR_CORE_PORT_VERSION,
  type TutorCorePort,
  type TutorTurnRequest,
  type TutorTurnResponse,
} from "../src/core/tutor-core-port.ts";
import { TutorTurnGate } from "../src/turn-session.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("tutor turn session isolation", () => {
  test("ignores a delayed response after the initiating document session is replaced", async () => {
    const delayed = deferred<TutorTurnResponse>();
    const fake: TutorCorePort = {
      version: TUTOR_CORE_PORT_VERSION,
      getContext: async () => ({
        mode: "mock",
        concept: { id: "fixture", title: "Fixture" },
        action: "explain",
        reasonCodes: ["fixture"],
        evidenceEventIds: ["evt-fixture"],
      }),
      sendTurn: (_request: TutorTurnRequest) => delayed.promise,
    };
    const request: TutorTurnRequest = {
      question: "Explain this.",
      source: {
        documentId: "pdf:first",
        page: 1,
        kind: "page",
        accuracy: "page",
      },
    };
    const gate = new TutorTurnGate();
    gate.replaceSession("pdf:first");

    const pending = gate.send(fake, request);
    gate.replaceSession("pdf:first");
    delayed.resolve({
      mode: "mock",
      message: "Response for the first document",
      source: request.source,
      context: await fake.getContext(),
    });

    await expect(pending).resolves.toEqual({ status: "stale" });
  });

  test("prevents overlapping turns in the same document session", async () => {
    const delayed = deferred<TutorTurnResponse>();
    let calls = 0;
    const fake = {
      version: TUTOR_CORE_PORT_VERSION,
      getContext: async () => ({
        mode: "mock" as const,
        concept: { id: "fixture", title: "Fixture" },
        action: "explain",
        reasonCodes: ["fixture"],
        evidenceEventIds: ["evt-fixture"],
      }),
      sendTurn: (_request: TutorTurnRequest) => {
        calls += 1;
        return delayed.promise;
      },
    };
    const request: TutorTurnRequest = {
      question: "Explain this.",
      source: { documentId: "pdf:first", page: 1, kind: "page", accuracy: "page" },
    };
    const gate = new TutorTurnGate();
    gate.replaceSession("pdf:first");
    let admissions = 0;

    const first = gate.send(fake, request, () => {
      admissions += 1;
    });
    await expect(gate.send(fake, request, () => {
      admissions += 1;
    })).resolves.toEqual({ status: "busy" });
    expect(calls).toBe(1);
    expect(admissions).toBe(1);
    delayed.resolve({
      mode: "mock",
      message: "Only response",
      source: request.source,
      context: await fake.getContext(),
    });
    await expect(first).resolves.toMatchObject({ status: "accepted" });
  });

  test("does not admit a stale turn or discard its draft", async () => {
    const fake: TutorCorePort = {
      version: TUTOR_CORE_PORT_VERSION,
      getContext: async () => ({
        mode: "mock",
        concept: { id: "fixture", title: "Fixture" },
        action: "explain",
        reasonCodes: ["fixture"],
        evidenceEventIds: ["evt-fixture"],
      }),
      sendTurn: async () => {
        throw new Error("stale turn must not reach the port");
      },
    };
    const gate = new TutorTurnGate();
    gate.replaceSession("pdf:active");
    let draft = "Keep this question";
    const messages: string[] = [];

    const result = await gate.send(fake, {
      question: draft,
      source: { documentId: "pdf:stale", page: 1, kind: "page", accuracy: "page" },
    }, () => {
      messages.push(draft);
      draft = "";
    });

    expect(result).toEqual({ status: "stale" });
    expect(messages).toEqual([]);
    expect(draft).toBe("Keep this question");
  });
});
