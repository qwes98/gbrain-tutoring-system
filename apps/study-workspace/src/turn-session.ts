import type { TutorCorePort, TutorTurnRequest, TutorTurnResponse } from "./core/tutor-core-port.ts";

export type TutorTurnResult =
  | { status: "accepted"; response: TutorTurnResponse }
  | { status: "stale" }
  | { status: "busy" };

export class TutorTurnGate {
  #documentId = "local:unloaded";
  #generation = 0;
  #pendingGeneration: number | null = null;

  replaceSession(documentId: string): void {
    this.#documentId = documentId;
    this.#generation += 1;
    this.#pendingGeneration = null;
  }

  isPending(): boolean {
    return this.#pendingGeneration === this.#generation;
  }

  async send(
    port: TutorCorePort,
    request: TutorTurnRequest,
    onAdmitted?: () => void,
  ): Promise<TutorTurnResult> {
    const generation = this.#generation;
    if (request.source.documentId !== this.#documentId) return { status: "stale" };
    if (this.#pendingGeneration === generation) return { status: "busy" };
    this.#pendingGeneration = generation;

    try {
      onAdmitted?.();
      const response = await port.sendTurn(request);
      if (this.#generation !== generation || this.#documentId !== request.source.documentId) {
        return { status: "stale" };
      }
      return { status: "accepted", response };
    } catch (error) {
      if (this.#generation !== generation) return { status: "stale" };
      throw error;
    } finally {
      if (this.#pendingGeneration === generation) this.#pendingGeneration = null;
    }
  }
}
