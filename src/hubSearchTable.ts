import * as vscode from 'vscode';
import * as cp from 'child_process';
import { createManagedWebviewPanel } from './shared/vscode-components/common-webviews/managed-webview';
import { getManagedTableStyles, getManagedTableHtml, getManagedTableScript } from './shared/vscode-components/common-webviews/managed-table';
import type { ManagedTableColumn, ManagedTableAction, ManagedTableRow } from './shared/vscode-components/common-webviews/managed-table';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(cmd: string): string {
  try {
    const shell = process.platform === 'win32' ? 'powershell' : '/bin/bash';
    return cp.execSync(cmd, { shell, encoding: 'utf8' }).toString().trim();
  } catch (e: any) {
    if (e?.stdout) { return e.stdout.toString().trim(); }
    return '';
  }
}

function execRows(cmd: string): any[] {
  const out = exec(cmd);
  if (!out) return [];
  return out.split(/\r?\n/).filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Columns & Actions
// ---------------------------------------------------------------------------

const hubColumns: ManagedTableColumn[] = [
  { id: 'name', label: 'Name', clickable: true },
  { id: 'description', label: 'Description' },
  { id: 'stars', label: 'Stars', width: '80px', align: 'right' },
  { id: 'official', label: 'Official', width: '80px' },
  { id: 'sel', label: '', selectAll: true, align: 'center', width: '40px' },
];

const hubActions: ManagedTableAction[] = [
  { id: 'pullSelected', label: 'Pull Selected' },
  { id: 'pullAll', label: 'Pull All' },
];

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function searchHub(query: string): ManagedTableRow[] {
  const rawRows = execRows(`docker search ${query} --format json --limit 50`);
  return rawRows.map((r: any, idx: number) => ({
    id: r.Name || `result-${idx}`,
    cells: {
      name: r.Name || '',
      description: (r.Description || '').substring(0, 80),
      stars: String(r.StarCount || 0),
      official: r.IsOfficial === 'true' ? 'Yes' : '',
    },
    meta: { raw: r },
  }));
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let lastHubPanel: vscode.WebviewPanel | undefined;

function clearHubPanel() { lastHubPanel = undefined; }

// ---------------------------------------------------------------------------
// Panel creation
// ---------------------------------------------------------------------------

export function openHubSearch(extensionPath: string, initialQuery?: string): void {
  if (lastHubPanel) {
    try { lastHubPanel.reveal(vscode.ViewColumn.Active); return; } catch { lastHubPanel = undefined; }
  }

  const { panel, isDisposed, postMessage } = createManagedWebviewPanel({
    viewType: 'dockerHubSearch',
    title: 'Docker Hub Search',
    column: vscode.ViewColumn.Active,
    onMessage: async (message: any) => {
      if (message.type === 'showActionsMenu') {
        const items = hubActions.map(a => ({ label: a.label, actionId: a.id } as vscode.QuickPickItem & { actionId: string }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select action' });
        if (picked && !isDisposed()) {
          await postMessage({ type: 'actionSelected', actionId: picked.actionId });
        }
        return;
      }
      if (message.type === 'search') {
        const query = (message.query || '').trim();
        if (!query) { return; }
        const rows = searchHub(query);
        if (!isDisposed()) {
          await postMessage({ type: 'searchResults', rows, status: `${rows.length} results for '${escapeHtml(query)}'` });
        }
        return;
      }
      if (message.type === 'actionSelected') {
        const selectedIds = message.selectedIds || [];
        if (message.actionId === 'pullSelected') {
          for (const id of selectedIds) {
            await pullImage(id);
          }
        }
        return;
      }
      if (message.type === 'rowClicked') {
        const rowId = message.rowId || '';
        if (!rowId) { return; }
        const picked = await vscode.window.showQuickPick(
          [{ label: '$(cloud-download) Pull Image', actionId: 'pull' } as vscode.QuickPickItem & { actionId: string }],
          { placeHolder: `${rowId}` }
        );
        if (picked && !isDisposed()) {
          await pullImage(rowId);
        }
        return;
      }
    },
    onDispose: () => {},
  });

  lastHubPanel = panel;
  panel.onDidDispose(clearHubPanel);
  panel.webview.html = buildHubHtml(initialQuery);
}

import { pullImageAsync } from './dockerApi';
import { refreshImageTable } from './tableViewImages';

async function pullImage(name: string): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Pulling ${name}...` },
    async () => {
      await pullImageAsync(name);
    }
  );
  vscode.window.showInformationMessage(`Pulled ${name}`);
  // Refresh tree and images table after successful pull
  vscode.commands.executeCommand('vscode-docker-runner.refresh');
  refreshImageTable();
}

function buildHubHtml(initialQuery?: string): string {
  const safeQuery = initialQuery ? escapeHtml(initialQuery) : '';

  // Pre-compute managed table script to avoid nested template issue
  const tableScript = getManagedTableScript({
    reloadHandler: '0',
    reloadButtonId: 'dummyReloadBtn',
    tableBodyId: 'hubBody',
    actionsButtonId: 'hubActionsBtn',
    statusId: 'hubStatus',
    actionsMenuId: 'hubActionsMenu',
    columns: hubColumns,
  });

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  html,body { height:100%; margin:0; padding:0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display:flex; flex-direction:column; overflow:hidden; }
  ${getManagedTableStyles()}

  .search-toolbar { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--vscode-sideBar-background); border-bottom:1px solid var(--vscode-widget-border); flex-shrink:0; }
  .search-input { flex:1; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); padding:5px 8px; border-radius:4px; font-size:13px; }
  .search-input:focus { outline:none; border-color:var(--vscode-focusBorder); }
  .search-btn { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:4px; padding:5px 16px; cursor:pointer; font-size:13px; }
  .search-btn:hover { background:var(--vscode-button-hoverBackground); }
  .search-btn:disabled { opacity:0.5; cursor:default; }

  .managed-table-container tbody tr:hover td,
  .managed-table-container tbody tr.clickable:hover td { background:var(--vscode-input-background) !important; }
</style></head>
<body>

<div class="search-toolbar">
  <input id="searchInput" class="search-input" type="text" placeholder="Search Docker Hub (e.g. nginx, ubuntu, python)..." value="${safeQuery}" />
  <button id="searchBtn" class="search-btn">Search</button>
</div>

${getManagedTableHtml({
  columns: hubColumns,
  title: 'Search Results',
  titleId: 'hubTitle',
  tableId: 'hubTable',
  bodyId: 'hubBody',
  showTextFilter: false,
  actions: hubActions,
  reloadButtonId: 'hubReloadBtn',
  actionsButtonId: 'hubActionsBtn',
  actionsMenuId: 'hubActionsMenu',
  statusId: 'hubStatus',
})}

<script>
(function() {
  const vscode = acquireVsCodeApi();
  ${tableScript}
  const api = window.__managedTableApi;

  api.setStatus('Enter a search query above');

  var lastResults = [];

  function doSearch() {
    var query = document.getElementById('searchInput').value;
    if (!query.trim()) return;
    api.setRefreshing(true);
    vscode.postMessage({ type: 'search', query: query.trim() });
  }

  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { doSearch(); }
  });

  api.onRowClick(function(rowId) {
    vscode.postMessage({ type: 'rowClicked', rowId: rowId });
  });

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'searchResults') {
      lastResults = msg.rows || [];
      api.setRows(lastResults);
      api.setStatus(msg.status || '');
      api.setRefreshing(false);
      api.setActionsEnabled(lastResults.length > 0);
    }
    if (msg.type === 'actionSelected') {
      var ids = api.getSelectedRowIds();
      if (msg.actionId === 'pullAll') {
        ids = lastResults.map(function(r) { return r.id; });
      }
      vscode.postMessage({ type: 'actionSelected', actionId: msg.actionId, selectedIds: ids });
    }
  });

  // Auto-search if query was pre-filled
  if ('${safeQuery}') { doSearch(); }
})();
</script>
</body></html>`;
}
