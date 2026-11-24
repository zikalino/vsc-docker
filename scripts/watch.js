// One watch process for extension development: `tsc -watch` type-checks and writes out/, and an
// esbuild watcher rebuilds media/dockerPanel.js. `npm run compile` remains the one-shot build.

const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tsc = require.resolve("typescript/bin/tsc");
const children = [
  spawn(process.execPath, [tsc, "-w", "-p", "."], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [path.join(root, "esbuild.js"), "--watch-webview"], {
    cwd: root,
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const child of children) {
  child.on("exit", (code) => stop(code ?? 0));
}
