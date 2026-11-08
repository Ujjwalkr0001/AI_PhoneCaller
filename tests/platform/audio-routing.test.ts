import { expect, it } from 'vitest';
import { MediaDiagnostics, pcmToMulaw } from '../../apps/server/src/audio.js';

it('rejects outbound input tracks and detects exact voice reflection without exposing audio', () => {
  const diagnostics = new MediaDiagnostics();
  const pcm = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) pcm.writeInt16LE(i % 2 ? 2000 : -2000, i * 2);
  const voice = pcmToMulaw(pcm);
  expect(diagnostics.inbound(voice, 'outbound')).toBe(false);
  expect(diagnostics.inbound(voice, 'inbound')).toBe(true);
  diagnostics.outbound(voice);
  diagnostics.inbound(Buffer.alloc(160, 255), 'inbound');
  diagnostics.outbound(Buffer.alloc(160, 255));
  expect(diagnostics.summary()).toEqual({
    inbound_frames: 2,
    outbound_frames: 2,
    ignored_track_frames: 1,
    exact_voice_loopback_frames: 1,
  });
});
