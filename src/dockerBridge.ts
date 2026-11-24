// The Docker panel's world: the CLI runs here, in the extension host.
//
// The panel wasm is granted nothing — it reads no file and runs no program — so the Docker commands
// live here and the panel draws what it is told. Every invocation is an argv vector, never a shell
// string, so a container name cannot turn into a second command.

import * as cp from "child_process";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerSnapshot {
  available: boolean;
  error?: string;
  notice?: string;
  containers: DockerContainer[];
  images: DockerImage[];
}

export interface DockerDetail {
  title: string;
  lines: string[];
  error?: string;
}

type RunStatus = "ok" | "failed" | "missing" | "spawn";

interface Run {
  status: RunStatus;
  stdout: string;
  stderr: string;
  /** A spawn failure's message, already phrased for the panel. */
  message?: string;
}

function run(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    cp.execFile(
      "docker",
      args,
      { windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const out = stdout ?? "";
        const err = stderr ?? "";
        if (error === null) {
          resolve({ status: "ok", stdout: out, stderr: err });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          resolve({
            status: "missing",
            stdout: out,
            stderr: err,
            message: "Could not run Docker: the executable was not found.",
          });
          return;
        }
        if (typeof code === "string") {
          resolve({
            status: "spawn",
            stdout: out,
            stderr: err,
            message: `Could not run Docker: ${error.message}`,
          });
          return;
        }
        resolve({ status: "failed", stdout: out, stderr: err });
      },
    );
  });
}

/**
 * Query the local Docker CLI.
 *
 * A missing CLI is `available: false`; a CLI that runs but cannot reach a daemon is `available: true`
 * with the CLI's own first error line, because those are different things to do about it.
 */
export async function snapshot(): Promise<DockerSnapshot> {
  const state: DockerSnapshot = { available: true, containers: [], images: [] };
  const ps = await run(["ps", "--all", "--format", "{{json .}}"]);
  if (ps.status === "missing") {
    state.available = false;
    state.error = "Docker is not installed or not on PATH.";
    return state;
  }
  if (ps.status === "spawn") {
    state.available = false;
    state.error = ps.message;
    return state;
  }
  if (ps.status === "failed") {
    state.error = firstLine(ps);
    return state;
  }
  state.containers = parseContainers(ps.stdout);

  const images = await run(["image", "ls", "--format", "{{json .}}"]);
  if (images.status === "ok") {
    state.images = parseImages(images.stdout);
  } else if (images.status === "failed") {
    state.error = firstLine(images);
  } else {
    state.error = images.message ?? "Docker is not installed or not on PATH.";
  }
  return state;
}

/**
 * Run one action, then take a fresh snapshot.
 *
 * The action's own failure is a `notice` rather than an `error`: the list still describes the
 * daemon correctly, and a container that would not stop has not made every card a lie.
 */
export async function act(op: string, target: string): Promise<DockerSnapshot> {
  const args = argsFor(op, target);
  if (args === undefined) {
    const state = await snapshot();
    state.notice = `\`${op}\` is not a Docker action this panel knows`;
    return state;
  }
  const result = await run(args);
  const state = await snapshot();
  state.notice =
    result.status === "ok"
      ? notice(op, target)
      : result.status === "spawn" || result.status === "missing"
        ? (result.message ?? "Could not run Docker.")
        : `${actionWord(op)} failed: ${firstLine(result)}`;
  return state;
}

/** The last 200 lines of a container's output. */
export async function logs(id: string): Promise<DockerDetail> {
  const title = `Logs · ${short(id)}`;
  if (!safeTarget(id)) {
    return { title, lines: [], error: "That is not a container id." };
  }
  const result = await run(["logs", "--tail", "200", id]);
  if (result.status !== "ok") {
    return { title, lines: [], error: failureText(result) };
  }
  let text = result.stdout;
  if (result.stderr.trim() !== "") {
    if (text !== "") {
      text += "\n";
    }
    text += result.stderr;
  }
  return { title, lines: capLines(text) };
}

/**
 * A readable summary of `docker inspect`, not the whole JSON: the pane is a column, and the fields
 * that answer "what is this and how is it wired" fit in a handful of lines.
 */
