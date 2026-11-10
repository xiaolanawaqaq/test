#!/usr/bin/env python3
"""微尘 procedural audio generator.

Every sound is synthesized from scratch with the Python standard library:
no third-party samples, no AI-generated audio, no downloaded assets.

Loop seamlessness trick: every partial's frequency (and every LFO rate) is
quantized to an integer number of cycles over the exact loop length, so the
waveform at the loop point is continuous and the seam is inaudible. The noise
bed is low-passed in two passes around the loop so the filter state carries
across the seam, and shimmer bells are added with circular wraparound.

Output: 16-bit mono PCM WAV @ 22050 Hz (small and GL/Android friendly).
"""

import math
import random
import wave
from array import array
from pathlib import Path

SR = 22050
TAU = 2.0 * math.pi
OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "audio"


def quantize(freq: float, loop_seconds: float) -> float:
    """Round a frequency so it completes an integer number of cycles."""
    cycles = max(1, round(freq * loop_seconds))
    return cycles / loop_seconds


def add_sine(buf, freq, gain, loop_seconds, lfo_cycles=0, lfo_phase=0.0, depth=0.0):
    n = len(buf)
    f = quantize(freq, loop_seconds)
    lfo_f = lfo_cycles / loop_seconds if lfo_cycles > 0 else 0.0
    for i in range(n):
        t = i / SR
        a = gain
        if lfo_cycles > 0:
            a *= (1.0 - depth) + depth * (0.5 + 0.5 * math.sin(TAU * lfo_f * t + lfo_phase))
        buf[i] += a * math.sin(TAU * f * t)


def add_noise_bed(buf, gain, coeff, loop_seconds):
    """Low-passed white noise; two passes around the loop for a seamless seam."""
    n = len(buf)
    rng = random.Random(0xA11CE)
    white = [rng.uniform(-1.0, 1.0) for _ in range(n)]
    out = [0.0] * n
    y = 0.0
    for _pass in range(2):
        for i in range(n):
            y += coeff * (white[i] - y)
            out[i] = y
    cycles = max(1, round(1.0 * loop_seconds))  # one slow breath per loop, quantized
    lfo_f = cycles / loop_seconds
    for i in range(n):
        t = i / SR
        a = gain * (0.6 + 0.4 * math.sin(TAU * lfo_f * t))
        buf[i] += a * out[i]


def add_bell(buf, start, freq, gain, tau, wrap=True, partials=None):
    """Soft bell: a few inharmonic partials, exponential decay, 5 ms attack."""
    if partials is None:
        partials = ((1.0, 1.0, 1.0), (2.0, 0.35, 0.55), (2.76, 0.2, 0.35), (5.4, 0.08, 0.2))
    total = len(buf)
    dur = int(min(tau * 6.0, 5.0) * SR)
    for j in range(dur):
        idx = start + j
        if wrap:
            idx %= total
        elif idx >= total:
            break
        t = j / SR
        s = 0.0
        for mult, g, dscale in partials:
            s += g * math.sin(TAU * freq * mult * t) * math.exp(-t / (tau * dscale))
        atk = min(1.0, j / (0.005 * SR))
        buf[idx] += gain * atk * s


def fade_edges(buf, attack, release):
    n = len(buf)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    for i in range(min(a, n)):
        buf[i] *= i / a
    for i in range(min(r, n)):
        buf[n - 1 - i] *= i / r


def normalize(buf, peak):
    m = 0.0
    for v in buf:
        av = abs(v)
        if av > m:
            m = av
    if m <= 0.0:
        return
    k = peak / m
    for i in range(len(buf)):
        buf[i] *= k


def write_wav(path, buf):
    data = array("h")
    for v in buf:
        s = int(round(v * 32767.0))
        if s > 32767:
            s = 32767
        elif s < -32767:
            s = -32767
        data.append(s)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print("wrote %s (%.1f s, %.2f MB)" % (path.name, len(buf) / SR, len(data) * 2 / 1e6))


LOOP_SECONDS = 64.0  # 4 bars × 16 s, one chord per bar

