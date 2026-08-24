export interface TwilioStartEvent {
  event: 'start';
  streamSid: string;
  start: {
    callSid: string;
    streamSid: string;
    mediaFormat: { encoding: string; sampleRate: number; channels: number };
  };
}

export interface TwilioMediaEvent {
  event: 'media';
  streamSid: string;
  media: { payload: string; track?: string; timestamp?: string };
}

export interface TwilioConnectedEvent {
  event: 'connected';
  protocol: string;
  version: string;
}

export interface TwilioStopEvent {
  event: 'stop';
  streamSid: string;
}

export interface TwilioMarkEvent {
  event: 'mark';
  streamSid: string;
  mark: { name: string };
}

export type TwilioStreamEvent =
  | TwilioConnectedEvent
  | TwilioStartEvent
  | TwilioMediaEvent
  | TwilioStopEvent
  | TwilioMarkEvent;

export function parseTwilioEvent(raw: string): TwilioStreamEvent | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.event === 'string') return parsed as TwilioStreamEvent;
    return undefined;
  } catch {
    return undefined;
  }
}

export function outboundMediaMessage(streamSid: string, base64Payload: string) {
  return JSON.stringify({ event: 'media', streamSid, media: { payload: base64Payload } });
}

export function outboundClearMessage(streamSid: string) {
  return JSON.stringify({ event: 'clear', streamSid });
}

export function outboundMarkMessage(streamSid: string, name: string) {
  return JSON.stringify({ event: 'mark', streamSid, mark: { name } });
}
