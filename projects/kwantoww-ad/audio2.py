"""Музыка и звуковые эффекты ролика Kwantoww: синтез numpy, 25 с, 44,1 кГц, стерео.
Темп 120 BPM (доля 0,5 с). Тайминги эффектов совпадают с таймлайном ad2.html.
Запуск: python3 audio.py out.wav"""
import sys, wave
import numpy as np

SR = 44100
DUR = 25.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)
BEAT = 0.5

def t_arr(d): return np.arange(int(SR * d)) / SR
def env_adsr(n, a=0.005, d=0.1, s=0.0, r=0.05, sus=None):
    t = np.arange(n) / SR
    e = np.ones(n) * s
    na = max(1, int(a * SR)); nd = max(1, int(d * SR))
    e[:na] = np.linspace(0, 1, na)
    e[na:na + nd] = np.linspace(1, s, min(nd, n - na)) if n > na else e[na:na + nd]
    if sus is not None:
        nr = int(r * SR); ss = int(sus * SR)
        if ss < n: e[ss:ss + nr] = np.linspace(e[ss - 1] if ss > 0 else s, 0, min(nr, n - ss)); e[ss + nr:] = 0
    return e
def fftconv(x, k):
    n = len(x) + len(k) - 1; m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(k, m), m)[:len(x)]
def lowpass(x, fc, taps=511):
    m = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * fc / SR * m) * np.hamming(taps); h /= h.sum()
    return fftconv(x, h)
def highpass(x, fc, taps=511): return x - lowpass(x, fc, taps)
def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[: N - i]
    gl = gain * np.cos((pan + 1) * np.pi / 4); gr = gain * np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gl; R[i:i + len(sig)] += sig * gr
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

# ---------- инструменты ----------
def kick():
    t = t_arr(0.45); f = 48 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7.5) * 1.0 + np.sin(ph * 2) * np.exp(-t * 30) * 0.2
def hat(open_=False):
    t = t_arr(0.18 if open_ else 0.06); n = rng.standard_normal(len(t))
    return highpass(n, 7000, 255) * np.exp(-t * (18 if open_ else 70))
def clap():
    t = t_arr(0.25); n = rng.standard_normal(len(t))
    e = np.exp(-t * 22) + 0.6 * np.exp(-((t - 0.012) % 0.011) * 300) * (t < 0.035)
    return lowpass(highpass(n, 900, 255), 6000, 255) * e * 0.8
def pluck(freq, d=0.32):
    t = t_arr(d)
    x = (np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 2 * t) + 0.25 * np.sign(np.sin(2 * np.pi * freq * t)) * 0.4)
    return x * np.exp(-t * 11) * np.minimum(1, t / 0.003)
def bass(freq, d=0.45):
    t = t_arr(d)
    x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
    e = np.minimum(1, t / 0.01) * np.exp(-t * 3.5)
    return np.tanh(x * 1.6) * e
def pad(freqs, d):
    t = t_arr(d); x = np.zeros(len(t))
    for f in freqs:
        for det in (-0.12, 0.0, 0.13):
            ff = f * 2 ** (det / 12)
            x += 2 * ((ff * t + rng.random()) % 1.0) - 1  # пила
    x = lowpass(x / (len(freqs) * 3), 1600)
    e = np.minimum(1, t / 0.25) * np.minimum(1, (d - t) / 0.25)
    return x * e
def bell(freq, d=1.2):
    t = t_arr(d)
    return (np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 6)) * np.exp(-t * 3.2)

# ---------- музыка ----------
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
ROOTS = [45, 41, 36, 43]
def in_break(t): return 7.0 <= t < 8.0

# пэд с начала
for bar in range(13):
    t0 = bar * 2.0
    if t0 >= DUR: break
    ch = CHORDS[bar % 4]
    g = 0.16 if t0 < 2.5 else (0.10 if not in_break(t0) else 0.2)
    if t0 >= 22: g = 0.2
    add(pad([midi(n) for n in ch], 2.05), t0, g, -0.2); add(pad([midi(n + 12) for n in ch], 2.05), t0, g * 0.5, 0.25)

# разгон к входу в Telegram
t = t_arr(1.0); n = rng.standard_normal(len(t))
riser = lowpass(highpass(n, 1800, 255), 7000, 255) * (t / 1.0) ** 2.2 * 0.16  # мягкий разгон, без резкого шипения
add(riser, 1.5, 1.0)

