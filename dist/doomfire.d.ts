import type { DefinedPlugin } from "wavesurfer.js";
export type DoomFireColor = string | readonly number[];
export type DoomFireSource = "waveform" | "progress" | "spectrum" | ((time: number, column: number) => number);
export type DoomFireWind = "left" | "right" | "none";
export type DoomFirePluginOptions = {
    /** What lights the fire: the waveform, the playhead's progress, the spectrum at the playhead, or a function of (time, column) returning 0..1. */
    source?: DoomFireSource;
    /** 'waveform': the drawn bars are the fuel. 'bottom': a row of fuel along the floor, as in the original. */
    base?: "waveform" | "bottom";
    /** Progress source: seconds of audio a played stretch takes to burn down. 0 keeps it blazing. */
    burnTime?: number;
    /** Progress source: the share of its heat a burnt-down stretch keeps. */
    embers?: number;
    /** How hard playback stokes the fire. 0 keeps a steady full blaze; 2 is wilder. */
    stoke?: number;
    /** How many sparks loud hits throw off the playhead. 0 turns them off. */
    sparks?: number;
    /** Fire steps per second. */
    fps?: number;
    /** Which way the flames lean. */
    wind?: DoomFireWind;
    /** Loudness to heat, in decibels or linearly, for every source. */
    scale?: "db" | "linear";
    /** Decibels below the loudest point that still give heat (48 for loudness, 72 for the spectrum). */
    dbRange?: number;
    /** Measure loudness against the loudest point in the file. */
    normalize?: boolean;
    /** Heat multiplier. */
    gain?: number;
    /** 'back': behind the waveform. 'front': screen-blended over it. */
    layer?: "front" | "back";
    /** CSS mix-blend-mode of the fire layer: 'normal' behind the waveform and 'screen' in front unless set. */
    blendMode?: string;
    /** CSS opacity of the fire layer. */
    opacity?: number;
    /** Cell size in CSS pixels, 1 or more. Smaller cells make finer, shorter flames: heat climbs one cell per step. */
    pixelSize?: number;
    /** Colours from cold to hot, CSS strings or [r, g, b], stretched over the 37 heat steps. */
    palette?: readonly DoomFireColor[];
    /** Print each cell's heat. Use a pixelSize of 14 or more. */
    debug?: boolean;
    /** Start lit. */
    burning?: boolean;
    /** Spectrum source: FFT size. */
    fftSize?: number;
    /** Spectrum source: the highest frequency shown. Defaults to Nyquist. */
    maxFrequency?: number;
};
export type DoomFirePluginEvents = {
    destroy: [];
    ignite: [];
    extinguish: [];
    burnout: [];
};
export type DoomFireApi = {
    ignite(): void;
    extinguish(): void;
    isBurning(): boolean;
    setOptions(options?: DoomFirePluginOptions | null): void;
    getCanvas(): HTMLCanvasElement;
    getIntensities(): {
        columns: number;
        rows: number;
        data: Uint8Array;
    };
    /** The column of getIntensities() that a time in seconds falls in, or -1 if it is out of view. */
    columnAt(time: number): number;
};
export declare const DOOM_FIRE_PALETTE: [number, number, number][];
/** One step of the fire, row by row from the top: each cell takes the cell below, cooled by 0-2 and blown by the wind. */
export declare function stepFire(fire: Uint8Array, width: number, height: number, wind?: DoomFireWind, random?: () => number, reverse?: boolean): void;
declare const DoomFirePlugin: DefinedPlugin<DoomFirePluginOptions, DoomFirePluginEvents, DoomFireApi>;
export default DoomFirePlugin;
