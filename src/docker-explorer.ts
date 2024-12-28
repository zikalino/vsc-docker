import * as vscode from 'vscode';
import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

import { displayMenu } from './extension';

import vm_sizes from './vm_sizes.json' assert {type: 'json'};

import { loadYamlView } from './extension';

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
      case 'action-clicked':
        if (msg.id === 'action-refresh') {
          RefreshCurrentContext();
        } else if (msg.id === 'action-add') {
          displayCreateResourceMenu(view.treeGetCurrentId());
        }
        return;
      case 'button-clicked':

        if (msg.id === 'install_button') {
          view.runStepsInstallation();
        }
        return;
      case 'action-template':
        var template = msg['template'];
  
        var parameters: any = ('parameters' in template) ? template['parameters'] : {};
  
        var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/" + template['name']);
        let yml = loader.getYaml();
  
        loadYamlView(yml, null, parameters);
        break;
     default:
        console.log('XXX');
    }
  };

  view.createPanel(formDefinition, "media/icon.png");
}


function displayCreateResourceMenu(item_id: string) {
  // XXX - find menu item
  var operations: any[] = view.findOperations(item_id);
  var menu_items: any[] = [];

  for (var idx in operations) {
    var operation = operations[idx];
    if (operation['type'] === 'create') {
      if ('template' in operation) {
        var template = "";
        var parameters = {};
        if (typeof operation['template'] === 'string') {
          template = operation['template'];
        } else if ('name' in operation['template']) {
          template = operation['template']['name'];
          if ('parameters' in operation['template']) {
            parameters = operation['template']['parameters'];
          }
        }

        if (template !== "") {
          menu_items.push({
            location: template,
            name: operation['name'],
            parameters: parameters
          });
        }
      }
    }
  }

  displayMenu(menu_items);
}

function RefreshCurrentContext() {
  view.treeQueryItems(view, view.treeGetCurrentId());

  // a tree item was selected, display details accordingly
  // or try to query items accordingly
  view.createDetailsView(view.treeGetCurrentId());
}

export function CloudExplorerRefresh(refresh_id: string, details: boolean) {

  var id = (refresh_id !== "" ? refresh_id : view.treeGetCurrentId());

  setTimeout(() => {
    view.treeQueryItems(view, id);
  }, 1000);
  

  if (details) {
    // a tree item was selected, display details accordingly
    // or try to query items accordingly
    view.createDetailsView(id);
  }
}
