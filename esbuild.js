const { build } = require("esbuild");
const { yamlPlugin } = require("esbuild-plugin-yaml");
const fs = require("fs");
const path = require("path");

const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");

const baseConfig = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  plugins: [ yamlPlugin() ]
};

const extensionConfig = {
  ...baseConfig,
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  entryPoints: ["./src/extension.ts"],
  outfile: "./out/extension.js",
  external: ["vscode"],
  loader: {".html": "text"}
};

const validateConfig = {
  ...baseConfig,
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  entryPoints: ["./src/validate.ts"],
  outfile: "./out/validate.js",
  loader: {".html": "text"}
};

const watchConfig = {
  watch: true,
};

(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--watch")) {
      // Build and watch extension code
      console.log("[watch] build started");
      await build({
        ...extensionConfig,
        ...watchConfig,
      });
      console.log("[watch] build finished");
    } else {
      // Build extension code
      await build(extensionConfig);
      await build(validateConfig);
      fs.copyFileSync(
        path.resolve(__dirname, "src/shared/vscode-components/workflow-execution-plan/workflow-execution-plan.html"),
        path.resolve(__dirname, "out/workflow-execution-plan.html")
      );
      console.log("build complete");
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();