// Bundles src/doomfire.ts into dist/doomfire.esm.js, then copies the result into the demo page's
// source panel, which is also the code the demo runs.
import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outfile = "dist/doomfire.esm.js";

await build({
  entryPoints: ["src/doomfire.ts"],
  outfile,
  bundle: true,
  format: "esm",
  target: "es2020",
  external: ["wavesurfer.js"],
  banner: { js: "/*! DoomFire plugin for wavesurfer.js v8 — fire algorithm & palette from doom-fire-algorithm by Filipe Deschamps (MIT) */\n" },
});

const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const code = (await readFile(outfile, "utf8")).trimEnd();
const page = await readFile("index.html", "utf8");
const open = '<pre id="plugin-source" class="code">';
const start = page.indexOf(open);
const end = page.indexOf("</pre>", start);
if (start < 0 || end < 0) throw new Error("index.html has no source panel to update");
await writeFile("index.html", page.slice(0, start + open.length) + escapeHtml(code) + page.slice(end));
console.log(`built ${outfile} and updated the demo's source panel`);
