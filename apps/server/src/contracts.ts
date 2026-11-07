import type { Campaign, Stage, Turn } from '../../../packages/shared/src/index.js';
export interface SttEvent { text: string; language?: string; endOfSpeechAt?: number; finalAt: number }
export interface SttClient { connect(): Promise<void>; sendAudio(pcm8k: Buffer): void; close(): void; onTurn: (event: SttEvent) => void; onActivity: () => void; onError: (error: Error) => void }
export interface TtsClient { name: string; synthesize(text: string, language: string, voice: string, signal: AbortSignal): AsyncIterable<Buffer> }
export interface ToolCall { name: string; args: Record<string, unknown> }
export interface DialogueReply { text: string; tools: ToolCall[]; tokens: number }
export interface DialogueClient { name: string; reply(campaign: Campaign, history: Turn[], stage: Stage, fields: Record<string, unknown>, signal: AbortSignal, onFirstToken: () => void): Promise<DialogueReply> }
export interface TelephonyProvider { dial(to: string, callId: string): Promise<string>; hangup(sid: string): Promise<void> }
export interface Transport { audio(frame: Buffer): void; clear(): void; mark(name: string): Promise<void>; end(): Promise<void> }