export async function inspect(id: string): Promise<DockerDetail> {
  const title = `Details · ${short(id)}`;
  if (!safeTarget(id)) {
    return { title, lines: [], error: "That is not a container id." };
  }
  const result = await run(["inspect", id]);
  if (result.status !== "ok") {
    return { title, lines: [], error: failureText(result) };
  }
  try {
    const lines = summarize(JSON.parse(result.stdout));
    if (lines.length === 0) {
      return { title, lines: [], error: "docker inspect returned no object" };
    }
    return { title, lines };
  } catch {
    return { title, lines: capLines(result.stdout) };
  }
}

/** Whether `op` is one of the lifecycle/prune actions {@link act} understands. */
export function isAction(op: string): boolean {
  return (
    op === "start" ||
    op === "stop" ||
    op === "restart" ||
    op === "pause" ||
    op === "unpause" ||
    op === "remove" ||
    op === "pull" ||
    op === "remove-image" ||
    op === "prune-containers" ||
    op === "prune-images"
  );
}

/**
 * The argv for one action, or `undefined` when the op is unknown or the target would be read as a
 * flag.
 *
 * The target is checked because it comes from a frame log: a wasm module that says `--privileged`
 * where a container id should be is a bug, and passing it to Docker would make it one with teeth.
 */
export function argsFor(op: string, target: string): string[] | undefined {
  const value = target.trim();
  switch (op) {
    case "start":
    case "stop":
    case "restart":
    case "pause":
    case "unpause":
      return safeTarget(value) ? ["container", op, value] : undefined;
    case "remove":
      return safeTarget(value) ? ["container", "rm", "-f", value] : undefined;
    case "pull":
      return safeTarget(value) ? ["image", "pull", value] : undefined;
    case "remove-image":
      return safeTarget(value) ? ["image", "rm", "-f", value] : undefined;
    case "prune-containers":
      return ["container", "prune", "-f"];
    case "prune-images":
      return ["image", "prune", "-f"];
    default:
      return undefined;
  }
}

/**
 * Whether a target is a name and not an option. Docker ids and image references have no whitespace
 * or control characters, and a leading `-` would be read as a flag.
 */
export function safeTarget(target: string): boolean {
  return (
    target.length > 0 &&
    target.length <= 256 &&
    !target.startsWith("-") &&
    !/[\s\u0000-\u001f\u007f-\u009f]/.test(target)
  );
}

function failureText(result: Run): string {
  if (result.status === "spawn" || result.status === "missing") {
    return result.message ?? "Could not run Docker.";
  }
  return firstLine(result);
}

/** The first non-empty line Docker wrote, which is the diagnosis rather than the whole trace. */
function firstLine(result: Run): string {
  const text = result.stderr.trim() !== "" ? result.stderr : result.stdout;
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return (line ?? "docker exited with an error").slice(0, 300);
}

function parseContainers(stdout: string): DockerContainer[] {
  return rows(stdout).map((row) => {
    const names = field(row, "Names");
    return {
      id: field(row, "ID"),
      name: names.startsWith("/") ? names.slice(1) : names,
      image: field(row, "Image"),
      state: field(row, "State"),
      status: field(row, "Status"),
      ports: field(row, "Ports"),
      created: field(row, "CreatedAt"),
    };
  });
}

function parseImages(stdout: string): DockerImage[] {
  return rows(stdout).map((row) => {
    const at = field(row, "CreatedAt");
    return {
      id: field(row, "ID"),
      repository: field(row, "Repository"),
      tag: field(row, "Tag"),
      size: field(row, "Size"),
      created: at !== "" ? at : field(row, "CreatedSince"),
    };
  });
}

function rows(stdout: string): unknown[] {
  const parsed: unknown[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // A diagnostic line is not a row; skip it.
    }
  }
  return parsed;
}

function field(row: unknown, key: string): string {
  if (row === null || typeof row !== "object") {
    return "";
  }
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function capLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === "" && /[\r\n]$/.test(text)) {
    raw.pop();
  }
  const lines: string[] = [];
  for (const line of raw) {
    if (lines.length >= 400) {
      break;
    }
    lines.push(line.replace(/\r+$/, "").slice(0, 500));
  }
  return lines;
}

