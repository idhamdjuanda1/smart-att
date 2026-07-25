const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const previewDirectory = resolve(__dirname, "local-pages");
const pagesDirectory = resolve(root, ".pages-deploy");
const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const npmCli = process.env.npm_execpath;

function run(command, args, options) {
  return spawn(command, args, { stdio: "inherit", ...options });
}

if (!npmCli) throw new Error("Jalankan preview melalui npm run dev.");
const build = run(process.execPath, [npmCli, "run", "build:pages"], { cwd: root });

build.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const preview = run(process.execPath, [wrangler, "pages", "dev", pagesDirectory, "--port", "3000"], {
    cwd: previewDirectory,
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => preview.kill(signal));
  }
  preview.on("exit", (previewCode) => process.exit(previewCode ?? 0));
});
