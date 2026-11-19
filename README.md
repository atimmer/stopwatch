# Stopwatch

A plain stopwatch modelled on the iPhone one, at **https://stopwatch.24letters.com**.
Plain HTML, CSS and JS; no build step. Hosted on GitHub Pages (`CNAME` holds the domain;
DNS for `24letters.com` lives in Vercel: `stopwatch CNAME atimmer.github.io`).
HTTPS is enforced; the microphone only works over HTTPS. If GitHub ever stalls on issuing the
certificate (`https_certificate: null`), remove the custom domain, wait ~2 minutes, then add it again.

## Features

- Start/Stop, Lap/Reset, lap list with the fastest lap in green and the slowest in red.
- State survives a reload (localStorage); the screen stays on while timing (Wake Lock).
- Keyboard: Space = start/stop, L or R = lap/reset, V = arm/cancel voice start.
- **Start when speaker detected** (for Toastmasters): arms the microphone and starts the timer
  as soon as someone starts talking, backdated to the first spoken syllable.

## How speaker detection works (`app.js`)

1. The mic signal (noise suppression on, auto-gain off) is band-passed to 120–4000 Hz.
2. The first 0.7 s measures the room's noise floor; afterwards the floor slowly follows the room.
3. Every 20 ms a frame is **loud** when it is a margin above the floor (Sensitivity slider:
   30 dB at low, 6 dB at high) and **voice** when it is also harmonic: spectral flatness over
   150–3000 Hz below 0.3. Applause, rustling and coughs are loud but flat, so they don't count.
4. The timer starts when, in the last 350 ms, ≥70% of frames were loud and ≥50% were voice.
   The start time is set to the first voice frame in that window. The mic is released right away.

The meter shows the level (grey = quiet, amber = loud but not voice, green = voice) and the
white tick is the trigger threshold.

Tested in headless Chrome with a fake microphone fed by TTS speech, room noise and synthetic
applause: speech triggers, applause and noise alone don't.
