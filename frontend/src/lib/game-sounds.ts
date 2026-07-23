// Lightweight sound effects synthesized with the Web Audio API -- no
// audio files to fetch/host, just oscillators shaped with gain/frequency
// envelopes. A single shared AudioContext is created lazily (and resumed)
// on first use, since browsers require a user gesture before audio can
// play; by the time any of these fire, the player has already clicked
// something (join room, roll dice), so this resolves without issue.

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextCtor();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

function tone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain = 0.2,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/** Sad descending "aww" -- something unfortunate happened. */
export function playAhh() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(320, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.5);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.22, t0 + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.6);
}

/** Cheerful rising arpeggio -- a reward was given. */
export function playHooray() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) =>
    tone(ctx, freq, t0 + i * 0.09, 0.18, 'triangle', 0.22),
  );
}

/** Quick low descending swoop -- a token got swallowed by a snake. */
export function playSwallow() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(260, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.35);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.3, t0 + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.45);
}

/** Ascending stepped blips -- climbing a ladder. */
export function playStairs() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const steps = [392, 440, 494, 523.25, 587.33]; // G4 A4 B4 C5 D5
  steps.forEach((freq, i) => tone(ctx, freq, t0 + i * 0.07, 0.12, 'square', 0.15));
}
