import * as vscode from 'vscode';

export type ManagedWebviewMessageHandler = (
  message: unknown,
  api: {
    panel: vscode.WebviewPanel;
    isDisposed: () => boolean;
    postMessage: (message: unknown) => Promise<void>;
  }
) => Promise<void>;

export interface ManagedWebviewOptions {
  viewType: string;
  title: string;
  column?: vscode.ViewColumn;
  retainContextWhenHidden?: boolean;
  enableScripts?: boolean;
  onMessage?: ManagedWebviewMessageHandler;
  onDispose?: () => void;
}

export function createManagedWebviewPanel(options: ManagedWebviewOptions): {
  panel: vscode.WebviewPanel;
  isDisposed: () => boolean;
  postMessage: (message: unknown) => Promise<void>;
} {
  const panel = vscode.window.createWebviewPanel(
    options.viewType,
    options.title,
    options.column ?? vscode.ViewColumn.Active,
    {
      enableScripts: options.enableScripts ?? true,
      retainContextWhenHidden: options.retainContextWhenHidden ?? true,
      enableFindWidget: true,
    }
  );

  let disposed = false;

  const isDisposed = (): boolean => disposed;

  const postMessage = async (message: unknown): Promise<void> => {
    if (!disposed) {
      await panel.webview.postMessage(message);
    }
  };

  const messageSubscription = options.onMessage
    ? panel.webview.onDidReceiveMessage(async message => {
        await options.onMessage!(message, { panel, isDisposed, postMessage });
      })
    : undefined;

  panel.onDidDispose(() => {
    disposed = true;
    messageSubscription?.dispose();
    options.onDispose?.();
  });

  return { panel, isDisposed, postMessage };
}

/**
 * Returns CSS for the standard webview header toolbar including actions and reload buttons.
 * The rotating reload icon matches the pattern used in workflow-execution-plan steps.
 */
export function getManagedWebviewToolbarStyles(): string {
  return `
    .managed-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .managed-toolbar-title {
      flex: 1;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .managed-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      flex-shrink: 0;
    }
    .managed-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 4px;
      padding: 3px 7px;
      font-size: 13px;
      line-height: 1.4;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .managed-btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-panel-border);
    }
    .managed-reload-btn {
      min-width: 26px;
      font-size: 16px;
    }
    .managed-reload-btn.refreshing .reload-icon {
      display: inline-block;
      animation: managed-spin 0.8s linear infinite;
    }
    @keyframes managed-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .managed-actions-btn {
      font-weight: 700;
      letter-spacing: 0.05em;
    }
  `;
}

export interface ManagedWebviewToolbarAction {
  id: string;
  label: string;
}

/**
 * Returns HTML for the standard webview toolbar with an optional actions menu and reload button.
 * Relies on CSS from getManagedWebviewToolbarStyles().
 *
 * Usage in webview scripts:
 *   - Send `{ type: 'reload' }` message from reload button click handler
 *   - Listen for `managedToolbarAction` events on the toolbar container
 */
export function getManagedWebviewToolbarHtml(options: {
  titleHtml?: string;
  actions?: ManagedWebviewToolbarAction[];
  showReloadButton?: boolean;
  reloadButtonId?: string;
  actionsButtonId?: string;
  actionsMenuId?: string;
  extraActionsHtml?: string;
}): string {
  const {
    titleHtml = '',
    actions = [],
    showReloadButton = true,
    reloadButtonId = 'managedReloadBtn',
    actionsButtonId = 'managedActionsBtn',
    extraActionsHtml = '',
  } = options;

  const reloadHtml = showReloadButton
    ? `<button id="${reloadButtonId}" class="managed-btn managed-reload-btn" title="Reload" type="button"><span class="reload-icon">↻</span></button>`
    : '';

  const actionsButtonHtml = actions.length > 0
    ? `<button id="${actionsButtonId}" class="managed-btn managed-actions-btn" title="Actions" type="button" data-actions="${actions.map(a => `${a.id}:${a.label}`).join('|')}">···</button>`
    : '';

  return `<div class="managed-toolbar">
    ${titleHtml ? `<span class="managed-toolbar-title">${titleHtml}</span>` : ''}
    <div class="managed-toolbar-actions">
      ${extraActionsHtml}
      ${reloadHtml}
      ${actionsButtonHtml}
    </div>
  </div>`;
}

