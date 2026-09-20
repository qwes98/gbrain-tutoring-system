import {
  TUTOR_CORE_PORT_VERSION,
  type TutorContext,
  type TutorCorePort,
  type TutorTurnRequest,
  type TutorTurnResponse,
} from "../core/tutor-core-port.ts";

const MOCK_CONTEXT: TutorContext = {
  mode: "mock",
  concept: {
    id: "append-only-history",
    title: "Append-only history",
  },
  action: "elicit_attempt",
  reasonCodes: ["evidence_before_explanation", "single_bottleneck"],
  evidenceEventIds: ["fixture-question-1"],
};

export class MockTutorCore implements TutorCorePort {
  readonly version = TUTOR_CORE_PORT_VERSION;

  async getContext(): Promise<TutorContext> {
    return structuredClone(MOCK_CONTEXT);
  }

  async sendTurn(request: TutorTurnRequest): Promise<TutorTurnResponse> {
    const context = await this.getContext();
    return {
      mode: "mock",
      message: `MockTutorCore: Before I explain, what property does appending preserve when earlier records remain unchanged? Your question was: “${request.question}”`,
      source: structuredClone(request.source),
      context,
    };
  }
}
