// Stage only public application files. A source checkout may contain personal tooling.
import { build } from "esbuild";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const stage = await mkdtemp(join(root, ".home-range-build-"));

async function bundle(entry, options = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outdir: stage,
    entryNames: "[name]-[hash]",
    bundle: true,
    format: "esm",
    minify: true,
    metafile: true,
    ...options,
  });
  const [filename] = Object.keys(result.metafile.outputs);
  return "./" + basename(filename);
}

try {
  await build({
    stdin: {
      contents:
        'export {geoAlbersUsa} from "d3-geo"; export {quickselect} from "d3-array";',
      resolveDir: root,
    },
    bundle: true,
    format: "esm",
    minify: true,
    outfile: join(root, "assets/projection.js"),
  });

  // Include the worker's content-specific URL in the app so a worker-only
  // change also gets a new app URL. Both resolve beside the site's data folder.
  const worker = await bundle("access-worker.js");
  const app = await bundle("app.js", {
    define: { "import.meta.accessWorker": JSON.stringify(worker) },
  });
  const css = await bundle("styles.css", { external: ["./assets/*"] });
  const html = (await readFile(join(root, "index.html"), "utf8"))
    .replace('src="./app.js"', 'src="' + app + '"')
    .replace('href="./styles.css"', 'href="' + css + '"');

  await cp(join(root, "assets"), join(stage, "assets"), {
    recursive: true,
    filter: (path) => path !== join(root, "assets/projection.js"),
  });
  await cp(join(root, "data"), join(stage, "data"), { recursive: true });
  await writeFile(join(stage, ".nojekyll"), "");
  await writeFile(join(stage, "index.html"), html);
  await chmod(stage, 0o755);

  const output = join(root, "dist");
  await rm(output, { recursive: true, force: true });
  await rename(stage, output);
} finally {
  await rm(stage, { recursive: true, force: true });
}