/**
 * Returns a JavaScript snippet that wires up the standard toolbar behavior
 * (reload button spinning state, actions button posting to VS Code for quick pick).
 *
 * When the actions button is clicked, it posts { type: 'showActionsMenu', actions: [...] }
 * to the extension host, which should respond with { type: 'actionSelected', actionId: '...' }
 * using the handleActionsMenuMessage() helper.
 *
 * @param reloadHandler - JS expression called when reload is triggered (e.g. 'load()')
 */
export function getManagedWebviewToolbarScript(options: {
  reloadHandler: string;
  reloadButtonId?: string;
  actionsButtonId?: string;
  actionsMenuId?: string;
}): string {
  const {
    reloadHandler,
    reloadButtonId = 'managedReloadBtn',
    actionsButtonId = 'managedActionsBtn',
  } = options;

  return `
    (function() {
      var reloadBtn = document.getElementById('${reloadButtonId}');
      var actionsBtn = document.getElementById('${actionsButtonId}');
      var actionHandlers = [];

      function setRefreshing(active) {
        if (!reloadBtn) { return; }
        if (active) {
          reloadBtn.classList.add('refreshing');
          reloadBtn.disabled = true;
        } else {
          reloadBtn.classList.remove('refreshing');
          reloadBtn.disabled = false;
        }
      }

      if (reloadBtn) {
        reloadBtn.addEventListener('click', function() {
          setRefreshing(true);
          ${reloadHandler};
        });
      }

      if (actionsBtn) {
        actionsBtn.addEventListener('click', function() {
          var raw = actionsBtn.getAttribute('data-actions') || '';
          var actions = raw ? raw.split('|').map(function(entry) {
            var idx = entry.indexOf(':');
            return idx < 0 ? { id: entry, label: entry } : { id: entry.slice(0, idx), label: entry.slice(idx + 1) };
          }) : [];
          vscode.postMessage({ type: 'showActionsMenu', actions: actions });
        });
      }

      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg && msg.type === 'actionSelected') {
          actionHandlers.forEach(function(handler) {
            try { handler(String(msg.actionId || '')); } catch (_e) {}
          });
        }
      });

      window.__managedSetRefreshing = setRefreshing;
      window.__managedToolbarApi = {
        setRefreshing: setRefreshing,
        onAction: function(handler) {
          if (typeof handler === 'function') { actionHandlers.push(handler); }
        },
      };
    })();
  `;
}

/**
 * Extension-side helper: intercepts 'showActionsMenu' messages from the webview,
 * displays a VS Code QuickPick with the provided actions, and posts the selected
 * action back to the webview as { type: 'actionSelected', actionId }.
 *
 * Typical usage inside a panel.webview.onDidReceiveMessage handler:
 *
 *   if (await handleActionsMenuMessage(message, panel)) { return; }
 *
 * Returns true if the message was a 'showActionsMenu' request (and was handled),
 * false otherwise.
 */
export async function handleActionsMenuMessage(
  message: unknown,
  panel: vscode.WebviewPanel
): Promise<boolean> {
  const msg = message as Record<string, unknown>;
  if (!msg || msg['type'] !== 'showActionsMenu') {
    return false;
  }

  const msgActions = Array.isArray(msg['actions'])
    ? (msg['actions'] as Array<{ id: string; label: string }>)
    : [];

  const picks = msgActions.map(a => ({ label: a.label, detail: a.id }));
  const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select action' });

  if (selected) {
    panel.webview.postMessage({ type: 'actionSelected', actionId: selected.detail });
  }
  return true;
}
