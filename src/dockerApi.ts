import * as vscode from 'vscode';
import * as cp from 'child_process';
import { executeCommand } from './terminal';

type ExecutionMode = 'none' | 'some' | 'all';

function getExecutionMode(): ExecutionMode {
  try {
    const mode = vscode.workspace.getConfiguration('docker-runner').get<string>('executionMode');
    if (mode === 'none' || mode === 'some' || mode === 'all') return mode;
  } catch { /* ignore */ }
  return 'some';
}

// ---------------------------------------------------------------------------
// Low-level shell helpers
// ---------------------------------------------------------------------------

/**
 * Execute a shell command synchronously via child_process.
 * Returns trimmed stdout on success, or stdout from the error object on
 * non-zero exit, or empty string on total failure.
 */
export function exec(cmd: string): string {
  try {
    const shell = process.platform === 'win32' ? 'powershell' : '/bin/bash';
    return cp.execSync(cmd, { shell, encoding: 'utf8' }).toString().trim();
  } catch (e: any) {
    if (e?.stdout) { return e.stdout.toString().trim(); }
    return '';
  }
}

/**
 * Execute a shell command asynchronously in the Docker Runner terminal.
 * The command is visible in the terminal and its output is returned.
 * Falls back to `exec()` (sync) if the execution mode is 'none'
 * or if the terminal shell is not ready.
 */
export async function execAsync(cmd: string): Promise<string> {
  const mode = getExecutionMode();
  if (mode === 'none') return exec(cmd);
  try {
    const result = await executeCommand(cmd);
    if (result === false) return exec(cmd);
    return result.join('\n');
  } catch {
    return exec(cmd);
  }
}

/**
 * Execute a shell command that returns newline-separated JSON rows.
 * Returns an array of parsed objects.
 */
