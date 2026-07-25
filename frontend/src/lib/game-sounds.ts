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

/** Short burst of filtered noise, shaped with a fast decay -- an impact. */
function noiseBurst(
  ctx: AudioContext,
  startTime: number,
  duration: number,
  peakGain: number,
  filterFreq: number,
) {
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, startTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(startTime);
  noise.stop(startTime + duration + 0.02);
}

/** Crash/impact -- one token sent another home. */
export function playCrash() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;

  // Low thud underneath the noise for weight/impact.
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
  oscGain.gain.setValueAtTime(0.35, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.32);

  noiseBurst(ctx, t0, 0.28, 0.35, 1400);
}

/** Bright "cha-ching" bell + jingle -- buying a property or winning an auction. */
export function playCashRegister() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  tone(ctx, 1318.51, t0, 0.12, 'square', 0.18); // E6
  tone(ctx, 1567.98, t0 + 0.08, 0.16, 'square', 0.18); // G6
  noiseBurst(ctx, t0 + 0.05, 0.2, 0.12, 6000);
}

/** Short bright metallic clink -- rent, tax, or any smaller cash change. */
export function playCoin() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  tone(ctx, 1760, t0, 0.1, 'triangle', 0.18); // A6
  tone(ctx, 2093, t0 + 0.02, 0.12, 'triangle', 0.12); // C7
}

/** Metallic clang with a low thud -- sent to jail, or stuck there another turn. */
export function playJailClang() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.15);
  gain.gain.setValueAtTime(0.3, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.22);
  noiseBurst(ctx, t0, 0.15, 0.25, 900);
}

/** Sharp wooden knock -- an auction opening or a bid being placed. */
export function playGavel() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  noiseBurst(ctx, t0, 0.08, 0.4, 500);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(200, t0);
  gain.gain.setValueAtTime(0.3, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.12);
}

/** Comedic descending "wah wah wah" -- going bankrupt. */
export function playBankruptSting() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const notes = [392, 349.23, 293.66, 261.63]; // G4 F4 D4 C4
  notes.forEach((freq, i) => tone(ctx, freq, t0 + i * 0.22, 0.3, 'sawtooth', 0.22));
}

/** Quick papery tick -- a Fortune Chest/Wildcard card being drawn. */
export function playCardFlip() {
  const ctx = getContext();
  if (!ctx) return;
  noiseBurst(ctx, ctx.currentTime, 0.08, 0.18, 3500);
}

/** Quick knock with a low thump -- a house being built. */
export function playHammerTap() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  noiseBurst(ctx, t0, 0.06, 0.3, 800);
  tone(ctx, 150, t0, 0.08, 'square', 0.2);
}

/** Bigger, longer fanfare -- for the actual game-winning moment, distinct
 * from the quick playHooray() used for smaller good-news events. */
export function playVictoryFanfare() {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;

  const run = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 D5 E5 G5 A5 C6
  run.forEach((freq, i) => tone(ctx, freq, t0 + i * 0.09, 0.16, 'triangle', 0.2));

  const chordStart = t0 + run.length * 0.09 + 0.05;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq) =>
    tone(ctx, freq, chordStart, 0.6, 'sawtooth', 0.16),
  );
}
