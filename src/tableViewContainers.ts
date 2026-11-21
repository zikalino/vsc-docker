import * as vscode from 'vscode';
import { createManagedWebviewPanel } from './shared/vscode-components/common-webviews/managed-webview';
import { getManagedTableStyles, getManagedTableHtml, getManagedTableScript } from './shared/vscode-components/common-webviews/managed-table';
import type { ManagedTableColumn, ManagedTableAction, ManagedTableRow } from './shared/vscode-components/common-webviews/managed-table';
import { execRows, shortId, startContainerAsync, stopContainerAsync, restartContainerAsync, pauseContainerAsync, unpauseContainerAsync, removeContainerAsync, exportContainerAsync, pruneContainersAsync } from './dockerApi';

async function showActionsMenu(
  actions: ManagedTableAction[],
  isDisposed: () => boolean,
  postMsg: (msg: any) => Promise<void>
): Promise<void> {
  const items = actions.map(a => ({ label: a.label, actionId: a.id } as vscode.QuickPickItem & { actionId: string }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select action' });
  if (picked && !isDisposed()) {
    await postMsg({ type: 'actionSelected', actionId: picked.actionId });
  }
}

// ---------------------------------------------------------------------------
// Columns & Actions
// ---------------------------------------------------------------------------

const containerColumns: ManagedTableColumn[] = [
  { id: 'name', label: 'Name', clickable: true },
  { id: 'image', label: 'Image' },
  {
    id: 'status',
    label: 'Status',
    type: 'badge',
    badgeClassMap: {
      running: 'managed-badge-running',
      exited: 'managed-badge-fail',
      paused: 'managed-badge-warn',
      created: 'managed-badge-idle',
      restarting: 'managed-badge-waiting',
      removing: 'managed-badge-waiting',
      dead: 'managed-badge-fail',
    },
  },
  { id: 'containerId', label: 'Container ID', width: '120px' },
  { id: 'ports', label: 'Ports' },
  { id: 'created', label: 'Created', width: '160px' },
  { id: 'sel', label: '', selectAll: true, align: 'center', width: '40px' },
];

const containerActions: ManagedTableAction[] = [
  { id: 'start', label: 'Start Selected' },
  { id: 'stop', label: 'Stop Selected' },
  { id: 'restart', label: 'Restart Selected' },
  { id: 'pause', label: 'Pause Selected' },
  { id: 'unpause', label: 'Unpause Selected' },
  { id: 'delete', label: 'Delete Selected' },
  { id: 'prune', label: 'Prune Stopped Containers' },
  { id: 'export', label: 'Export Selected to tar' },
];

// ---------------------------------------------------------------------------
// Data fetching (runs in extension host, synchronous)
// ---------------------------------------------------------------------------

function fetchContainerRows(): ManagedTableRow[] {
  const rawRows = execRows('docker ps --all --format json');
  return rawRows.map((r: any, idx: number) => {
    let created = r.CreatedAt || r.createdAt || '';
    if (created) {
      try {
        const cleaned = created.replace(/ [A-Z]+$/, '').replace(/\+(\d{4})/, 'T$1:00');
        const d = new Date(cleaned);
        if (!isNaN(d.getTime())) created = d.toLocaleString();
      } catch { /* keep raw */ }
    }
    return {
      id: r.ID || `ct-${idx}`,
      cells: {
        name: (r.Names || '').replace(/^\//, ''),
        image: r.Image || '',
        status: r.State || 'unknown',
        containerId: shortId(r.ID),
        ports: r.Ports || '-',
        created,
      },
      meta: { raw: r },
    };
  });
}

let lastContainerPanel: vscode.WebviewPanel | undefined;

function clearContainerPanel() { lastContainerPanel = undefined; }

// ---------------------------------------------------------------------------
// Panel creation
// ---------------------------------------------------------------------------

export function openContainerTable(extensionPath: string): void {
  if (lastContainerPanel) {
    try { lastContainerPanel.reveal(vscode.ViewColumn.Active); return; } catch { lastContainerPanel = undefined; }
  }

  const initialRows = fetchContainerRows();

  const { panel, isDisposed, postMessage } = createManagedWebviewPanel({
    viewType: 'dockerContainerTable',
    title: 'Docker Containers',
    column: vscode.ViewColumn.Active,
    onMessage: async (message: any) => {
      if (message.type === 'showActionsMenu') {
        await showActionsMenu(containerActions, isDisposed, postMessage);
        return;
      }
      if (message.type === 'loadContainers' || message.type === 'reload') {
        const rows = fetchContainerRows();
        if (!isDisposed()) {
          await postMessage({ type: 'containerData', rows, status: `${rows.length} containers` });
        }
        return;
      }
      if (message.type === 'rowClicked') {
        const rowId = message.rowId || '';
        if (!rowId) { return; }
        const actionItems = [
          { id: 'viewDetails', label: 'View Details' },
          { id: 'attachTerminal', label: 'Attach Terminal' },
          { id: 'start', label: 'Start' },
          { id: 'stop', label: 'Stop' },
          { id: 'restart', label: 'Restart' },
          { id: 'pause', label: 'Pause' },
          { id: 'unpause', label: 'Unpause' },
          { id: 'browseFs', label: 'Browse Filesystem' },
          { id: 'createDockerfile', label: 'Create Dockerfile' },
          { id: 'delete', label: 'Delete' },
        ].map(a => ({ label: a.label, actionId: a.id } as vscode.QuickPickItem & { actionId: string }));
        const picked = await vscode.window.showQuickPick(actionItems, { placeHolder: `Actions for ${rowId.substring(0, 12)}` });
        if (picked && !isDisposed()) {
          await handleContainerAction(picked.actionId, [rowId], isDisposed, postMessage);
        }
        return;
      }
      if (message.type === 'actionSelected') {
        const selectedIds = message.selectedIds || [];
        await handleContainerAction(message.actionId, selectedIds, isDisposed, postMessage);
        return;
      }
    },
    onDispose: () => {},
  });

  lastContainerPanel = panel;
  panel.onDidDispose(clearContainerPanel);
  panel.webview.html = buildContainerHtml(initialRows);
}

function buildContainerHtml(initialRows: ManagedTableRow[]): string {
  const initialDataJson = JSON.stringify(initialRows);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  html,body { height:100%; margin:0; padding:0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display:flex; flex-direction:column; overflow:hidden; }
  ${getManagedTableStyles()}
  .managed-table-container tbody tr:hover td,
  .managed-table-container tbody tr.clickable:hover td { background: var(--vscode-input-background) !important; }
</style></head>
<body>
${getManagedTableHtml({
  columns: containerColumns,
  title: 'Docker Containers',
  titleId: 'containersTitle',
  tableId: 'containersTable',
  bodyId: 'containersBody',
  showTextFilter: true,
  filterPlaceholder: 'Filter containers...',
  filterId: 'containerFilter',
  actions: containerActions,
  reloadButtonId: 'containerReloadBtn',
  actionsButtonId: 'containerActionsBtn',
  actionsMenuId: 'containerActionsMenu',
  statusId: 'containerStatus',
})}
<script>
(function() {
  const vscode = acquireVsCodeApi();
  ${getManagedTableScript({ reloadHandler: '0', reloadButtonId: 'dummyReloadBtn', tableBodyId: 'containersBody', actionsButtonId: 'containerActionsBtn', statusId: 'containerStatus', actionsMenuId: 'containerActionsMenu', columns: containerColumns })}
  const api = window.__managedTableApi;

  // Render initial data immediately (embedded in HTML)
  var initialData = ${initialDataJson};
  api.setRows(initialData);
  api.setStatus(initialData.length + ' containers');
  api.setActionsEnabled(initialData.length > 0);

  // Reload: post to extension host
  document.getElementById('containerReloadBtn').addEventListener('click', function() {
    api.setRefreshing(true);
    vscode.postMessage({ type: 'loadContainers' });
  });

  // Row click: show single-item actions
  api.onRowClick(function(rowId) {
    vscode.postMessage({ type: 'rowClicked', rowId: rowId });
  });

  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'containerData') {
      api.setRows(msg.rows || []);
      api.setStatus(msg.status || '');
      api.setRefreshing(false);
      api.setActionsEnabled(msg.rows && msg.rows.length > 0);
    }
    if (msg.type === 'actionSelected') {
      const ids = api.getSelectedRowIds();
      vscode.postMessage({ type: 'actionSelected', actionId: msg.actionId, selectedIds: ids });
    }
    // rowClicked is handled entirely in the extension host
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleContainerAction(
  actionId: string,
  selectedIds: string[],
  isDisposed: () => boolean,
  postMsg: (msg: any) => Promise<void>
): Promise<void> {
  switch (actionId) {
    case 'viewDetails':
      for (const id of selectedIds) { vscode.commands.executeCommand('vscode-docker-runner.openContainerDetailById', id); }
      return;
    case 'attachTerminal':
      for (const id of selectedIds) { vscode.commands.executeCommand('vscode-docker-runner.attachContainerTerminal', id); }
      return;
    case 'browseFs':
      for (const id of selectedIds) { vscode.commands.executeCommand('vscode-docker-runner.browseContainerFilesystemById', id); }
      return; // no refresh needed
    case 'createDockerfile':
      for (const id of selectedIds) { vscode.commands.executeCommand('vscode-docker-runner.createDockerfileFromContainerId', id); }
      return; // no refresh needed
    case 'prune':
      await pruneContainersAsync();
      break;
    case 'delete': {
      if (selectedIds.length === 0) { return; }
      const confirmed = await vscode.window.showWarningMessage(`Delete ${selectedIds.length} container(s)?`, { modal: true }, 'Delete');
      if (confirmed !== 'Delete') { return; }
      for (const id of selectedIds) { await removeContainerAsync(id); }
      break;
    }
    case 'start':
      for (const id of selectedIds) { await startContainerAsync(id); }
      break;
    case 'stop':
      for (const id of selectedIds) { await stopContainerAsync(id); }
      break;
    case 'restart':
      for (const id of selectedIds) { await restartContainerAsync(id); }
      break;
    case 'pause':
      for (const id of selectedIds) { await pauseContainerAsync(id); }
      break;
    case 'unpause':
      for (const id of selectedIds) { await unpauseContainerAsync(id); }
      break;
    case 'export':
      for (const id of selectedIds) { await exportContainerAsync(id, shortId(id) + '.tar'); }
      return; // no refresh needed for export
  }

  // Refresh after action
  if (!isDisposed()) {
    const rows = fetchContainerRows();
    await postMsg({ type: 'containerData', rows, status: `${rows.length} containers` });
  }
}
