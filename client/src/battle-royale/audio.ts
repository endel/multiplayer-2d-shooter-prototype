// Create audio context (resume on user gesture!)
const AudioContext = window.AudioContext;
let ctx: AudioContext;

function initAudio() {
    if (!ctx) {
        ctx = new AudioContext();
    }
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
}

document.addEventListener('pointerdown', initAudio, { once: true });

export function playGunshot(power = 1, type = 'pistol') {
    initAudio();

    const now = ctx.currentTime;

    // Random variations for pistol type
    const isPistol = type === 'pistol';
    const kickFreqStart = isPistol ? 140 + Math.random() * 20 : 150; // 140-160 Hz
    const kickFreqEnd = isPistol ? 18 + Math.random() * 4 : 20; // 18-22 Hz
    const kickGainStart = isPistol ? (0.75 + Math.random() * 0.1) * power : 0.8 * power; // 0.75-0.85
    const noiseFilterFreq = isPistol ? 1100 + Math.random() * 200 : (type === 'laser' ? 1000 : 1200); // 1100-1300 Hz
    const noiseGainStart = isPistol ? (0.55 + Math.random() * 0.1) * power : 0.6 * power; // 0.55-0.65

    // Kick (impact)
    const kick = ctx.createOscillator();
    kick.type = 'triangle';
    kick.frequency.setValueAtTime(kickFreqStart, now);
    kick.frequency.exponentialRampToValueAtTime(kickFreqEnd, now + 0.1);

    const kickGain = ctx.createGain();
    kickGain.gain.setValueAtTime(kickGainStart, now);
    kickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    // Noise burst
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = type === 'laser' ? 'highpass' : 'bandpass';
    noiseFilter.frequency.setValueAtTime(noiseFilterFreq, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(noiseGainStart, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    kick.connect(kickGain);
    noise.connect(noiseFilter).connect(noiseGain);
    kickGain.connect(ctx.destination);
    noiseGain.connect(ctx.destination);

    kick.start(now);
    noise.start(now);
    kick.stop(now + 0.15);
    noise.stop(now + 0.1);
}

export function playHit(power = 1) {
    initAudio();

    const now = ctx.currentTime;

    const hit = ctx.createOscillator();
    hit.type = 'triangle';
    hit.frequency.setValueAtTime(1000, now);
    hit.frequency.exponentialRampToValueAtTime(100, now + 0.1);

    const hitGain = ctx.createGain();
    hitGain.gain.setValueAtTime(power, now);
    hitGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    hit.connect(hitGain);
    hitGain.connect(ctx.destination);

    hit.start(now);
    hit.stop(now + 0.1);
}