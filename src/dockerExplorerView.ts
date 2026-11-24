// The Docker explorer as a webview: VS Code hosts the pane, the wasm panel draws it, and this class
// runs the CLI between the two.

import * as vscode from "vscode";
import { act, inspect, isAction, logs, safeTarget, snapshot } from "./dockerBridge";
import { attachContainerTerminal } from "./terminal";

export class DockerExplorerView implements vscode.WebviewViewProvider {
  public static readonly viewType = "dockerRunnerExplorer";

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeView();
    this.view = view;

    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) {
          this.refresh();
        }
      }),
      view.onDidDispose(() => this.disposeView()),
    );
    view.webview.html = this.html(view.webview);
  }

  /** Ask the panel for a fresh snapshot. */
  refresh(): void {
    if (this.view === undefined) {
      return;
    }
    this.enqueue(async () => {
      this.post({ type: "input", event: { op: "docker", state: await snapshot() } });
    });
  }

  private receive(message: unknown): void {
    if (message === null || typeof message !== "object") {
      return;
    }
    const data = message as { type?: unknown; line?: unknown };
    if (data.type === "ready") {
      this.refresh();
      return;
    }
    if (data.type === "request" && typeof data.line === "string") {
      this.request(data.line);
    }
  }

  private request(line: string): void {
    const prefix = "docker\t";
    if (!line.startsWith(prefix)) {
      return;
    }
    const body = line.slice(prefix.length);
    const split = body.indexOf("\t");
    const op = split < 0 ? body : body.slice(0, split);
    const target = split < 0 ? "" : body.slice(split + 1);

    this.enqueue(async () => {
      if (op === "refresh") {
        this.post({ type: "input", event: { op: "docker", state: await snapshot() } });
      } else if (op === "attach") {
        const terminal = attachContainerTerminal(target);
        const state = await snapshot();
        if (terminal === undefined) {
          state.notice = "That is not a container id.";
        }
        this.post({ type: "input", event: { op: "docker", state } });
      } else if (op === "logs") {
        this.post({ type: "input", event: { op: "dockerDetail", detail: await logs(target) } });
      } else if (op === "inspect") {
        this.post({ type: "input", event: { op: "dockerDetail", detail: await inspect(target) } });
      } else if (isAction(op)) {
        this.post({ type: "input", event: { op: "docker", state: await act(op, target) } });
      }
    });
  }

  private enqueue(task: () => Promise<void>): void {
    const run = async (): Promise<void> => {
      try {
        await task();
      } catch (error) {
        this.post({
          type: "input",
          event: {
            op: "dockerDetail",
            detail: { title: "Docker", lines: [], error: `The Docker panel hit an error: ${String(error)}` },
          },
        });
      }
    };
    this.queue = this.queue.then(run, run);
  }

  private post(message: unknown): void {
    if (this.view !== undefined) {
      void this.view.webview.postMessage(message);
    }
  }

  private disposeView(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.view = undefined;
  }

  private html(webview: vscode.Webview): string {
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "dockerPanel.js"));
    const wasm = webview.asWebviewUri(vscode.Uri.joinPath(media, "advance_docker.wasm"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'wasm-unsafe-eval'; connect-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    overflow: hidden;
    background: var(--vscode-sideBar-background);
  }
  #screen {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }
  #error {
    position: absolute;
    inset: 0;
    padding: 12px;
    box-sizing: border-box;
    color: var(--vscode-errorForeground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    white-space: pre-wrap;
  }
</style>
</head>
<body>
<canvas id="screen" data-wasm="${wasm}"></canvas>
<div id="error" hidden></div>
<script src="${script}"></script>
</body>
</html>`;
  }
}