# A minor progression: Am – F – C – G. Both music layers use these exact chord
# windows, so any crossfade between them stays consonant.
CHORDS = (
	{  # Am
		"start": 0.0,
		"bass": 55.0,
		"pad": (110.0, 164.81, 220.0, 261.63, 329.63),
		"arp": (440.0, 523.25, 659.25, 880.0),
		"melody": (659.25, 440.0, 523.25),
	},
	{  # F
		"start": 16.0,
		"bass": 43.65,
		"pad": (87.31, 130.81, 174.61, 220.0, 261.63),
		"arp": (349.23, 440.0, 523.25, 698.46),
		"melody": (440.0, 698.46, 523.25),
	},
	{  # C
		"start": 32.0,
		"bass": 65.41,
		"pad": (130.81, 196.0, 261.63, 329.63, 392.0),
		"arp": (523.25, 659.25, 783.99, 1046.5),
		"melody": (392.0, 659.25, 523.25),
	},
	{  # G
		"start": 48.0,
		"bass": 49.0,
		"pad": (98.0, 146.83, 196.0, 246.94, 293.66),
		"arp": (392.0, 493.88, 587.33, 783.99),
		"melody": (587.33, 493.88, 392.0),
	},
)


def add_pad_note(buf, start_s, dur_s, freq, gain, attack=2.0, release=2.5,
                 lfo_cycles=0, depth=0.0):
    """Sustained note with circular envelope; release ring-out wraps the loop."""
    n = len(buf)
    f = quantize(freq, LOOP_SECONDS)
    f2 = quantize(freq * 2.0, LOOP_SECONDS)
    lfo_f = lfo_cycles / LOOP_SECONDS if lfo_cycles > 0 else 0.0
    start_i = int(round(start_s * SR))
    dur_i = int(round(dur_s * SR))
    atk_i = max(1, int(round(attack * SR)))
    rel_i = max(1, int(round(release * SR)))
    for j in range(dur_i + rel_i):
        if j < dur_i:
            env = 0.5 - 0.5 * math.cos(math.pi * min(1.0, j / atk_i))
        else:
            x = max(0.0, 1.0 - (j - dur_i) / rel_i)
            env = x * x * (3.0 - 2.0 * x)  # smoothstep release
        if env <= 0.0:
            continue
        idx = (start_i + j) % n
        tt = idx / SR
        a = gain * env
        if lfo_cycles > 0:
            a *= (1.0 - depth) + depth * (0.5 + 0.5 * math.sin(TAU * lfo_f * tt))
        buf[idx] += a * (math.sin(TAU * f * tt) + 0.22 * math.sin(TAU * f2 * tt))


def add_pluck(buf, start_i, freq, gain, tau=0.35):
    """Short plucked tone for the arpeggio layer; wraps around the loop."""
    n = len(buf)
    f = quantize(freq, LOOP_SECONDS)
    f3 = quantize(freq * 3.0, LOOP_SECONDS)
    dur = int(min(tau * 5.0, 2.5) * SR)
    for j in range(dur):
        idx = (start_i + j) % n
        tt = idx / SR
        t = j / SR
        env = min(1.0, t / 0.004) * math.exp(-t / tau)
        buf[idx] += gain * env * (math.sin(TAU * f * tt) + 0.18 * math.sin(TAU * f3 * tt))


def build_base():
    """Sparse ambient: occasional soft notes with LONG silences between them.

    Redesign after playtest feedback ("一直响，难听"): the old version kept a
    saturated pad + noise bed running at constant RMS the whole loop —
    wall-of-sound with nowhere to breathe. This one inverts it: most of the
    loop is silence, punctuated by two or three soft decaying notes per bar.
    """
    n = int(LOOP_SECONDS * SR)
    buf = [0.0] * n
    for chord in CHORDS:
        start = chord["start"]
        # One soft bass swell per bar (root), the rest of the bar is silence.
        add_pad_note(buf, start, 4.0, chord["bass"], 0.16, attack=3.0, release=3.0)
        # One bell melody note, off the beat, decaying into silence.
        add_bell(buf, int((start + 10.5) * SR), chord["melody"][0], 0.10, 2.6)
    normalize(buf, 0.38)
    return buf


