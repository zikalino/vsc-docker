import * as vscode from 'vscode';
import type { ExtensionContext, Uri } from 'vscode';

import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

//import vm_sizes from './vm_sizes.json' assert {type: 'json'};

export function activate (context: ExtensionContext) {

  let disposable = vscode.commands.registerCommand(
    'vscode-docker-runner.displayExplorer',
    () => {
      displayDockerExplorer(context);
    }
  );

  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand(
    'vscode-docker-runner.displayDiscoverImages',
    () => {
      displayDiscoverImages(context);
    }
  );

  context.subscriptions.push(disposable);  

  disposable = vscode.commands.registerCommand(
    'vscode-docker-runner.displayCreateContainers',
    () => {
      displayCreateContainers(context);
    }
  );

  context.subscriptions.push(disposable);  
}

// This method is called when your extension is deactivated
export function deactivate () {}

var view: helpers.GenericWebView|null = null;

function displayDockerExplorer(extensionContext : vscode.ExtensionContext) {

  // set helpers global context so we don't have to do it again
  helpers.SetContext(vscode, extensionContext);

  // do not display more than one Cloud Explorer panel
  if (view !== null && !view.destroyed) {
    view.focus();
    return;
  }

  view = helpers.CreateExplorerView("Docker Runner", "Docker Runner", "media/icon.png");
}

function displayDiscoverImages(extensionContext : vscode.ExtensionContext) {

  // set helpers global context so we don't have to do it again
  helpers.SetContext(vscode, extensionContext);

  helpers.CreateFormView("docker/docker_image_import.yaml",
                                view,
                                "docker-image-list",
                                null);
}

function displayCreateContainers(extensionContext : vscode.ExtensionContext) {

  // set helpers global context so we don't have to do it again
  helpers.SetContext(vscode, extensionContext);

  helpers.CreateFormView("docker/docker_run.yaml",
                                view,
                                "docker-container-list",
                                null);
}
