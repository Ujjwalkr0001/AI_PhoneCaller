import { AudioLines, Check, Phone, Sparkles } from 'lucide-react';
export function Waveform({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`voice-wave ${compact ? 'compact' : ''}`} aria-hidden="true">
      {Array.from({ length: compact ? 29 : 57 }, (_, i) => (
        <span
          key={i}
          style={{
            height: `${12 + Math.abs(Math.sin(i * 0.64) * Math.cos(i * 0.19)) * 76}%`,
            animationDelay: `${i * -0.075}s`,
          }}
        />
      ))}
    </div>
  );
}
export default function VoiceVisual() {
  return (
    <div className="voice-visual">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <div className="voice-orb">
        <div className="orb-light" />
        <Waveform />
      </div>
      <div className="visual-chip chip-top">
        <span className="mint-icon">
          <Phone size={16} />
        </span>
        <div>
          <strong>A natural first hello</strong>
          <small>AI voice, a human touch</small>
        </div>
        <span className="visual-live" />
      </div>
      <div className="visual-chip chip-bottom">
        <span className="mint-icon">
          <Check size={16} />
        </span>
        <div>
          <strong>Every conversation, connected</strong>
          <small>Listen. Understand. Follow through.</small>
        </div>
      </div>
      <span className="orb-spark spark-one">
        <Sparkles size={21} />
      </span>
      <span className="orb-spark spark-two">
        <AudioLines size={22} />
      </span>
      <div className="visual-caption">
        <span /> BUILT FOR MEANINGFUL CONVERSATIONS
      </div>
    </div>
  );
}
