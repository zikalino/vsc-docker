import * as vscode from 'vscode';
import * as cp from 'child_process';
import type { DockerYamlItem } from './treeProvider';
import { attachContainerTerminal } from './terminal';
import { getManagedWebviewToolbarStyles, getManagedWebviewToolbarHtml, getManagedWebviewToolbarScript } from './shared/vscode-components/common-webviews/managed-webview';

// ---------------------------------------------------------------------------
// Container/image detail actions definition
// ---------------------------------------------------------------------------

interface DetailAction { id: string; label: string; }

const ALL_CONTAINER_ACTIONS: DetailAction[] = [
  { id: 'start', label: 'Start' },
  { id: 'stop', label: 'Stop' },
  { id: 'restart', label: 'Restart' },
  { id: 'pause', label: 'Pause' },
  { id: 'unpause', label: 'Unpause' },
  { id: 'attachTerminal', label: 'Attach Terminal' },
  { id: 'execCommand', label: 'Execute Command' },
  { id: 'commit', label: 'Commit (Create Image)' },
  { id: 'export', label: 'Export to tar' },
  { id: 'browseFs', label: 'Browse Filesystem' },
  { id: 'createDockerfile', label: 'Create Dockerfile from Changes' },
  { id: 'delete', label: 'Delete' },
];

function filterContainerActions(state: string | undefined): DetailAction[] {
  if (!state) { return ALL_CONTAINER_ACTIONS; }
  return ALL_CONTAINER_ACTIONS.filter(a => {
    if (state === 'started' && a.id === 'start') { return false; }
    if (state === 'stopped' && a.id === 'stop') { return false; }
    return true;
  });
}

const imageActions: DetailAction[] = [
  { id: 'createContainer', label: 'Create Container' },
  { id: 'createDockerfile', label: 'Create Dockerfile' },
  { id: 'pull', label: 'Pull Newer Version' },
  { id: 'push', label: 'Push to Registry' },
  { id: 'save', label: 'Save to tar' },
  { id: 'delete', label: 'Delete' },
];

// ---------------------------------------------------------------------------
// Detail webview panel – shows item details with operations and tabs
// ---------------------------------------------------------------------------

export class DockerDetailPanel {
  private static instance: DockerDetailPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private extensionPath: string;
  private currentItem: DockerYamlItem | null = null;

  private constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  static getInstance(extensionPath: string): DockerDetailPanel {
    if (!DockerDetailPanel.instance) {
      DockerDetailPanel.instance = new DockerDetailPanel(extensionPath);
    }
    return DockerDetailPanel.instance;
  }

  // ---- show welcome page ------------------------------------------------

