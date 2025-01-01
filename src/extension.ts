import * as vscode from 'vscode';
import type { ExtensionContext, Uri } from 'vscode';

import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

import { displayDockerExplorer, CloudExplorerRefresh } from './docker-explorer';
import vm_sizes from './vm_sizes.json' assert {type: 'json'};

//import SwaggerParser from "@apidevtools/swagger-parser";
var extensionUri: Uri;
var mediaFolder: Uri;
export var extensionContext: ExtensionContext;

const fs = require("fs");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate (context: ExtensionContext) {
  extensionContext = context;
  extensionUri = context.extensionUri;

  mediaFolder = vscode.Uri.joinPath(extensionUri, 'media');

  let disposable = vscode.commands.registerCommand(
    'vscode-cloud.displayDockerExplorer',
    () => {
      displayDockerExplorer(extensionContext);
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate () {}


export async function loadYamlView(yml: any, refresh_id: string|null, parameters: any = null) {

  var tabTitle: string = ('title' in yml) ? yml['title'] : "Raw CLI";

  let view = new helpers.GenericWebView(extensionContext, tabTitle, "Cloud Commmander", vscode); 
  view.setVariable("vm_sizes", vm_sizes);

  if (parameters !== null) {
    for (var p in parameters) {
      view.setVariable(p, parameters[p]);
    }
  }

  view.createPanel(yml, "media/icon.png");

  view.MsgHandler = function (msg: any) {
    if (msg.command === 'ready') {
      view.runStepsVerification();
    } else if (msg.command === 'refresh') {
      // XXX - need to send refresh event to explorer
      if ('id' in msg) {
        CloudExplorerRefresh(msg['id']);
      } else {
        CloudExplorerRefresh(refresh_id ? refresh_id : "");
      }
    } else if (msg.command === 'button-clicked') {
      if (msg.id === 'close') {
        view.close();
      } else if (msg.id === 'install_button') {
        view.runStepsInstallation();
      }
    }
  };
}
