import * as vscode from 'vscode';
import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

import vm_sizes from './vm_sizes.json' assert {type: 'json'};

var view: helpers.GenericWebView|null = null;

export function displayDockerExplorer(extensionContext : vscode.ExtensionContext) {

  // do not display more than one Cloud Explorer panel
  if (view !== null && !view.destroyed) {
    view.focus();
    return;
  }

  let formDefinition = {
    type: 'layout-tree-with-details',
    id: 'layout'
    };

  view = new helpers.GenericWebView(extensionContext, "Docker Runner", "Docker Runner", vscode);

  view.setVariable("vm_sizes", vm_sizes);

  // load templates
  var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/____tree_templates.yaml");
  var templates = loader.getYaml();
  view.treeSetTemplates(templates);

  view.MsgHandler = function (msg: any) {
    switch (msg.command) {
      case 'ready':
        var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/____tree_items.yaml");
        var resources = loader.getYaml();
        view.treeSetItems(resources, null);
        return;

      case 'refresh':
        // XXX - need to send refresh event to explorer
        if ('id' in msg) {
          CloudExplorerRefresh(msg['id']);
        } else {
          CloudExplorerRefresh(view.treeGetCurrentId());
        }
        return;
      case 'selected':
        console.log('ITEM SELECTED');
        // any additional implementation should be placed here
        return;
      case 'button-clicked':

        if (msg.id === 'install_button') {
          view.runStepsInstallation();
        }
        return;
     default:
        console.log('XXX');
    }
  };

  view.createPanel(formDefinition, "media/icon.png");
}


export function CloudExplorerRefresh(refresh_id: string) {

  var id = (refresh_id !== "" ? refresh_id : view.treeGetCurrentId());

  setTimeout(() => {
    view.treeQueryItems(view, id);
  }, 3000);
  
  // refresh only if currently visible
  if (refresh_id === view.treeGetCurrentId()) {
    // a tree item was selected, display details accordingly
    // or try to query items accordingly
    view.createDetailsView(id);
  }
}
