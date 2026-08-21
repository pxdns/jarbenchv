/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — launch modes.
 *
 *  JarBench's default launch already is the "Java mode": jarbench-toolkit and theme-jarbench
 *  active. This adds the second mode — a command that opens a new window with those two
 *  extensions disabled via VS Code's own `--disable-extension` CLI flag, so it behaves like a
 *  plain VS Code window (no Gradle/Java tooling, no jar viewer, default theme). The window is
 *  still the JarBench build (name, icon, product.json identity are compiled in, not
 *  swappable per-window) — only the extensions/theme this fork adds are turned off.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';

const JARBENCH_EXTENSION_IDS = ['jarbench.jarbench-toolkit', 'jarbench.theme-jarbench'];

export function registerLaunchModeCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('jarbench.openVanillaWindow', () => {
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const args = ['--new-window', ...JARBENCH_EXTENSION_IDS.flatMap(id => ['--disable-extension', id])];
		if (folder) {
			args.push(folder);
		}
		spawnNewInstance(args);
	}));
}

function spawnNewInstance(args: string[]): void {
	try {
		const child = cp.spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
		child.unref();
	} catch (err) {
		vscode.window.showErrorMessage(vscode.l10n.t('JarBench could not open a new window: {0}', err instanceof Error ? err.message : String(err)));
	}
}
