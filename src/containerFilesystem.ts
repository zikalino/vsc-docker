import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as os from 'os';
import { listContainerDirectory, readContainerFile, listContainers } from './dockerApi';
import {
  getDualPaneFsStyles,
  getDualPaneFsHtml,
  getDualPaneFsScript,
} from './shared/vscode-components/dual-pane-fs/index';

// ─── Inline FS provider types (avoids cross-rootDir imports) ──

interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  sizeLabel?: string;
  modified?: string;
  mode?: string;
}

interface IFileSystemProvider {
  scheme: string;
  label: string;
  /** uri is the full URI (e.g. docker://container/etc), parsed by each provider. */
  listDir(uri: string): FsEntry[];
  readFile?(uri: string): string;
}

class FsProviderRegistry {
  private providers = new Map<string, IFileSystemProvider>();
  register(p: IFileSystemProvider) { this.providers.set(p.scheme, p); }
  resolve(uri: string): IFileSystemProvider | null {
    const m = uri.match(/^([a-z][a-z0-9+.-]+):\/\//);
    if (!m) return null;
    return this.providers.get(m[1]) || null;
  }
}

function parentPath(p: string): string {
  if (p === '/') return '/';
  const parts = p.replace(/\/$/, '').split('/');
  parts.pop();
  const result = parts.join('/') || '/';
  // On Windows, if remaining path is a bare drive letter like '/c:', add trailing slash → '/c:/'
  if (process.platform === 'win32' && result.match(/^\/[A-Za-z]:$/)) return result + '/';
  return result;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + units[i];
}

function normalizeUri(uri: string): string {
  // Lowercase Windows drive letter in file:// URIs only
  if (process.platform === 'win32' && uri.startsWith('file://')) {
    uri = uri.replace(/^file:\/\/\/([A-Z]):/, (_m, d) => 'file:///' + d.toLowerCase() + ':');
  }
  return uri;
}

// ─── Docker provider (wraps existing docker API) ──────────────

class DockerProvider implements IFileSystemProvider {
  scheme = 'docker';
  label = 'Docker Container';
  listDir(uri: string): FsEntry[] {
    const parsed = uri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
    if (!parsed) return [];
    const containerId = parsed[1];
    const fsPath = parsed[2] || '/';
    const output = listContainerDirectory(containerId, fsPath);
    return parseLsOutput(output);
  }
  readFile(uri: string): string {
    const parsed = uri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
    if (!parsed) return '';
    return readContainerFile(parsed[1], parsed[2] || '/');
  }
}

// ─── Local FS provider ────────────────────────────────────────

class LocalProvider implements IFileSystemProvider {
  scheme = 'file';
  label = 'Local Filesystem';
  listDir(uri: string): FsEntry[] {
    const dirPath = toLocalPath(uri);
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result: FsEntry[] = [];
      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue;
        try {
          const stat = fs.statSync(path.join(dirPath, entry.name));
          result.push({
            name: entry.name,
            isDir: entry.isDirectory(),
            size: entry.isDirectory() ? 0 : stat.size,
            sizeLabel: entry.isDirectory() ? '-' : formatSize(stat.size),
            modified: stat.mtime.toISOString().replace(/T/, ' ').substring(0, 16),
            mode: (stat.isDirectory() ? 'd' : '-') +
                  (stat.mode & 256 ? 'r' : '-') + (stat.mode & 128 ? 'w' : '-') + (stat.mode & 64 ? 'x' : '-'),
          });
        } catch { /* skip */ }
      }
      result.sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.localeCompare(b.name); });
      return result;
    } catch { return []; }
  }
  readFile(uri: string): string { return fs.readFileSync(toLocalPath(uri), 'utf8'); }
}

// ─── SSH FS provider ───────────────────────────────────────────
// URI: ssh://user@host:port/path

class SshProvider implements IFileSystemProvider {
  scheme = 'ssh';
  label = 'SSH';
  private execSsh(uri: string, command: string): string {
    const parsed = uri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (!parsed) return '';
    const user = parsed[1] || 'root';
    const host = parsed[2];
    const port = parsed[3] || '22';
    const fp = parsed[4] || '/';
    const sshCmd = `ssh -p ${port} ${user}@${host} "cd '${fp}' && ${command}"`;
    try { return cp.execSync(sshCmd, { encoding: 'utf8', timeout: 10000 }).toString().trim(); }
    catch (e: any) { if (e?.stdout) return e.stdout.toString().trim(); return ''; }
  }
  listDir(uri: string): FsEntry[] {
    const raw = this.execSsh(uri, 'ls -la');
    if (!raw) return [];
    return parseLsOutput(raw);
  }
  readFile(uri: string): string {
    return this.execSsh(uri, 'cat');
  }
}

