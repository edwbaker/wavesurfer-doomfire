# Changelog

## Unreleased

- A script-tag build, `dist/doomfire.min.js`, for pages without a bundler.
  Loaded after wavesurfer.js's own script, it takes the page's `WaveSurfer` and
  attaches itself to it as `WaveSurfer.DoomFire`, with the palette and
  `stepFire` as `WaveSurfer.DoomFire.DOOM_FIRE_PALETTE` and
  `WaveSurfer.DoomFire.stepFire`. With CommonJS or AMD it requires
  `wavesurfer.js`. It is the package's `./umd` export, and the file unpkg and
  jsDelivr serve for the package. The README shows how to load it from the
  audioBLAST! CDN.
- The demo runs on wavesurfer.js 8.0.3, loaded from cdn.audioblast.org, and its
  script is readable code rather than minified.
- Browser tests run the plugin in a real wavesurfer.js on every push and pull
  request, along with a type check and a check that `dist/` matches the source.

## 0.1.1 (2026-10-23)

- The README says how a release is made. The plugin itself is as in 0.1.0.
  This is the first version published from GitHub Actions, with provenance.

## 0.1.0 (2026-10-23)

- First version: the DoomFire plugin for wavesurfer.js 8, which runs the
  PlayStation DOOM fire over a waveform, lit by the audio.
  - The drawn bars are the fuel, following `barHeight`, `barAlign`,
    `normalize` and `splitChannels`; `base: 'bottom'` burns the original's row
    of fuel along the floor instead.
  - The fire is lit by the waveform, by playback as a fuse that burns down to
    embers (`source: 'progress'`), by the spectrum, or by a function of time
    and column.
  - Playback stokes it, and loud hits throw sparks off the playhead.
  - It burns behind the waveform by default, or screen-blended in front of it,
    in 4 px cells by default.
  - `ignite()`, `extinguish()` and the `burnout` event; `getCanvas()` and
    `getIntensities()`; the package also exports `DOOM_FIRE_PALETTE` and
    `stepFire`.
