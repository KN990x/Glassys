declare module "@google/gemini-cli-sdk" {
  export class GeminiCliAgent {
    constructor(options?: Record<string, unknown>);
    session(options?: { sessionId?: string }): {
      initialize?: () => Promise<void>;
      sendStream: (text: string, signal?: AbortSignal) => AsyncIterable<unknown>;
    };
    resumeSession?(
      sessionId: string,
    ):
      | {
          initialize?: () => Promise<void>;
          sendStream: (text: string, signal?: AbortSignal) => AsyncIterable<unknown>;
        }
      | Promise<{
          initialize?: () => Promise<void>;
          sendStream: (text: string, signal?: AbortSignal) => AsyncIterable<unknown>;
        }>;
  }
}
