import * as vscode from 'vscode';

class DeprecationItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    command?: vscode.Command
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    if (command) {
      this.command = command;
    }
  }
}

export class DeprecationTreeProvider implements vscode.TreeDataProvider<DeprecationItem> {
  getTreeItem(element: DeprecationItem): vscode.TreeItem {
    return element;
  }

  getChildren(): DeprecationItem[] {
    return [
      new DeprecationItem('Deprecated in Platform 2.0', 'warning'),
      new DeprecationItem('Uninstall', 'trash', {
        command: 'happySessions.uninstall',
        title: 'Uninstall Extension'
      }),
    ];
  }
}
