import * as vscode from 'vscode';
import type { ExtensionContext, Uri } from 'vscode';

import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

//import vm_sizes from './vm_sizes.json' assert {type: 'json'};

export function activate (context: ExtensionContext) {

  let disposable = vscode.commands.registerCommand(
    'vscode-cloud.displayDockerExplorer',
    () => {
      displayDockerExplorer(context);
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate () {}

var view: helpers.GenericWebView|null = null;

function displayDockerExplorer(extensionContext : vscode.ExtensionContext) {

  // do not display more than one Cloud Explorer panel
  if (view !== null && !view.destroyed) {
    view.focus();
    return;
  }

  view = helpers.CreateExplorerView(extensionContext, "Docker Runner", "Docker Runner", vscode);
}