def build_alive():
    """Sparse bright layer for phenomena: gentle pluck motif + one bell, airy.

    Same leave-silence-alone philosophy: a short pluck figure twice per bar
    and one high bell; the rest is quiet so blooms are clearly heard.
    """
    n = int(LOOP_SECONDS * SR)
    buf = [0.0] * n
    for chord in CHORDS:
        start = chord["start"]
        # Pluck motif: three notes around the 1 s mark, echoed softer at 9 s.
        for k, note in enumerate(chord["arp"][:3]):
            add_pluck(buf, int((start + 1.0 + k * 0.75) * SR), note,
                      0.16 - k * 0.03, tau=0.5)
            add_pluck(buf, int((start + 9.0 + k * 0.75) * SR), note,
                      0.09 - k * 0.02, tau=0.5)
        # One high bell per bar.
        add_bell(buf, int((start + 5.5) * SR), chord["arp"][2] * 2.0, 0.09, 2.2)
    normalize(buf, 0.34)
    return buf


def build_sfx_light():
    T = 1.5
    n = int(T * SR)
    buf = [0.0] * n
    add_bell(buf, 0, 523.25, 1.0, 0.75, wrap=False)
    add_bell(buf, int(0.07 * SR), 1046.5, 0.3, 0.4, wrap=False)
    fade_edges(buf, 0.006, 0.05)
    normalize(buf, 0.7)
    return buf


def build_sfx_poison():
    T = 1.25
    n = int(T * SR)
    buf = [0.0] * n
    rng = random.Random(0x90450)
    phase = 0.0
    phase2 = 0.0
    lp = 0.0
    for i in range(n):
        t = i / SR
        f = 55.0 + 70.0 * math.exp(-t * 2.0)
        phase += TAU * f / SR
        phase2 += TAU * f * 1.5 / SR
        env = min(1.0, t / 0.08) * math.exp(-t * 1.4)
        tone = 0.8 * math.sin(phase) + 0.35 * math.sin(phase2)
        coeff = 0.03 + 0.27 * math.exp(-t * 2.5)
        lp += coeff * (rng.uniform(-1.0, 1.0) - lp)
        buf[i] = env * (tone + 0.35 * lp)
    fade_edges(buf, 0.01, 0.15)
    normalize(buf, 0.7)
    return buf


def build_sfx_phenomenon():
    T = 1.7
    n = int(T * SR)
    buf = [0.0] * n
    add_bell(buf, 0, 440.0, 0.55, 0.7, wrap=False)
    add_bell(buf, int(0.16 * SR), 554.37, 0.5, 0.7, wrap=False)
    add_bell(buf, int(0.32 * SR), 659.25, 0.45, 0.9, wrap=False)
    rng = random.Random(0x5EED)
    y = 0.0
    for i in range(n):
        t = i / SR
        x = rng.uniform(-1.0, 1.0)
        y += 0.25 * (x - y)
        hp = x - y
        env = math.exp(-t * 2.2) * min(1.0, max(0.0, (t - 0.1) / 0.1))
        buf[i] += 0.06 * hp * env
    fade_edges(buf, 0.004, 0.08)
    normalize(buf, 0.66)
    return buf


def build_sfx_click():
    """Light, crisp UI click: high partials with sub-15 ms decay + micro transient."""
    T = 0.09
    n = int(T * SR)
    buf = [0.0] * n
    rng = random.Random(0xC11C)
    for f, g, tau in ((2400.0, 1.0, 0.010), (4800.0, 0.4, 0.006), (1200.0, 0.5, 0.014)):
        for i in range(n):
            t = i / SR
            atk = min(1.0, i / (0.0008 * SR))
            buf[i] += g * math.sin(TAU * f * t) * math.exp(-t / tau) * atk
    lp = 0.0
    for i in range(n):
        t = i / SR
        x = rng.uniform(-1.0, 1.0)
        lp += 0.5 * (x - lp)
        buf[i] += 0.5 * (x - lp) * math.exp(-t / 0.003)
    fade_edges(buf, 0.0005, 0.012)
    normalize(buf, 0.6)
    return buf


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_wav(OUT_DIR / "ambient_base.wav", build_base())
    write_wav(OUT_DIR / "ambient_alive.wav", build_alive())
    write_wav(OUT_DIR / "sfx_light.wav", build_sfx_light())
    write_wav(OUT_DIR / "sfx_poison.wav", build_sfx_poison())
    write_wav(OUT_DIR / "sfx_phenomenon.wav", build_sfx_phenomenon())
    write_wav(OUT_DIR / "sfx_click.wav", build_sfx_click())
    print("done:", OUT_DIR)


if __name__ == "__main__":
    main()
