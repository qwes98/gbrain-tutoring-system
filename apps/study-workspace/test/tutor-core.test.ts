import { describe, expect, test } from "bun:test";
import { MockTutorCore } from "../src/adapters/mock-tutor-core.ts";
import { TUTOR_CORE_PORT_VERSION } from "../src/core/tutor-core-port.ts";

describe("TutorCorePort", () => {
  test("the mock exposes a versioned, inspectable tutoring turn without core imports", async () => {
    const tutor = new MockTutorCore();

    const context = await tutor.getContext();
    const response = await tutor.sendTurn({
      question: "Why are corrections appended?",
      source: {
        documentId: "local:concurrency-notes.pdf",
        page: 2,
        kind: "selection",
        quote: "Corrections are new records.",
        accuracy: "exact",
      },
    });

    expect(tutor.version).toBe(TUTOR_CORE_PORT_VERSION);
    expect(context).toMatchObject({
      mode: "mock",
      concept: { id: "append-only-history" },
      action: "elicit_attempt",
    });
    expect(context.reasonCodes.length).toBeGreaterThan(0);
    expect(context.evidenceEventIds.length).toBeGreaterThan(0);
    expect("status" in context.concept).toBe(false);
    expect(response.mode).toBe("mock");
    expect(response.source).toEqual({
      documentId: "local:concurrency-notes.pdf",
      page: 2,
      kind: "selection",
      quote: "Corrections are new records.",
      accuracy: "exact",
    });
    expect(response.message).toContain("MockTutorCore");
    expect(response.context.reasonCodes).toEqual(context.reasonCodes);
  });
});
