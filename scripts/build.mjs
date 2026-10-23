// Bundles src/doomfire.ts into dist/doomfire.esm.js and the script-tag build dist/doomfire.min.js,
// then copies the ES module into the demo page's source panel, which is also the code the demo runs.
import { readFile, writeFile } from "node:fs/promises";
import { build, transform } from "esbuild";

const outfile = "dist/doomfire.esm.js";
const umdOutfile = "dist/doomfire.min.js";
const banner = "/*! DoomFire plugin for wavesurfer.js v8 — fire algorithm & palette from doom-fire-algorithm by Filipe Deschamps (MIT) */\n";

await build({
  entryPoints: ["src/doomfire.ts"],
  outfile,
  bundle: true,
  format: "esm",
  target: "es2020",
  external: ["wavesurfer.js"],
  banner: { js: banner },
});

// The script-tag build: the same plugin in a UMD wrapper, minified. After wavesurfer.js's own script
// it takes the page's WaveSurfer and attaches itself to it as WaveSurfer.DoomFire, as wavesurfer.js's
// plugins do; with CommonJS or AMD it requires wavesurfer.js. A script can't import the palette or
// stepFire, so they ride along as WaveSurfer.DoomFire.DOOM_FIRE_PALETTE and .stepFire.
const pageWaveSurfer = {
  name: "page-wavesurfer",
  setup(plugin) {
    plugin.onResolve({ filter: /^wavesurfer\.js$/ }, () => ({ path: "wavesurfer.js", namespace: "page" }));
    // the WaveSurfer the UMD wrapper hands its factory
    plugin.onLoad({ filter: /.*/, namespace: "page" }, () => ({ contents: "export default WaveSurfer;" }));
  },
};
const { outputFiles } = await build({
  entryPoints: ["src/doomfire.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "doomfire",
  target: "es2020",
  plugins: [pageWaveSurfer],
});
const umd = `(function (root, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = factory(require("wavesurfer.js"));
  } else if (typeof define === "function" && define.amd) {
    define(["wavesurfer.js"], factory);
  } else {
    root = typeof globalThis !== "undefined" ? globalThis : root || self;
    root.WaveSurfer = root.WaveSurfer || {};
    root.WaveSurfer.DoomFire = factory(root.WaveSurfer);
  }
})(this, function (WaveSurfer) {
${outputFiles[0].text}
  return Object.assign(doomfire.default, { DOOM_FIRE_PALETTE: doomfire.DOOM_FIRE_PALETTE, stepFire: doomfire.stepFire });
});
`;
const { code: minified } = await transform(umd, { minify: true, target: "es2020" });
await writeFile(umdOutfile, banner + minified);

const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const code = (await readFile(outfile, "utf8")).trimEnd();
const page = await readFile("index.html", "utf8");
const open = '<pre id="plugin-source" class="code">';
const start = page.indexOf(open);
const end = page.indexOf("</pre>", start);
if (start < 0 || end < 0) throw new Error("index.html has no source panel to update");
await writeFile("index.html", page.slice(0, start + open.length) + escapeHtml(code) + page.slice(end));
console.log(`built ${outfile} and ${umdOutfile}, and updated the demo's source panel`);