// ─── GitHub FS provider ─────────────────────────────────────────
// URI: github://github.com/owner/repo[/path]
// Uses GitHub Contents API: https://docs.github.com/en/rest/repos/contents

class GitHubProvider implements IFileSystemProvider {
  scheme = 'github';
  label = 'GitHub';
  private request(method: string, apiPath: string): string {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'vscode-docker-runner',
        'Accept': 'application/vnd.github.v3+json',
      } as Record<string, string>,
      timeout: 15000,
    };
    // Try to read GITHUB_TOKEN from env var for higher API rate limits
    const token = process.env.GITHUB_TOKEN;
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    return httpsRequest(options);
  }
  parseUri(uri: string): { owner: string; repo: string; path: string } | null {
    const m = uri.match(/^github:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2], path: m[3] || '' };
  }
  listDir(uri: string): FsEntry[] {
    const p = this.parseUri(uri);
    if (!p) return [];
    const apiPath = `/repos/${p.owner}/${p.repo}/contents/${p.path}`;
    console.log(`[GitHubProvider] GET ${apiPath}`);
    const raw = this.request('GET', apiPath);
    if (!raw) { console.log(`[GitHubProvider] empty response`); return []; }
    console.log(`[GitHubProvider] response length=${raw.length}`);
    try {
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) {
        // It's a single file — navigate to its parent
        const parentPath = p.path.split('/').slice(0, -1).join('/');
        return this.listDir(`github://github.com/${p.owner}/${p.repo}/${parentPath}`);
      }
      return items.map((item: any) => ({
        name: item.name,
        isDir: item.type === 'dir',
        size: item.size || 0,
        sizeLabel: item.type === 'dir' ? '-' : formatSize(item.size || 0),
        modified: '',
        mode: item.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--',
      }));
    } catch (e) {
      console.log(`[GitHubProvider] JSON parse failed: ${e} — raw start: ${raw.substring(0, 200)}`);
      return [];
    }
  }
  readFile(uri: string): string {
    const p = this.parseUri(uri);
    if (!p) return '';
    const raw = this.request('GET', `/repos/${p.owner}/${p.repo}/contents/${p.path}`);
    if (!raw) return '';
    try {
      const obj = JSON.parse(raw);
      if (obj.content) return Buffer.from(obj.content, 'base64').toString('utf8');
    } catch { /* not JSON */ }
    return raw;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Parse `ls -la` output lines into FsEntry[]. Shared by DockerProvider and SshProvider. */
function toLocalPath(uri: string): string {
  let p = uri.replace(/^file:\/\//i, '');
  if (process.platform === 'win32') {
    // /C:/path → c:/path, also handle bare /C: or C:
    p = p.replace(/^\/([A-Za-z]):/, (_m, d) => d.toLowerCase() + ':');
    p = p.replace(/^([A-Za-z]):$/, (_m, d) => d.toLowerCase() + ':\\');
  }
  return p;
}

function parseLsOutput(output: string): FsEntry[] {
  if (!output) return [];
  const entries: FsEntry[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('total ') || line.trim() === '') continue;
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const perms = parts[0];
    const isDir = perms.startsWith('d');
    const name = parts.slice(8).join(' ');
    if (name === '.' || name === '..') continue;
    entries.push({
      name, isDir,
      size: parseInt(parts[4], 10),
      sizeLabel: isDir ? '-' : formatSize(parseInt(parts[4], 10)),
      modified: `${parts[5]} ${parts[6]} ${parts[7]}`,
      mode: perms,
    });
  }
  entries.sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.localeCompare(b.name); });
  return entries;
}