  showWelcome(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'dockerRunnerDetail',
        'Docker Runner',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), 'media'),
          ],
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentItem = null;
      });

      this.panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'createDockerfile') {
          await vscode.commands.executeCommand('vscode-docker-runner.createDockerfileFromContainerId', msg.id);
        } else if (msg.type === 'showActionsMenu') {
          this.handleActionsMenu();
        }
      });
    }

    this.panel.title = 'Docker Runner';
    this.panel.iconPath = vscode.Uri.joinPath(
      vscode.Uri.file(this.extensionPath), 'media', 'docker-runner.png'
    );
    const iconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), 'media', 'docker-runner.png')
    ).toString();
    this.panel.webview.html = this.buildHtml('welcome', undefined, undefined, undefined, undefined, undefined, undefined, undefined, iconUri);
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  // ---- show / update details for the given item -------------------------

  show(
    item: DockerYamlItem,
    rawData: any,
    fields: Record<string, string>,
    operations: any[],
    containerLogs?: string,
    containerDiff?: string,
    bashHistory?: string
  ): void {
    this.currentItem = item;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'dockerRunnerDetail',
        `Docker: ${item.name || item.id}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), 'media'),
          ],
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentItem = null;
      });

      this.panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'createDockerfile') {
          await vscode.commands.executeCommand('vscode-docker-runner.createDockerfileFromContainerId', msg.id);
        } else if (msg.type === 'showActionsMenu') {
          this.handleActionsMenu();
        }
      });
    }

    this.panel.title = `Docker: ${item.name || item.id}`;
    this.panel.iconPath = vscode.Uri.joinPath(
      vscode.Uri.file(this.extensionPath), 'media', 'docker-runner.png'
    );
    const iconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), 'media', 'docker-runner.png')
    ).toString();

    const firstTab = item.type === 'docker' ? 'welcome' : 'summary';
    this.panel.webview.html = this.buildHtml(firstTab, item, rawData, fields, operations, containerLogs, containerDiff, bashHistory, iconUri);
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  // ---- actions menu (extension host side, no roundtrip) -----------------

  private async handleActionsMenu(): Promise<void> {
    if (!this.currentItem) return;
    const isContainer = this.currentItem.type === 'docker-container';
    const actions = isContainer
      ? filterContainerActions(this.currentItem.state)
      : imageActions;
    const id = this.currentItem.id;

    const picked = await vscode.window.showQuickPick(
      actions.map(a => ({ label: a.label, actionId: a.id } as vscode.QuickPickItem & { actionId: string })),
      { placeHolder: `${this.currentItem.name || id.substring(0, 12)} — Actions` }
    );
    if (!picked) return;

    // Execute the action
    switch (picked.actionId) {
      case 'start':       cp.execSync(`docker container start ${id}`); break;
      case 'stop':        cp.execSync(`docker container stop ${id}`); break;
      case 'restart':     cp.execSync(`docker container restart ${id}`); break;
      case 'pause':       cp.execSync(`docker container pause ${id}`); break;
      case 'unpause':     cp.execSync(`docker container unpause ${id}`); break;
      case 'attachTerminal':
        attachContainerTerminal(id);
        return;
      case 'execCommand': {
        const cmd = await vscode.window.showInputBox({ prompt: 'Command to execute', value: 'bash' });
        if (cmd) cp.execSync(`docker exec -it ${id} ${cmd}`);
        return;
      }
      case 'commit':      vscode.commands.executeCommand('vscode-docker-runner.commitContainer'); return;
      case 'export':      cp.execSync(`docker container export ${id} --output ${id.substring(0, 12)}.tar`); break;
      case 'browseFs':    vscode.commands.executeCommand('vscode-docker-runner.browseContainerFilesystemById', id); return;
      case 'createDockerfile':
        if (isContainer) vscode.commands.executeCommand('vscode-docker-runner.createDockerfileFromContainerId', id);
        else vscode.commands.executeCommand('vscode-docker-runner.createDockerfileFromImageId', id);
        return;
      case 'delete':
        vscode.commands.executeCommand('vscode-docker-runner.deleteItem'); return;
      case 'createContainer': cp.execSync(`docker run -it ${id}`); break;
      case 'pull':        vscode.commands.executeCommand('vscode-docker-runner.pullImage'); return;
      case 'push':        cp.execSync(`docker image push ${id}`); break;
      case 'save':        cp.execSync(`docker image save ${id} --output ${id.substring(0, 12)}.tar`); break;
    }
    vscode.window.showInformationMessage(`Completed: ${picked.actionId} on ${id.substring(0, 12)}`);
  }

  private buildWelcomeContent(iconUri?: string): string {
    return `
  <div style="padding: 20px 40px; max-width: 720px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); line-height: 1.6;">
  <h1 style="display:flex;align-items:center;gap:16px;margin:0 0 8px 0;font-size:28px;font-weight:600;"><img src="${iconUri || 'https://docker.com/favicon.ico'}" style="width:32px;height:32px" /> Docker Runner</h1>
  <p style="font-size:15px;color:var(--vscode-descriptionForeground);margin-bottom:32px;">Manage Docker containers and images directly from VS Code — <strong>side by side with your code</strong>.</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 24px 0">
    <div style="background:var(--vscode-textBlockQuote-background);padding:14px 16px;border-radius:6px">
      <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;">📦 Image Browser</h3>
      <p style="margin:0;font-size:12px;color:var(--vscode-descriptionForeground);">Browse, inspect, pull, push, and delete images. Generate Dockerfiles from existing images.</p>
    </div>
    <div style="background:var(--vscode-textBlockQuote-background);padding:14px 16px;border-radius:6px">
      <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;">🚢 Container Manager</h3>
      <p style="margin:0;font-size:12px;color:var(--vscode-descriptionForeground);">List, start, stop, restart, pause, and delete containers. View logs, diffs, and shell history.</p>
    </div>
    <div style="background:var(--vscode-textBlockQuote-background);padding:14px 16px;border-radius:6px">
      <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;">📁 Filesystem Explorer</h3>
      <p style="margin:0;font-size:12px;color:var(--vscode-descriptionForeground);">Browse a container's filesystem, navigate directories, and view file content — all without leaving VS Code.</p>
    </div>
    <div style="background:var(--vscode-textBlockQuote-background);padding:14px 16px;border-radius:6px">
      <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;">🔍 Hub Search</h3>
      <p style="margin:0;font-size:12px;color:var(--vscode-descriptionForeground);">Search Docker Hub, inspect results, and pull images with a single click.</p>
    </div>
  </div>

  <h2 style="font-size:16px;font-weight:600;margin:28px 0 12px 0;border-bottom:1px solid var(--vscode-widget-border);padding-bottom:6px;">Quick Start</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 20px 0">
    <tr><th style="text-align:left;padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border);font-weight:600;color:var(--vscode-descriptionForeground);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Action</th><th style="text-align:left;padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border);font-weight:600;color:var(--vscode-descriptionForeground);font-size:11px;text-transform:uppercase;letter-spacing:.5px">How</th></tr>
    <tr><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Browse images / containers</td><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Click <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Docker</kbd> in the activity bar → expand the tree</td></tr>
    <tr><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">View details</td><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Click any container or image in the tree</td></tr>
    <tr><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Open table view</td><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Click <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Images</kbd> or <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Containers</kbd> in the tree</td></tr>
    <tr><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Open filesystem</td><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Right‑click a container → <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">...</kbd> → <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Browse Filesystem</kbd></td></tr>
    <tr><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Search Docker Hub</td><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)"><kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Ctrl+Shift+P</kbd> → <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Docker Runner: Search Images</kbd></td></tr>
    <tr><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)">Configure terminal mode</td><td style="padding:4px 10px;border-bottom:1px solid var(--vscode-widget-border)"><kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Ctrl+Shift+P</kbd> → <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Docker Runner: Terminal</kbd></td></tr>
  </table>

  <h2 style="font-size:16px;font-weight:600;margin:28px 0 12px 0;border-bottom:1px solid var(--vscode-widget-border);padding-bottom:6px;">Transparency &amp; Terminal Modes</h2>
  <div style="background:var(--vscode-peekViewEditorInfo-background);padding:10px 14px;border-radius:6px;font-size:13px;border-left:4px solid var(--vscode-textLink-foreground);">
    <strong>Nothing hidden.</strong> Docker Runner never runs a command you cannot see. Use the terminal mode setting to control visibility:
    <ul style="margin:4px 0 0 0;padding-left:20px;">
      <li><strong>None</strong> — all operations run silently in the background. Fastest, quietest.</li>
      <li><strong>Some</strong> (default) — user‑facing operations (pull, push, start, stop, …) execute in the <em>Docker Runner</em> terminal tab. You see every command as it runs.</li>
      <li><strong>All</strong> — every operation, including data queries, goes through the terminal. Full visibility at the cost of slight latency.</li>
    </ul>
    Run <kbd style="font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-badge-background);padding:1px 6px;border-radius:3px">Docker Runner: Terminal</kbd> from the command palette to switch modes.
  </div>

  <p style="margin-top:32px;font-size:12px;color:var(--vscode-descriptionForeground);text-align:center;">
    Docker Runner v0.50 — <a href="https://github.com/zikalino/vsc-docker" style="color:var(--vscode-textLink-foreground);">GitHub</a>
  </p>
  </div>`;
  }

  private buildHtml(
    activeTab: string,
    item?: DockerYamlItem,
    rawData?: any,
    fields?: Record<string, string>,
    operations?: any[],
    containerLogs?: string,
    containerDiff?: string,
    bashHistory?: string,
    iconUri?: string
  ): string {
    const isContainer = item?.type === 'docker-container';
    const rawJson = rawData ? JSON.stringify(rawData, null, 2) : '';

    // --- Tabs: Welcome for overview (no item) and root Docker item ---
    const tabs: string[] = [];
    if (!item || item.type === 'docker') { tabs.push('welcome'); }
    tabs.push('summary', 'inspect');
    if (isContainer) { tabs.push('ports', 'env', 'mounts', 'history'); }

    // Welcome tab content
    const welcomeHtml = this.buildWelcomeContent(iconUri);

    // --- Summary tab ---
    let fieldsHtml = '';
    for (const [key, value] of Object.entries(fields ?? {})) {
      fieldsHtml += `
        <div class="field-row">
          <span class="field-label">${this.escapeHtml(key)}</span>
          <span class="field-value">${this.escapeHtml(String(value))}</span>
        </div>`;
    }

    // --- Ports tab ---
    let portsHtml = '';
    if (isContainer && rawData) {
      const networkSettings = rawData.NetworkSettings || rawData.HostConfig || {};
      const portMap: Record<string, any[]> = networkSettings.PortBindings || {};
      if (Object.keys(portMap).length > 0) {
        portsHtml = '<table class="data-table"><tr><th>Container Port</th><th>Host IP</th><th>Host Port</th></tr>';
        for (const [containerPort, bindings] of Object.entries(portMap)) {
          if (Array.isArray(bindings)) {
            for (const b of bindings) {
              portsHtml += `<tr><td>${this.escapeHtml(containerPort)}</td><td>${this.escapeHtml(b.HostIp || '0.0.0.0')}</td><td>${this.escapeHtml(b.HostPort || '')}</td></tr>`;
            }
          }
        }
        portsHtml += '</table>';
      } else {
        portsHtml = '<p class="muted">No port bindings configured.</p>';
      }
    }

    // --- Environment tab ---
    let envHtml = '';
    if (isContainer && rawData) {
      const config = rawData.Config || {};
      const env = config.Env || [];
      if (env.length > 0) {
        envHtml = '<table class="data-table"><tr><th>Variable</th><th>Value</th></tr>';
        for (const e of env) {
          const eqIdx = e.indexOf('=');
          if (eqIdx > 0) {
            envHtml += `<tr><td>${this.escapeHtml(e.substring(0, eqIdx))}</td><td>${this.escapeHtml(e.substring(eqIdx + 1))}</td></tr>`;
          } else {
            envHtml += `<tr><td>${this.escapeHtml(e)}</td><td></td></tr>`;
          }
        }
        envHtml += '</table>';
      } else {
        envHtml = '<p class="muted">No environment variables.</p>';
      }
    }

    // --- Mounts tab ---
    let mountsHtml = '';
    if (isContainer && rawData) {
      const mounts = rawData.Mounts || [];
      if (mounts.length > 0) {
        mountsHtml = '<table class="data-table"><tr><th>Type</th><th>Source</th><th>Destination</th><th>Mode</th></tr>';
        for (const m of mounts) {
          mountsHtml += `<tr><td>${this.escapeHtml(m.Type || '')}</td><td>${this.escapeHtml(m.Source || '')}</td><td>${this.escapeHtml(m.Destination || '')}</td><td>${this.escapeHtml(m.Mode || '')}</td></tr>`;
        }
        mountsHtml += '</table>';
      } else {
        mountsHtml = '<p class="muted">No mounts configured.</p>';
      }
    }

    // --- Inspect tab ---
    const inspectHtml = rawJson
      ? `<pre class="code-block">${this.escapeHtml(rawJson)}</pre>`
      : '<p class="muted">No raw data available.</p>';

    const toolbarActions = item?.type === 'docker-container'
      ? filterContainerActions(item.state)
      : (item?.type === 'docker-image' ? imageActions : []);
    const toolbarHtml = getManagedWebviewToolbarHtml({
      titleHtml: item ? this.escapeHtml(item.name || item.id || '') : 'Docker Runner',
      actions: toolbarActions.map(a => ({ id: a.id, label: a.label })),
    });
    const toolbarScript = getManagedWebviewToolbarScript({ reloadHandler: '0' });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { --border: var(--vscode-widget-border, #ccc); --bg: var(--vscode-editor-background, #fff); }
  body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--vscode-foreground); background: var(--bg); }
  ${getManagedWebviewToolbarStyles()}

  /* ── Tab bar ── */
  .tab-bar { display: flex; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
  .tab-btn { padding: 8px 16px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid transparent; }
  .tab-btn:hover { background: var(--vscode-list-hoverBackground); }
  .tab-btn.active { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-textLink-foreground); }
  .tab-content { display: none; padding: 16px; }
  .tab-content.active { display: block; }

  /* ── Sections ── */
  .section { margin-bottom: 16px; }
  .section-title { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--vscode-textLink-foreground); margin-bottom: 6px; padding-bottom: 2px; border-bottom: 1px solid var(--border); }

  /* ── Fields ── */
  .field-row { display: flex; padding: 2px 0; font-size: 13px; }
  .field-label { width: 140px; font-weight: 500; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
  .field-value { flex: 1; word-break: break-all; }

  /* ── Buttons ── */
  .op-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; margin: 3px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .op-btn:hover { background: var(--vscode-button-hoverBackground); }
  .op-btn.danger { background: var(--vscode-errorForeground, #e00); }
  .op-btn.danger:hover { opacity: 0.8; }

  /* ── Tables ── */
  .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .data-table th, .data-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .data-table th { font-weight: 600; color: var(--vscode-descriptionForeground); }

  /* ── Code block ── */
  .code-block { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 3px; overflow-x: auto; font-size: 11px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }

  /* ── Misc ── */
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
</style>
</head>
<body>

${toolbarHtml}

<div class="tab-bar" id="tabBar">
  ${tabs.map(t => `<button class="tab-btn${t === activeTab ? ' active' : ''}" data-tab="${t}">${t}</button>`).join('')}
</div>

<!-- Welcome -->
<div class="tab-content${activeTab === 'welcome' ? ' active' : ''}" id="tab-welcome">
  ${welcomeHtml}
</div>

<!-- Summary -->
<div class="tab-content${activeTab === 'summary' ? ' active' : ''}" id="tab-summary">
  ${item?.description ? `<p style="margin:0 0 12px;font-size:13px">${this.escapeHtml(item.description)}</p>` : ''}

  ${fieldsHtml ? `
  <div class="section">
    <div class="section-title">Properties</div>
    ${fieldsHtml}
  </div>` : ''}
</div>

<!-- Inspect -->
<div class="tab-content${activeTab === 'inspect' ? ' active' : ''}" id="tab-inspect">
  <div class="section-title" style="margin-bottom:8px">Raw Docker Inspect</div>
  ${inspectHtml}
</div>

<!-- Ports (containers only) -->
${isContainer ? `
<div class="tab-content" id="tab-ports">
  <div class="section-title" style="margin-bottom:8px">Port Bindings</div>
  ${portsHtml}
