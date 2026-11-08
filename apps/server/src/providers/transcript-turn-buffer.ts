import type { SttEvent } from '../contracts.js';

/** Keep quick final fragments from moving the interview onto another field mid-answer. */
export class TranscriptTurnBuffer {
  private pending?: SttEvent;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private emit: (event: SttEvent) => void) {}
  activity() {
    // A speaker resumed before the buffered answer was emitted. Wait for the
    // next final rather than replying over their continuation.
    clearTimeout(this.timer);
  }
  push(event: SttEvent) {
    clearTimeout(this.timer);
    const previous = this.pending?.text;
    this.pending = {...event, text: previous && !event.text.startsWith(previous)
      ? `${previous} ${event.text}` : event.text};
    const text = this.pending.text.trim();
    const unfinished = /\b(?:and|or|but|from|at|with|for|to|of|a|an|the|i|like|where)[.!?\s]*$/i.test(text);
    this.timer = setTimeout(() => {
      const turn = this.pending;
      this.pending = undefined;
      if (turn) this.emit(turn);
    }, unfinished ? 1200 : 150);
  }
  close() {
    clearTimeout(this.timer);
    this.pending = undefined;
  }
}
