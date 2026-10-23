# DoomFire for wavesurfer.js

A [wavesurfer.js](https://wavesurfer.xyz) 8 plugin that runs the PlayStation DOOM fire over your waveform, lit by the audio. The drawn bars are the fuel: every bar burns as hot as it is loud and the flames climb off its top. Press play and the music stokes it, blazing and throwing sparks at the playhead.

[Try the demo](https://ebaker.me.uk/wavesurfer-doomfire/), which has every option (the same page as `index.html`).

## Install

```sh
npm install wavesurfer-doomfire wavesurfer.js
```

It needs wavesurfer.js 8, where plugins are built with `WaveSurfer.definePlugin`. Without a bundler, copy `dist/doomfire.esm.js` next to your code and map `wavesurfer.js` to its ES module build with an import map.

## Use

```js
import WaveSurfer from 'wavesurfer.js'
import DoomFirePlugin from 'wavesurfer-doomfire'

const ws = WaveSurfer.create({
  container: '#waveform',
  url: '/audio/recording.mp3',
  barHeight: 0.6,    // leaves the flames room above the loudest bars
  sampleRate: 22050, // the spectrum source only sees up to half this
})

// the playhead is a fuse: bars catch as they play, then burn down to embers
const fire = ws.registerPlugin(DoomFirePlugin.create({ source: 'progress', burnTime: 2.5 }))

ws.on('finish', () => fire.extinguish()) // the fuel goes cold, the flames die away
ws.on('play', () => fire.ignite())
fire.on('burnout', () => console.log('the fire is out'))
fire.setOptions({ wind: 'none', palette: ['#000', '#123', '#39f', '#cff'] })
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `source` | `'waveform'` | `'waveform'`, `'progress'`, `'spectrum'`, or `(time, column) => 0…1` to light columns yourself, from regions or annotations for example. |
| `base` | `'waveform'` | `'waveform'`: the drawn bars are the fuel (follows `barHeight`, `barAlign`, `normalize` and `splitChannels`). `'bottom'`: the original's row of fuel along the floor. |
| `stoke` | `1` | How hard playback stokes the fire. 0 keeps a steady full blaze whether or not it plays, though sparks still fly unless `sparks` is 0; 2 is wilder. |
| `sparks` | `1` | How many sparks loud hits throw off the playhead. 0 turns them off. |
| `burnTime`, `embers` | `2.5`, `0.3` | Progress: seconds of audio a played stretch takes to burn down, and the share of its heat the embers keep. A `burnTime` of 0 keeps it blazing. |
| `wind` | `'left'` | `'left'` is the original. `'none'` keeps flames above the sound that lit them. |
| `pixelSize` | height / 32 | Cell size in CSS pixels. |
| `fps` | `30` | Fire steps per second. The original demo ran at 20. |
| `scale` | `'db'` | Loudness to heat: `'db'` or `'linear'`. |
| `dbRange` | `48` / `72` | Decibels below the loudest point that still give heat (loudness / spectrum). |
| `normalize` | `true` | Measure against the loudest point in the file. |
| `gain` | `1` | Heat multiplier. |
| `layer` | `'front'` | `'front'` (screen-blended over the waveform) or `'back'`. |
| `blendMode`, `opacity` | `'screen'`, `1` | CSS blending of the fire layer. |
| `palette` | fire.js | Colours from cold to hot, CSS strings or `[r, g, b]`, stretched over 37 steps. |
| `debug` | `false` | Print each cell's heat. Use a `pixelSize` of 14 or more. |
| `burning` | `true` | Start lit. |
| `fftSize`, `maxFrequency` | `2048`, Nyquist | Spectrum source settings. |

Methods: `ignite()`, `extinguish()`, `isBurning()`, `setOptions()`, `getCanvas()`, `getIntensities()`. Events: `ignite`, `extinguish`, `burnout`. The layer is a `::part(doomfire)` you can style. The package also exports `DOOM_FIRE_PALETTE` and `stepFire`, one step of the fire on a grid of your own.

## Develop

```sh
npm install
npm run build
```

`npm run build` type-checks `src/doomfire.ts`, writes `dist/doomfire.esm.js` and `dist/doomfire.d.ts`, and copies the built plugin into the demo's source panel, which is the code `index.html` runs.

## Credits

The fire algorithm and palette are from [doom-fire-algorithm](https://github.com/filipedeschamps/doom-fire-algorithm) by Filipe Deschamps (MIT), after [How DOOM fire was done](https://fabiensanglard.net/doom_fire_psx/) by Fabien Sanglard. MIT licence; see `LICENSE`.