</div>` : ''}

<!-- Environment (containers only) -->
${isContainer ? `
<div class="tab-content" id="tab-env">
  <div class="section-title" style="margin-bottom:8px">Environment Variables</div>
  ${envHtml}
</div>` : ''}

<!-- Mounts (containers only) -->
${isContainer ? `
<div class="tab-content" id="tab-mounts">
  <div class="section-title" style="margin-bottom:8px">Mounts / Volumes</div>
  ${mountsHtml}
</div>` : ''}

<!-- History (containers only) -->
${isContainer && (containerLogs || containerDiff || bashHistory) ? `
<div class="tab-content" id="tab-history">

  <div class="section" style="margin-bottom:20px">
    <div class="section-title">Recent Logs (last 50 lines)</div>
    <pre class="code-block" style="max-height:300px;overflow-y:auto">${containerLogs ? this.escapeHtml(containerLogs) : '(no logs)'}</pre>
  </div>

  <div class="section" style="margin-bottom:20px">
    <div class="section-title">Files Changed (docker diff)
      <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--vscode-descriptionForeground)">  A=Added C=Changed D=Deleted</span>
    </div>
    <pre class="code-block" style="max-height:200px;overflow-y:auto">${containerDiff ? this.escapeHtml(containerDiff) : '(no changes)'}</pre>
  </div>

  <div class="section" style="margin-bottom:20px">
    <div class="section-title">Command History (from shell)</div>
    <pre class="code-block" style="max-height:200px;overflow-y:auto">${bashHistory ? this.escapeHtml(bashHistory) : '(no history)'}</pre>
  </div>

  <div class="section">
    <button class="op-btn" onclick="vscode.postMessage({command:'createDockerfile',id:'${item?.id || ''}'})" style="font-size:13px;padding:8px 18px">
      📄 Create Dockerfile from Changes
    </button>
    <p class="muted" style="margin-top:6px">Commits this container to a temporary image and generates a Dockerfile approximation from its history + changes.</p>
  </div>