# бочка, хэт, клэп, бас, плак
for i in range(int(DUR / BEAT)):
    tb = i * BEAT
    bar = int(tb // 2) % 4
    groove = 2.5 <= tb < 22.0 and not in_break(tb)
    if groove:
        add(kick(), tb, 0.72)
        if tb >= 4.5:
            add(hat(), tb + BEAT / 2, 0.16, 0.3)
            add(hat(), tb + BEAT / 4, 0.05, -0.3)
        if (i % 2 == 1) and tb >= 4.5: add(clap(), tb, 0.28, 0.05)
        add(bass(midi(ROOTS[bar])), tb + BEAT / 2, 0.32)
    if tb >= 2.5 and tb < 22.0:
        ch = CHORDS[bar]
        arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12]
        for k in range(2):
            add(pluck(midi(arp[(i * 2 + k) % 4])), tb + k * BEAT / 2, 0.10 if not in_break(tb) else 0.06, 0.35 if k else -0.35)
# брейк: колокольчики
for k, nn in enumerate([76, 79, 84, 79]):
    add(bell(midi(nn)), 7.1 + k * 0.22, 0.08, 0.2 * (-1) ** k)
# финал: удар и аккорд
add(kick(), 22.0, 1.0); add(clap(), 22.0, 0.4)
t = t_arr(1.2); add(lowpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 3) * 0.5, 22.0, 0.5)
for k, nn in enumerate([69, 72, 76, 81]):
    add(bell(midi(nn), 2.5), 22.15 + k * 0.12, 0.08, 0.3 * (k % 2 * 2 - 1))

# ---------- звуковые эффекты ----------
def click():
    t = t_arr(0.04); return (rng.standard_normal(len(t)) * np.exp(-t * 180) + np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 120)) * 0.6
def keytap():
    t = t_arr(0.03); return highpass(rng.standard_normal(len(t)), 2000, 63) * np.exp(-t * 220)
def whoosh(d=0.35, up=True):
    t = t_arr(d); n = rng.standard_normal(len(t))
    e = np.sin(np.pi * t / d) ** 2
    return lowpass(highpass(n, 600, 255), 5000, 255) * e * 0.5
def pop(f=880):
    t = t_arr(0.14); fr = f * (1 + 0.6 * np.exp(-t * 40))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 26)
def ding():
    return bell(midi(88), 1.0) * 0.8 + np.concatenate([np.zeros(int(0.13 * SR)), bell(midi(93), 0.87)]) * 0.7
def chime():
    out = np.zeros(int(SR * 0.9))
    for k, nn in enumerate([84, 88, 91]):
        b = bell(midi(nn), 0.6); i = int(k * 0.07 * SR); out[i:i + len(b)] += b[: len(out) - i]
    return out * 0.6
def thud():
    t = t_arr(0.25); f = 90 + 80 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16)
def buzz(d=0.45):
    t = t_arr(d); return np.sign(np.sin(2 * np.pi * 150 * t)) * 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * 22 * t)) * np.exp(-t * 2)
def tick():
    t = t_arr(0.02); return np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 300)

# хук: три слова падают, затем уходят
for i in range(3): add(thud(), 0.12 + i * 0.28 + 0.2, 0.5, (i - 1) * 0.3)
add(whoosh(0.6), 1.9, 0.5)
# наезд на ответ бота и возврат
add(whoosh(0.5), 3.3, 0.22, -0.3); add(whoosh(0.4), 4.9, 0.2, 0.3)
# нажатия пальцем
for tt in (6.45, 8.82, 10.98, 12.9, 13.55, 14.6, 15.9, 16.8, 18.6, 20.0): add(click(), tt, 0.38, 0.1)
# шторка мини-приложения
add(whoosh(0.45), 7.05, 0.4); add(pop(900), 7.55, 0.2)
# печать «Купить продукты»
for k in range(15): add(keytap(), 9.22 + k * 0.09, 0.22, 0.2)
# сохранено: задача, вода, привычка
add(chime(), 11.05, 0.35); add(pop(1200), 13.6, 0.3); add(chime(), 15.97, 0.35)
# прокрутки
for tt, d in ((11.9, 0.7), (15.1, 0.55), (20.55, 0.5)): add(whoosh(d), tt, 0.15, -0.2)
# смена вкладок
for tt in (14.66, 16.86, 18.66, 20.06): add(whoosh(0.2), tt, 0.15, 0.3)
# финал
add(whoosh(0.7), 21.8, 0.4)
add(pop(1100), 23.0, 0.3)

# ---------- сведение ----------
def soft(x): return np.tanh(x * 1.1) / np.tanh(1.1)
mix = np.stack([L, R])
mix = soft(mix)
mix /= np.max(np.abs(mix)) / 0.89  # пик ≈ −1 дБFS
fade = np.ones(N); fl = int(0.6 * SR); fade[-fl:] = np.linspace(1, 0, fl); fade[:200] = np.linspace(0, 1, 200)
mix *= fade
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "audio.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
rms = np.sqrt(np.mean(mix ** 2))
print(f"audio ok: {DUR}s, peak {np.max(np.abs(mix)):.2f}, rms {20*np.log10(rms):.1f} dBFS")
