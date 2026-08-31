export type AudioChunkHandler = (contextId: string, audioBase64: string) => void;
export type ContextDoneHandler = (contextId: string) => void;
export type CloseHandler = (code: number) => void;

/** Shape both CartesiaClient and SarvamTtsClient satisfy, so CascadedBridge
 * can drive either one identically (TTS_PROVIDER env var picks which). */
export interface TtsEngine {
  onAudioChunk(handler: AudioChunkHandler): void;
  onContextDone(handler: ContextDoneHandler): void;
  onClose(handler: CloseHandler): void;
  connect(): Promise<void>;
  speak(contextId: string, transcript: string, opts: { language: string; continue: boolean }): void;
  cancelContext(contextId: string): void;
  close(): void;
}