function summarize(value: unknown): string[] {
  const item = Array.isArray(value) ? value[0] : value;
  if (item === null || typeof item !== "object") {
    return [];
  }
  const record = item as Record<string, unknown>;
  const text = (key: string): string => {
    const field = record[key];
    return typeof field === "string" ? field : "";
  };
  const lines: string[] = [];
  lines.push(`Name: ${text("Name")}`);
  lines.push(`ID: ${short(text("Id"))}`);
  lines.push(`Image: ${text("Image")}`);
  lines.push(`Created: ${text("Created")}`);

  const state = object(record["State"]);
  if (state !== undefined) {
    const status = typeof state.Status === "string" ? state.Status : "";
    const running = state.Running === true;
    const paused = state.Paused === true;
    const suffix = paused ? " (paused)" : running ? " (running)" : "";
    lines.push(`State: ${status}${suffix}`);
  }
  const restart = object(pointer(record, "/HostConfig/RestartPolicy"));
  if (restart !== undefined && typeof restart.Name === "string" && restart.Name !== "") {
    lines.push(`Restart: ${restart.Name}`);
  }
  if (typeof record.Platform === "string" && record.Platform !== "") {
    lines.push(`Platform: ${record.Platform}`);
  }
  const config = object(record.Config);
  if (config !== undefined) {
    if (typeof config.Hostname === "string" && config.Hostname !== "") {
      lines.push(`Hostname: ${config.Hostname}`);
    }
    const command = joinArray(config.Cmd);
    if (command !== undefined) {
      lines.push(`Command: ${command}`);
    }
    const entrypoint = joinArray(config.Entrypoint);
    if (entrypoint !== undefined) {
      lines.push(`Entrypoint: ${entrypoint}`);
    }
  }

  const ports = object(pointer(record, "/NetworkSettings/Ports"));
  if (ports !== undefined) {
    for (const [container, bindings] of Object.entries(ports)) {
      if (Array.isArray(bindings)) {
        for (const binding of bindings) {
          const host = object(binding);
          const address = host !== undefined && typeof host.HostIp === "string" ? host.HostIp : "";
          const port = host !== undefined && typeof host.HostPort === "string" ? host.HostPort : "";
          lines.push(`Port: ${container} -> ${address}:${port}`);
        }
      } else {
        lines.push(`Port: ${container}`);
      }
    }
  }

  if (Array.isArray(record.Mounts)) {
    for (const mount of record.Mounts) {
      const value = object(mount);
      if (value === undefined) {
        continue;
      }
      const destination = typeof value.Destination === "string" ? value.Destination : "";
      const source = typeof value.Source === "string" ? value.Source : "";
      const kind = typeof value.Type === "string" ? value.Type : "";
      lines.push(`Mount: ${destination} <- ${source} (${kind})`);
    }
  }

  const networks = object(pointer(record, "/NetworkSettings/Networks"));
  if (networks !== undefined) {
    for (const [name, network] of Object.entries(networks)) {
      const value = object(network);
      const address = value !== undefined && typeof value.IPAddress === "string" ? value.IPAddress : "";
      lines.push(`Network: ${name} ${address}`);
    }
  }

  if (config !== undefined && Array.isArray(config.Env)) {
    for (const entry of config.Env.slice(0, 20)) {
      if (typeof entry === "string") {
        lines.push(`Env: ${entry}`);
      }
    }
  }
  return lines;
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function pointer(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split("/")) {
    if (key === "") {
      continue;
    }
    const next = object(current);
    if (next === undefined) {
      return undefined;
    }
    current = next[key];
  }
  return current;
}

function joinArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value.filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function notice(op: string, target: string): string {
  switch (op) {
    case "start":
      return `Started ${short(target)}`;
    case "stop":
      return `Stopped ${short(target)}`;
    case "restart":
      return `Restarted ${short(target)}`;
    case "pause":
      return `Paused ${short(target)}`;
    case "unpause":
      return `Unpaused ${short(target)}`;
    case "remove":
      return `Removed ${short(target)}`;
    case "remove-image":
      return `Removed image ${short(target)}`;
    case "pull":
      return `Pulled ${target}`;
    case "prune-containers":
      return "Pruned stopped containers";
    case "prune-images":
      return "Pruned dangling images";
    default:
      return `${op} done`;
  }
}

function actionWord(op: string): string {
  switch (op) {
    case "start":
      return "Start";
    case "stop":
      return "Stop";
    case "restart":
      return "Restart";
    case "pause":
      return "Pause";
    case "unpause":
      return "Unpause";
    case "remove":
      return "Remove";
    case "remove-image":
      return "Remove image";
    case "pull":
      return "Pull";
    case "prune-containers":
      return "Prune containers";
    case "prune-images":
      return "Prune images";
    default:
      return "Docker action";
  }
}

function short(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}
