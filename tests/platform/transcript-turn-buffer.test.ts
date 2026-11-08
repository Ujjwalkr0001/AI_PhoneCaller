import {afterEach, expect, it, vi} from 'vitest';
import {TranscriptTurnBuffer} from '../../apps/server/src/providers/transcript-turn-buffer.js';

afterEach(()=>vi.useRealTimers());
it('joins resumed speech into the same answer rather than shifting it to the next field', async()=>{
  vi.useFakeTimers();
  const emit=vi.fn(), buffer=new TranscriptTurnBuffer(emit);
  buffer.push({text:'I want to work from.',finalAt:100});
  await vi.advanceTimersByTimeAsync(500);
  buffer.activity();
  await vi.advanceTimersByTimeAsync(1500);
  expect(emit).not.toHaveBeenCalled();
  buffer.push({text:'New York USA.',finalAt:2000});
  await vi.advanceTimersByTimeAsync(150);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith({text:'I want to work from. New York USA.',finalAt:2000});
  buffer.close();
});
it('emits a complete answer promptly and cancels pending speech on close', async()=>{
  vi.useFakeTimers();
  const emit=vi.fn(), buffer=new TranscriptTurnBuffer(emit);
  buffer.push({text:'Four years.',finalAt:100});
  await vi.advanceTimersByTimeAsync(150);
  expect(emit).toHaveBeenCalledTimes(1);
  buffer.push({text:'And.',finalAt:300});buffer.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(emit).toHaveBeenCalledTimes(1);
});
