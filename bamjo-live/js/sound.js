let audioContext = null;

document.addEventListener("pointerdown", unlockAudio, { passive: true });
document.addEventListener("keydown", unlockAudio, { passive: true });

function unlockAudio() {
  const context = getAudioContext();
  if (context?.state === "suspended") {
    context.resume().catch(() => {});
  }
}

function getAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  audioContext = new AudioContextClass();
  return audioContext;
}

export function playAngelicKickSound() {
  const context = getAudioContext();
  if (!context || context.state !== "running") {
    return;
  }

  const now = context.currentTime;
  const output = context.createGain();
  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
  output.connect(context.destination);

  const bell = context.createOscillator();
  const bellGain = context.createGain();
  bell.type = "sine";
  bell.frequency.setValueAtTime(740, now);
  bell.frequency.exponentialRampToValueAtTime(1320, now + 0.16);
  bellGain.gain.setValueAtTime(0.9, now);
  bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
  bell.connect(bellGain).connect(output);
  bell.start(now);
  bell.stop(now + 0.38);

  const shimmer = context.createOscillator();
  const shimmerGain = context.createGain();
  shimmer.type = "triangle";
  shimmer.frequency.setValueAtTime(1480, now + 0.025);
  shimmer.frequency.exponentialRampToValueAtTime(2240, now + 0.22);
  shimmerGain.gain.setValueAtTime(0.0001, now);
  shimmerGain.gain.exponentialRampToValueAtTime(0.34, now + 0.04);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
  shimmer.connect(shimmerGain).connect(output);
  shimmer.start(now + 0.02);
  shimmer.stop(now + 0.32);

  const impact = context.createOscillator();
  const impactGain = context.createGain();
  impact.type = "sine";
  impact.frequency.setValueAtTime(250, now);
  impact.frequency.exponentialRampToValueAtTime(110, now + 0.14);
  impactGain.gain.setValueAtTime(0.48, now);
  impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  impact.connect(impactGain).connect(output);
  impact.start(now);
  impact.stop(now + 0.20);
}