/** HTTPS helper for GitHub API calls. Tries curl first, then PowerShell (Windows). */
function httpsRequest(options: { hostname: string; path: string; headers?: Record<string, string> }): string {
  const url = `https://${options.hostname}${options.path}`;
  let headerArgs = '';
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      headerArgs += ` -H "${k}: ${v}"`;
    }
  }
  const isWin = process.platform === 'win32';
  // Try curl first
  try {
    const r = cp.execSync(`curl -s${headerArgs} "${url}"`, { encoding: 'utf8', timeout: 15000 }).toString().trim();
    if (r) return r;
  } catch {}
  // Try PowerShell on Windows
  if (isWin) {
    try {
      const psCmd = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (Invoke-RestMethod -Uri '${url}' -Headers @{${options.headers ? Object.entries(options.headers).map(([k, v]) => `'${k}'='${v}'`).join('; ') : ''}}).Content`;
      const r = cp.execSync(`powershell -Command "${psCmd}"`, { encoding: 'utf8', timeout: 15000 }).toString().trim();
      if (r) return r;
    } catch {}
  }
  // Try wget as last resort
  try {
    const r = cp.execSync(`wget -qO-${headerArgs} "${url}"`, { encoding: 'utf8', timeout: 15000 }).toString().trim();
    if (r) return r;
  } catch {}
  return '';
}

function guessLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
    go: 'go', rs: 'rust', java: 'java', cpp: 'cpp', c: 'c',
    h: 'c', hpp: 'cpp', cs: 'csharp', sh: 'shellscript', bash: 'shellscript',
    yaml: 'yaml', yml: 'yaml', json: 'json', xml: 'xml', md: 'markdown',
    html: 'html', css: 'css',
    dockerfile: 'dockerfile',
    conf: 'ini', ini: 'ini', cfg: 'ini', toml: 'ini',
    sql: 'sql', log: 'text', txt: 'text',
  };
  return map[ext] || 'text';
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** Convert FsEntry[] to rows for the webview. */
interface FsRowEx { id: string; name: string; isDir: boolean; sizeLabel: string; modified: string; mode: string; _fullPath: string; }
function toFsRows(entries: FsEntry[], fullPathBase: string): FsRowEx[] {
  return entries.map(e => ({
    id: e.isDir ? `dir:${e.name}` : `file:${e.name}`,
    name: e.name,
    isDir: e.isDir,
    sizeLabel: e.sizeLabel || String(e.size),
    modified: e.modified || '',
    mode: e.mode || '',
    _fullPath: (fullPathBase.endsWith('/') ? fullPathBase : fullPathBase + '/') + e.name,
  }));
}

export class ContainerFilesystemPanel {
  private static instance: ContainerFilesystemPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private registry = new FsProviderRegistry();
  private panelUris: Record<string, string> = { L: 'file:///', R: 'file:///' };
  private terminals = new Map<string, vscode.Terminal>();
  private tempOriginMap = new Map<string, string>();

  private constructor() {
    this.registry.register(new DockerProvider());
    this.registry.register(new LocalProvider());
    this.registry.register(new SshProvider());
    this.registry.register(new GitHubProvider());
    // Clean up terminal tracking on close
    vscode.window.onDidCloseTerminal(t => {
      for (const [key, term] of this.terminals) {
        if (term === t) { this.terminals.delete(key); break; }
      }
    });
    // Watch for saves on temp files to write back to origin
    vscode.workspace.onDidSaveTextDocument(doc => {
      const origin = this.tempOriginMap.get(doc.uri.fsPath);
      if (!origin) return;
      this.log(`save-back: ${doc.uri.fsPath} → ${origin}`);
      this.writeFileToUri(origin, doc.getText());
    });
  }

  static getInstance(): ContainerFilesystemPanel {
    if (!ContainerFilesystemPanel.instance) {
      ContainerFilesystemPanel.instance = new ContainerFilesystemPanel();
    }
    return ContainerFilesystemPanel.instance;
  }

  private getDefaultUri(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const fp = folders[0].uri.fsPath;
      // On Windows, fsPath is like "C:\path" — we need file:///C:/path
      const normalized = fp.replace(/\\/g, '/');
      return `file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}/`;
    }
    return 'file:///';
  }

  show(containerId?: string): void {
    if (!this.panel) {
      // Set default URIs to workspace folder if available
      const defaultUri = this.getDefaultUri();
      this.panelUris = { L: defaultUri, R: defaultUri };

      this.panel = vscode.window.createWebviewPanel(
        'dockerFsExplorer',
        'SmarterCommander',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
      this.panel.webview.html = this.buildHtml();
    }
    this.panel.reveal(vscode.ViewColumn.Active);
    if (containerId) this.panelUris.L = `docker://${containerId}/`;
    this.sendPanelData('L');
    this.sendPanelData('R');
  }

  private buildHtml(): string {
    const codiconCssPath = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css');
    const codiconFontPath = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');
    let codiconCss = '';
    try {
      codiconCss = fs.readFileSync(codiconCssPath, 'utf8');
      const fontUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(codiconFontPath));
      codiconCss = codiconCss.replace(/url\([^)]+\)/, `url('${fontUri.toString()}')`);
    } catch { /* codicons not available */ }

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>${codiconCss}
${getDualPaneFsStyles()}</style></head>
<body>
${getDualPaneFsHtml({ leftUri: this.panelUris.L, rightUri: this.panelUris.R })}
<script>${getDualPaneFsScript({})}</script>
</body></html>`;
  }

  private log(msg: string): void {
    console.log(`[dpfs] ${msg}`);
  }

  private async sendLoading(panelId: string, text: string): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({ type: 'loading', panel: panelId, text });
  }

  private async sendLoaded(): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({ type: 'loaded' });
  }

  private async sendPanelData(panelId: string): Promise<void> {
    if (!this.panel) return;
    const uri = this.panelUris[panelId];
    if (!uri) return;
    this.log(`listDir panel=${panelId} uri=${uri}`);
    await this.sendLoading(panelId, `Listing ${uri}...`);

    let rows: FsRowEx[];

    // Handle virtual root URIs
    if (uri === 'browse:///') {
      const targetMap: Record<string, string> = {
        'Local Filesystem': 'file:///',
        'Docker Containers': 'docker://',
        'SSH': 'ssh://',
        'GitHub': 'github://',
      };
      rows = this.browseRoot().map(e => this.virtualRow(e, targetMap[e.name] || uri));
    } else if (uri === 'docker://') {
      rows = this.listContainersAsEntries().map(e => {
        const cid = e.name.split(' ')[0]; // container name or ID
        return this.virtualRow(e, `docker://${cid}/`);
      });
    } else if ((uri === 'file:///' || uri.match(/^file:\/\/\/[a-z]:$/i)) && process.platform === 'win32') {
      rows = this.listDrives().map(e => {
        const driveLetter = e.name; // "c:"
        return this.virtualRow(e, `file:///${driveLetter}/`);
      });
    } else {
      rows = await this.loadProviderEntries(uri);
    }

    this.log(`  → ${rows.length} entries`);
    await this.panel.webview.postMessage({ type: 'panelData', panel: panelId, entries: rows, uri });
    this.sendLoaded();
  }

  private virtualRow(e: FsEntry, navTo: string): FsRowEx {
    return {
      id: e.isDir ? `dir:${e.name}` : `file:${e.name}`,
      name: e.name,
      isDir: e.isDir,
      sizeLabel: e.sizeLabel || '',
      modified: e.modified || '',
      mode: e.mode || '',
      _fullPath: navTo,
    };
  }

  private browseRoot(): FsEntry[] {
    return [
      { name: 'Local Filesystem', isDir: true, size: 0, sizeLabel: '-', modified: '', mode: 'drwxr-xr-x' },
      { name: 'Docker Containers', isDir: true, size: 0, sizeLabel: '-', modified: '', mode: 'drwxr-xr-x' },
      { name: 'SSH', isDir: true, size: 0, sizeLabel: '-', modified: '', mode: 'drwxr-xr-x' },
      { name: 'GitHub', isDir: true, size: 0, sizeLabel: '-', modified: '', mode: 'drwxr-xr-x' },
    ];
  }

  private listContainersAsEntries(): FsEntry[] {
    try {
      const containers = listContainers();
      return containers.map((c: any) => ({
        name: c.Names || c.ID?.substring(0, 12) || 'unknown',
        isDir: true,
        size: 0,
        sizeLabel: c.Image || '-',
        modified: c.Status || '',
        mode: c.State === 'running' ? 'drwxr-xr-x' : 'dr--r--r--',
      }));
    } catch {
      return [{ name: 'Error listing containers', isDir: false, size: 0, sizeLabel: '', modified: '', mode: '' }];
    }
  }

  private listDrives(): FsEntry[] {
    try {
      const out = cp.execSync('wmic logicaldisk get name 2>nul', { encoding: 'utf8', timeout: 5000 }).toString().trim();
      return out.split(/\r?\n/).slice(1).filter(Boolean).map(d => ({
        name: d.trim().toLowerCase(), isDir: true, size: 0, sizeLabel: 'Local Disk', modified: '', mode: 'drwxr-xr-x',
      }));
    } catch {
      return [{ name: 'c:', isDir: true, size: 0, sizeLabel: 'Local Disk', modified: '', mode: 'drwxr-xr-x' }];
    }
  }

  private async loadProviderEntries(uri: string): Promise<FsRowEx[]> {
    const resolved = this.registry.resolve(uri);
    if (!resolved) {
      this.log(`  → no provider for ${uri}`);
      return [];
    }
    try {
      const entries = resolved.listDir(uri);
      return toFsRows(entries, uri);
    } catch (e: any) {
      this.log(`  → ERROR: ${e?.message || e}`);
      return [];
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    const panel = msg.panel || 'L';
    switch (msg.command) {
      case 'navigateToUri':
        this.panelUris[panel] = normalizeUri(msg.uri);
        await this.sendPanelData(panel);
        break;
      case 'home':
        this.panelUris[panel] = this.getDefaultUri();
        await this.sendPanelData(panel);
        break;
      case 'refresh':
        await this.sendPanelData(panel);
        break;
      case 'navigate':
        this.panelUris[panel] = normalizeUri(msg.path);
        await this.sendPanelData(panel);
        break;
      case 'goBack': {
        const cur = this.panelUris[panel];
        let prev: string;
        const m = cur.match(/^([a-z][a-z0-9+.-]+):\/\/([^/]*)(\/.*)?$/);
        if (m) {
          const scheme = m[1], authority = m[2], pathPart = m[3] || '/';
          const parent = parentPath(pathPart);
          if (pathPart !== parent || authority) {
            // Not at root yet
            prev = normalizeUri(scheme + '://' + authority + parent);
          } else {
            // At scheme://authority/ (root of container FS)
            if (scheme === 'docker' && authority) {
              prev = 'docker://'; // go to container list
            } else if (scheme === 'file') {
              prev = 'browse:///';
            } else {
              prev = 'browse:///';
            }
          }
        } else {
          const p = path.dirname(cur);
          prev = p !== cur ? p : 'browse:///';
        }
        // Guard against infinite loop
        if (prev === cur) prev = 'browse:///';
        this.panelUris[panel] = prev;
        await this.sendPanelData(panel);
        break;
      }
      case 'previewFile': {
        await this.previewFile(msg.path);
        break;
      }
      case 'viewFile': {
        await this.openFileForEdit(msg.path);
        break;
      }
      case 'action': {
        this.log(`action: ${msg.action} entries=${msg.entries?.length}`);
        const action = msg.action;
        const entries: string[] = msg.entries || [];
        const sourcePanel = panel;
        const otherPanel = panel === 'L' ? 'R' : 'L';
        switch (action) {
          case 'delete':
            await this.deleteFiles(entries);
            await this.sendPanelData(sourcePanel);
            break;
          case 'copy':
          case 'move':
            if (entries.length > 0) {
              const destUri = this.panelUris[otherPanel];
              await this.copyFiles(entries, destUri);
              if (action === 'move') await this.deleteFiles(entries);
              await this.sendPanelData(sourcePanel);
              await this.sendPanelData(otherPanel);
            } else {
              vscode.window.showInformationMessage('No files selected. Select files first with Shift+Arrow.');
            }
            break;
          case 'rename':
            vscode.window.showInformationMessage('Rename not yet implemented.');
            break;
          case 'mkdir':
            vscode.window.showInformationMessage('MkDir not yet implemented.');
            break;
          case 'compare': {
            const otherEntries: string[] = msg.otherEntries || [];
            await this.compareEntries(entries, otherEntries);
            break;
          }
          case 'archive':
            vscode.window.showInformationMessage('Archive not yet implemented.');
            break;
          default:
            vscode.window.showInformationMessage(`Action: ${action}`);
        }
        break;
      }
      case 'executeFile':
      case 'sendPathToTerminal': {
        const fileUri: string = msg.path;
        if (!fileUri) break;
        const key = this.terminalKey(fileUri);
        let term = this.terminals.get(key);
        if (!term) {
          term = this.createTerminal(key, fileUri);
          this.terminals.set(key, term);
        }
        term.show();
        if (msg.command === 'executeFile') {
          term.sendText(this.runCommand(fileUri));
        } else {
          term.sendText(this.terminalPath(fileUri) + ' ');
        }
        break;
      }
    }
  }

  private async compareEntries(leftPaths: string[], rightPaths: string[]): Promise<void> {
    if (leftPaths.length === 0 || rightPaths.length === 0) {
      vscode.window.showInformationMessage('Select a file in each panel (focused or with Shift+Arrow) to compare.');
      return;
    }
    // Pair up entries: one-to-one by index
    const pairs = Math.min(leftPaths.length, rightPaths.length);
    for (let i = 0; i < pairs; i++) {
      await this.compareOne(leftPaths[i], rightPaths[i]);
    }
    if (leftPaths.length !== rightPaths.length) {
      vscode.window.showWarningMessage(
        `Compared ${pairs} pair(s). ${Math.abs(leftPaths.length - rightPaths.length)} unmatched selection(s) skipped.`);
    }
  }

  private async compareOne(leftPath: string, rightPath: string): Promise<void> {
    // Get local path for each — if remote, read content into a temp file first
    const leftLocal = await this.ensureLocalFile(leftPath);
    const rightLocal = await this.ensureLocalFile(rightPath);
    if (!leftLocal || !rightLocal) {
      vscode.window.showErrorMessage(`Could not read one or both files for comparison.`);
      return;
    }
    const leftName = leftPath.split('/').pop() || 'left';
    const rightName = rightPath.split('/').pop() || 'right';
    await vscode.commands.executeCommand('vscode.diff',
      vscode.Uri.file(leftLocal),
      vscode.Uri.file(rightLocal),
      `${leftName} ↔ ${rightName}`
    );
  }

  /** Ensure a file URI is available as a local file path. Reads remote content to temp if needed. */
  private ensureLocalFile(uri: string): string | null {
    // Local files — direct path
    if (uri.startsWith('file://')) {
      const p = toLocalPath(uri);
      try { if (fs.statSync(p).isFile()) return p; } catch {}
      return null;
    }
    // Remote files — read content via provider, write to temp
    const provider = this.registry.resolve(uri);
    if (!provider || !provider.readFile) return null;
    try {
      const content = provider.readFile(uri);
      const ext = path.extname(uri.split('/').pop() || '') || '.txt';
      const tmp = path.join(os.tmpdir(), 'dpfs-diff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext);
      fs.writeFileSync(tmp, content, 'utf8');
      return tmp;
    } catch { return null; }
  }

  private async deleteFiles(entries: string[]): Promise<void> {
    let errors: string[] = [];
    for (const fileUri of entries) {
      this.log(`delete ${fileUri}`);
      const dockerM = fileUri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
      if (dockerM) {
        try { cp.execSync(`docker exec ${dockerM[1]} sh -c "rm -rf '${dockerM[2]}'"`, { encoding: 'utf8' }); }
        catch { errors.push(fileUri); }
        continue;
      }
      const sshM = fileUri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/);
      if (sshM) {
        const user = sshM[1] || 'root', host = sshM[2];
        try { cp.execSync(`ssh ${user}@${host} "rm -rf '${sshM[4]}'"`, { encoding: 'utf8' }); }
        catch { errors.push(fileUri); }
        continue;
      }
      // Local file
      const localPath = toLocalPath(fileUri);
      try {
        if (fs.statSync(localPath).isDirectory()) {
          fs.rmSync(localPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(localPath);
        }
      } catch (e: any) {
        this.log(`delete error: ${e?.message}`);
        errors.push(fileUri);
      }
    }
    if (errors.length > 0) {
      vscode.window.showErrorMessage(`Failed to delete ${errors.length} item(s).`);
    }
  }

  private async copyFiles(sources: string[], destUri: string): Promise<void> {
    let errors: string[] = [];
    for (const srcUri of sources) {
      this.log(`copy ${srcUri} → ${destUri}`);
      const destScheme = destUri.match(/^([a-z][a-z0-9+.-]+):\/\//)?.[1] || 'file';

      // Read source content
      const provider = this.registry.resolve(srcUri);
      if (!provider || !provider.readFile) {
        this.log(`  no readFile for ${srcUri}`);
        errors.push(srcUri);
        continue;
      }
      let content: string;
      try { content = provider.readFile(srcUri); }
      catch { this.log(`  read error for ${srcUri}`); errors.push(srcUri); continue; }

      // Write to destination
      if (destScheme === 'file') {
        const destPath = toLocalPath(destUri);
        try {
          if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
          const srcName = srcUri.split('/').pop() || 'file';
          fs.writeFileSync(path.join(destPath, srcName), content, 'utf8');
        } catch (e: any) { this.log(`copy write error: ${e?.message}`); errors.push(srcUri); }
      } else if (destScheme === 'docker') {
        const dockerM = destUri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
        if (dockerM) {
          const tmp = path.join(os.tmpdir(), 'dpfs-copy-' + Date.now());
          fs.writeFileSync(tmp, content, 'utf8');
          try { cp.execSync(`docker cp "${tmp}" ${dockerM[1]}:${dockerM[2] || '/'}`, { encoding: 'utf8' }); }
          catch { errors.push(srcUri); }
          try { fs.unlinkSync(tmp); } catch {}
        }
      } else if (destScheme === 'ssh') {
        const sshM = destUri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/);
        if (sshM) {
          const user = sshM[1] || 'root', host = sshM[2], destDir = sshM[4] || '/';
          const tmp = path.join(os.tmpdir(), 'dpfs-copy-' + Date.now());
          fs.writeFileSync(tmp, content, 'utf8');
          try { cp.execSync(`scp "${tmp}" ${user}@${host}:"${destDir}/"`, { encoding: 'utf8' }); }
          catch { errors.push(srcUri); }
          try { fs.unlinkSync(tmp); } catch {}
        }
      }
    }
    if (errors.length > 0) {
      vscode.window.showErrorMessage(`Failed to copy ${errors.length} item(s).`);
    }
  }

  private terminalKey(uri: string): string {
    const m = uri.match(/^([a-z][a-z0-9+.-]+):\/\/([^/]+)?/);
    if (!m) return 'file';
    return `${m[1]}:${m[2] || ''}`;
  }

  private createTerminal(key: string, uri: string): vscode.Terminal {
    const dockerM = uri.match(/^docker:\/\/([^/]+)/);
    if (dockerM) {
      return vscode.window.createTerminal({
        name: `Container: ${dockerM[1].substring(0, 12)}`,
        shellPath: 'docker',
        shellArgs: ['exec', '-it', dockerM[1], '/bin/sh'],
      });
    }
    const sshM = uri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?/);
    if (sshM) {
      const user = sshM[1] || 'root';
      const host = sshM[2];
      return vscode.window.createTerminal({
        name: `SSH: ${user}@${host}`,
        shellPath: 'ssh',
        shellArgs: [`${user}@${host}`],
      });
    }
    // Default: local file terminal
    return vscode.window.createTerminal({ name: 'Local' });
  }

  private runCommand(uri: string): string {
    const dockerM = uri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
    if (dockerM) {
      const dir = path.dirname(dockerM[2] || '/');
      const file = path.basename(dockerM[2] || '/');
      return `cd ${dir} && ./${file}`;
    }
    const sshM = uri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (sshM) {
      const dir = path.dirname(sshM[4] || '/');
      const file = path.basename(sshM[4] || '/');
      return `cd ${dir} && ./${file}`;
    }
    // Local file
    const localPath = toLocalPath(uri);
    return `"${localPath}"`;
  }

  private terminalPath(uri: string): string {
    const dockerM = uri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
    if (dockerM) return dockerM[2] || '/';
    const sshM = uri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (sshM) return sshM[4] || '/';
    return toLocalPath(uri);
  }

  private isImageFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(ext);
  }

  /** Preview a file — uses VS Code's default open (shows image preview for images). */
  private async previewFile(fileUri: string): Promise<void> {
    if (fileUri.startsWith('file://')) {
      // Local file — use vscode.open which shows image viewer for images
      const localPath = toLocalPath(fileUri);
      if (fs.existsSync(localPath)) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(localPath));
        return;
      }
      vscode.window.showErrorMessage(`File not found: ${localPath}`);
      return;
    }
    // Remote file — read to temp, then open
    const tmpPath = this.ensureLocalFile(fileUri);
    if (!tmpPath) {
      this.log(`previewFile: cannot get local copy of ${fileUri}`);
      await this.openFileForEdit(fileUri); // fallback
      return;
    }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tmpPath));
  }

  /** Open a file for viewing/editing. Local files opened directly; remote files copied to temp with save-back. */
  private async openFileForEdit(fileUri: string): Promise<void> {
    // Local file — open directly
    if (fileUri.startsWith('file://')) {
      const localPath = toLocalPath(fileUri);
      if (!fs.existsSync(localPath)) {
        vscode.window.showErrorMessage(`File not found: ${localPath}`);
        return;
      }
      // Image files — always use preview (image viewer, not text editor)
      if (this.isImageFile(fileUri)) {
        await this.previewFile(fileUri);
        return;
      }
      // Text files — open for editing directly
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
      await vscode.window.showTextDocument(doc);
      return;
    }
    // Remote file — copy to temp, open, register save-back
    const provider = this.registry.resolve(fileUri);
    if (!provider || !provider.readFile) {
      // Fallback: try reading raw content
      await this.openUntitledFile(fileUri);
      return;
    }
    try {
      const content = provider.readFile(fileUri);
      const ext = path.extname(fileUri.split('/').pop() || '') || '.txt';
      const tmpPath = path.join(os.tmpdir(), 'dpfs-edit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext);
      fs.writeFileSync(tmpPath, content, 'utf8');
      this.tempOriginMap.set(tmpPath, fileUri);
      this.log(`opened remote file: ${fileUri} → ${tmpPath}`);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tmpPath));
      await vscode.window.showTextDocument(doc);
    } catch (e: any) {
      this.log(`openFileForEdit error: ${e?.message}`);
      await this.openUntitledFile(fileUri);
    }
  }

  /** Fallback: open content in an untitled editor (read-only, no save-back). */
  private async openUntitledFile(fileUri: string): Promise<void> {
    const provider = this.registry.resolve(fileUri);
    let content = '';
    if (provider?.readFile) {
      try { content = provider.readFile(fileUri); } catch {}
    } else {
      const localPath = toLocalPath(fileUri);
      try { content = fs.readFileSync(localPath, 'utf8'); } catch {}
    }
    if (!content) { vscode.window.showErrorMessage('Could not read file.'); return; }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({
      content: content.length > 100000 ? content.substring(0, 100000) + '\n\n... (truncated)' : content,
      language: guessLanguage(fileUri),
    }));
  }

  /** Write content back to a remote URI (docker/ssh). */
  private writeFileToUri(uri: string, content: string): void {
    this.log(`writeFileToUri ${uri}`);
    const dockerM = uri.match(/^docker:\/\/([^/]+)(\/.*)?$/);
    if (dockerM) {
      const tmp = path.join(os.tmpdir(), 'dpfs-save-' + Date.now());
      fs.writeFileSync(tmp, content, 'utf8');
      try {
        cp.execSync(`docker cp "${tmp}" ${dockerM[1]}:${dockerM[2]}`, { encoding: 'utf8' });
        this.log(`saved back to docker: ${uri}`);
      } catch (e: any) { this.log(`save-back docker error: ${e?.message}`); }
      try { fs.unlinkSync(tmp); } catch {}
      return;
    }
    const sshM = uri.match(/^ssh:\/\/(?:([^@]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (sshM) {
      const user = sshM[1] || 'root', host = sshM[2], dest = sshM[4] || '/';
      const tmp = path.join(os.tmpdir(), 'dpfs-save-' + Date.now());
      fs.writeFileSync(tmp, content, 'utf8');
      try {
        cp.execSync(`scp "${tmp}" ${user}@${host}:"${dest}"`, { encoding: 'utf8' });
        this.log(`saved back to ssh: ${uri}`);
      } catch (e: any) { this.log(`save-back ssh error: ${e?.message}`); }
      try { fs.unlinkSync(tmp); } catch {}
      return;
    }
    this.log(`writeFileToUri: no write method for ${uri}`);
  }

  dispose(): void {
    if (this.panel) { this.panel.dispose(); this.panel = undefined; }
    for (const [, term] of this.terminals) {
      try { term.dispose(); } catch { /* ignore */ }
    }
    this.terminals.clear();
  }
}
