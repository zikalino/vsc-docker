// Copy the Docker panel wasm into media/ so the webview can load it.
//
// The panel is built from the sibling Advance checkout:
//   cargo build --release --target wasm32-unknown-unknown -p advance-docker
// Set ADVANCE_DOCKER_WASM to point at the artifact explicitly if the checkout lives elsewhere.

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const destination = path.join(root, "media", "advance_docker.wasm");
const candidates = [
  process.env.ADVANCE_DOCKER_WASM,
  path.join(root, "..", "advance", "advance", "target", "wasm32-unknown-unknown", "release", "advance_docker.wasm"),
  path.join(root, "..", "advance", "target", "wasm32-unknown-unknown", "release", "advance_docker.wasm"),
  path.join(root, "..", "..", "advance", "target", "wasm32-unknown-unknown", "release", "advance_docker.wasm"),
  path.join(root, "..", "..", "advance", "advance", "target", "wasm32-unknown-unknown", "release", "advance_docker.wasm"),
].filter(Boolean);

const source = candidates.find((candidate) => fs.existsSync(candidate));

if (source === undefined) {
  if (fs.existsSync(destination)) {
    console.log("[copy-wasm] advance_docker.wasm not found in a checkout; using media copy");
  } else {
    console.error("[copy-wasm] advance_docker.wasm not found.");
    console.error("  Build it: cargo build --release --target wasm32-unknown-unknown -p advance-docker");
    console.error("  Or set ADVANCE_DOCKER_WASM to the artifact path.");
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(`[copy-wasm] ${path.relative(root, source)} -> media/advance_docker.wasm`);
}