export function execRows(cmd: string): any[] {
  const out = exec(cmd);
  if (!out) return [];
  return out.split(/\r?\n/).filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Async version of execRows — runs through the Docker Runner terminal
 * only when execution mode is 'all'. In 'some'/'none' mode uses sync exec().
 */
export async function execRowsAsync(cmd: string): Promise<any[]> {
  const mode = getExecutionMode();
  if (mode !== 'all') return execRows(cmd);
  const out = await execAsync(cmd);
  if (!out) return [];
  return out.split(/\r?\n/).filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + units[i];
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try { return new Date(dateStr).toLocaleString(); } catch { return dateStr; }
}

/** Truncate a long Docker ID to short form (first 12 characters). */
export function shortId(id: string): string {
  return (id || '').substring(0, 12);
}

// ---------------------------------------------------------------------------
// Container API
// ---------------------------------------------------------------------------

export function listContainers(all = true): any[] {
  return execRows(`docker ps ${all ? '--all' : ''} --format json`);
}

export function startContainer(id: string): void {
  exec(`docker container start ${id}`);
}

/** Async version — runs in the Docker Runner terminal for user visibility. */
export async function startContainerAsync(id: string): Promise<string> {
  return execAsync(`docker container start ${id}`);
}

export function stopContainer(id: string): void {
  exec(`docker container stop ${id}`);
}

/** Async version — runs in the Docker Runner terminal for user visibility. */
export async function stopContainerAsync(id: string): Promise<string> {
  return execAsync(`docker container stop ${id}`);
}

export function restartContainer(id: string): void {
  exec(`docker container restart ${id}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function restartContainerAsync(id: string): Promise<string> {
  return execAsync(`docker container restart ${id}`);
}

export function pauseContainer(id: string): void {
  exec(`docker container pause ${id}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function pauseContainerAsync(id: string): Promise<string> {
  return execAsync(`docker container pause ${id}`);
}

export function unpauseContainer(id: string): void {
  exec(`docker container unpause ${id}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function unpauseContainerAsync(id: string): Promise<string> {
  return execAsync(`docker container unpause ${id}`);
}

export function removeContainer(id: string, force = true): void {
  exec(`docker container ${force ? 'rm -f' : 'rm'} ${id}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function removeContainerAsync(id: string, force = true): Promise<string> {
  return execAsync(`docker container ${force ? 'rm -f' : 'rm'} ${id}`);
}

export function exportContainer(id: string, outputPath?: string): void {
  exec(`docker container export ${id} --output ${outputPath || shortId(id) + '.tar'}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function exportContainerAsync(id: string, outputPath?: string): Promise<string> {
  return execAsync(`docker container export ${id} --output ${outputPath || shortId(id) + '.tar'}`);
}

export function execInContainer(id: string, command: string): string {
  return exec(`docker exec ${id} ${command}`);
}

export function containerLogs(id: string, tail = 50): string {
  return exec(`docker logs --tail ${tail} ${id} 2>&1`);
}

export function containerDiff(id: string): string {
  return exec(`docker diff ${id} 2>&1`);
}

export function inspectContainer(id: string): any[] {
  return execRows(`docker container inspect ${id}`);
}

// ---------------------------------------------------------------------------
// Image API
// ---------------------------------------------------------------------------

export function listImages(): any[] {
  return execRows('docker image list --format json');
}

export function removeImage(id: string, force = true): void {
  exec(`docker image ${force ? 'rm -f' : 'rm'} ${id}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function removeImageAsync(id: string, force = true): Promise<string> {
  return execAsync(`docker image ${force ? 'rm -f' : 'rm'} ${id}`);
}

export function saveImage(id: string, outputPath?: string): void {
  exec(`docker image save ${id} --output ${outputPath || shortId(id) + '.tar'}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function saveImageAsync(id: string, outputPath?: string): Promise<string> {
  return execAsync(`docker image save ${id} --output ${outputPath || shortId(id) + '.tar'}`);
}

export function pushImage(id: string): void {
  exec(`docker image push ${id}`);
}

/** Async version — runs in the Docker Runner terminal. */
export async function pushImageAsync(id: string): Promise<string> {
  return execAsync(`docker image push ${id}`);
}

export function pullImage(tag: string): string {
  return exec(`docker image pull ${tag}`);
}

/** Async version — runs in the Docker Runner terminal with progress visibility. */
export async function pullImageAsync(tag: string): Promise<string> {
  return execAsync(`docker image pull ${tag}`);
}

export function pruneImages(): void {
  exec('docker image prune -f');
}

/** Async version — runs in the Docker Runner terminal. */
export async function pruneImagesAsync(): Promise<string> {
  return execAsync('docker image prune -f');
}

export function inspectImage(id: string): any[] {
  return execRows(`docker image inspect ${id}`);
}

export function imageHistory(id: string): any[] {
  return execRows(`docker history --no-trunc --format json ${id}`);
}

// ---------------------------------------------------------------------------
// System API
// ---------------------------------------------------------------------------

export function info(): any {
  const rows = execRows('docker info --format {{json .}}');
  return rows.length > 0 ? rows[0] : null;
}

export function pruneContainers(): void {
  exec('docker container prune -f');
}

/** Async version — runs in the Docker Runner terminal. */
export async function pruneContainersAsync(): Promise<string> {
  return execAsync('docker container prune -f');
}

// ---------------------------------------------------------------------------
// Container filesystem
// ---------------------------------------------------------------------------

/** List a directory inside a container. Returns raw ls -la output. */
export function listContainerDirectory(containerId: string, path: string): string {
  return exec(`docker exec ${containerId} sh -c "ls -la '${path}' 2>/dev/null || echo 'ERROR'"`);
}

/** Read a file inside a container via cat. */
export function readContainerFile(containerId: string, path: string): string {
  return exec(`docker exec ${containerId} sh -c "cat '${path}' 2>/dev/null || echo 'ERROR: Cannot read file'"`);
}

// ---------------------------------------------------------------------------
// Dockerfile generation
// ---------------------------------------------------------------------------

export function commitContainer(containerId: string, imageName: string): void {
  exec(`docker commit ${containerId} ${imageName}`);
}
