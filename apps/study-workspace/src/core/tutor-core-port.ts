import type { SourceAnchor } from "../source-anchor.ts";

export const TUTOR_CORE_PORT_VERSION = "gbrain-tutor-core/v1" as const;

export interface TutorContext {
  mode: "mock" | "live";
  concept: {
    id: string;
    title: string;
  };
  action: string;
  reasonCodes: string[];
  evidenceEventIds: string[];
}

export interface TutorTurnRequest {
  question: string;
  source: SourceAnchor;
}

export interface TutorTurnResponse {
  mode: "mock" | "live";
  message: string;
  source: SourceAnchor;
  context: TutorContext;
}

export interface TutorCorePort {
  readonly version: typeof TUTOR_CORE_PORT_VERSION;
  getContext(): Promise<TutorContext>;
  sendTurn(request: TutorTurnRequest): Promise<TutorTurnResponse>;
}
