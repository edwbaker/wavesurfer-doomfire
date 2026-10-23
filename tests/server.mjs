// A static file server for the tests: serves the repository, so pages can load dist/ and node_modules/.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

// The plugin as the test harness loads it: the built dist/doomfire.esm.js with a test-only window
// into its state, and a count of full heat recomputes.
const pluginUnderTest = async () => {
  const source = (await readFile(resolve(root, "dist/doomfire.esm.js"), "utf8")).replace(/\r\n/g, "\n");
  const api = "    return {\n      ignite,";
  const computeHeat = "    const computeHeat = () => {\n";
  if (!source.includes(api) || !source.includes(computeHeat)) throw new Error("the test hook points are missing from dist/doomfire.esm.js");
  return source
    .replace(api, "    return {\n      __state: () => ({ fuelTop, fuelBottom, laneCount, simW, padL, cols, rows, cellPx, originPx, heat, palette, sparks, layer }),\n      ignite,")
    .replace(computeHeat, computeHeat + "      window.fullHeatCount = (window.fullHeatCount || 0) + 1;\n");
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  if (pathname === "/tests/doomfire.under-test.js") {
    try {
      response.writeHead(200, { "content-type": types[".js"], "cache-control": "no-store" }).end(await pluginUnderTest());
    } catch (error) {
      console.error(error);
      response.writeHead(500, { "content-type": "text/plain" }).end(String(error));
    }
    return;
  }
  const file = resolve(root, "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(resolve(root) + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