</div>` : ''}

<script>
  (function() {
    const vscode = acquireVsCodeApi();
    ${toolbarScript}

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById('tab-' + btn.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    });
  })();
</script>
</body>
</html>`;
  }

  // ---- helpers ----------------------------------------------------------

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private getOpIcon(type: string): string {
    const icons: Record<string, string> = {
      start: '\u25B6',
      stop: '\u23F9',
      restart: '\uD83D\uDD04',
      pause: '\u23F8',
      unpause: '\u25B6',
      delete: '\uD83D\uDDD1',
      pull: '\uD83D\uDCE5',
      push: '\uD83D\uDCE4',
      save: '\uD83D\uDCBE',
      terminal: '\uD83D\uDCBB',
      run: '\u26A1',
      commit: '\uD83D\uDCDD',
      load: '\uD83D\uDCC2',
      'create': '\u2795',
    };
    return icons[type] || '\u2699';
  }

  private replaceParams(cmd: string, item: DockerYamlItem): string {
    const regex = /\${([a-zA-Z0-9_-]*)}/;
    let result = cmd;
    let match: RegExpExecArray | null;
    do {
      match = regex.exec(result);
      if (match) {
        const key = match[1];
        const value = key in item ? String(item[key]) : 'unknown';
        result = result.replace('${' + key + '}', value);
      }
    } while (match);
    return result;
  }
}

