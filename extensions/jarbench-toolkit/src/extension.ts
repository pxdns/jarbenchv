/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — entry point.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GradleTaskDetector } from './gradle/gradleTaskProvider';
import { GradleTasksViewProvider } from './gradle/gradleTasksView';
import { JarEditorProvider } from './analysis/jarEditor';
import { WorkspaceInsightsProvider } from './analysis/workspaceInsights';
import { findJavaHome, findAllJavaHomes, installJava, detectRequiredJavaVersion } from './java/javaRuntime';
import { registerJavaExtensionPrompt } from './java/javaExtensionPrompt';
import { registerLaunchModeCommands } from './launchModes';

export function activate(context: vscode.ExtensionContext): void {
	registerJavaExtensionPrompt(context);
	registerLaunchModeCommands(context);

	const gradleDetector = new GradleTaskDetector(context);
	gradleDetector.start();
	context.subscriptions.push(gradleDetector);

	const gradleTasksView = new GradleTasksViewProvider(gradleDetector);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('jarbenchGradleTasks', gradleTasksView));
	context.subscriptions.push(vscode.commands.registerCommand('jarbench.refreshGradleTasks', () => gradleTasksView.refresh()));
	context.subscriptions.push(vscode.commands.registerCommand('jarbench.runGradleTask', async (task: vscode.Task) => {
		await vscode.tasks.executeTask(task);
	}));

	context.subscriptions.push(vscode.window.registerCustomEditorProvider(
		JarEditorProvider.viewType,
		new JarEditorProvider(context),
		{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
	));

	const insights = new WorkspaceInsightsProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('jarbenchInsights', insights));

	context.subscriptions.push(vscode.commands.registerCommand('jarbench.rescanWorkspace', () => insights.refresh()));

	context.subscriptions.push(vscode.commands.registerCommand('jarbench.analyzeJar', async (uri?: vscode.Uri) => {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target) {
			vscode.window.showWarningMessage(vscode.l10n.t('Select a .jar file first.'));
			return;
		}
		await vscode.commands.executeCommand('vscode.openWith', target, JarEditorProvider.viewType);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('jarbench.installJava', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const existing = await findJavaHome(context, workspaceFolder);
		if (existing) {
			const choice = await vscode.window.showInformationMessage(
				vscode.l10n.t('JarBench already found a JDK at {0}. Install a fresh one anyway?', existing),
				vscode.l10n.t('Use existing'), vscode.l10n.t('Install anyway')
			);
			if (choice !== vscode.l10n.t('Install anyway')) {
				return;
			}
		}

		const requiredVersion = workspaceFolder
			? await detectRequiredJavaVersion(workspaceFolder.uri.fsPath)
			: 17;

		const scopePick = await vscode.window.showQuickPick(
			[
				{ label: vscode.l10n.t('This workspace'), target: vscode.ConfigurationTarget.WorkspaceFolder },
				{ label: vscode.l10n.t('All workspaces (user settings)'), target: vscode.ConfigurationTarget.Global }
			],
			{ placeHolder: vscode.l10n.t('Where should jarbench.javaHome be saved?') }
		);
		if (!scopePick) {
			return;
		}

		try {
			const home = await installJava(context, requiredVersion, scopePick.target, workspaceFolder);
			vscode.window.showInformationMessage(vscode.l10n.t('JarBench installed a Java {0} JDK at {1} and set jarbench.javaHome.', requiredVersion, home));
		} catch (err) {
			vscode.window.showErrorMessage(vscode.l10n.t('JarBench could not install a JDK: {0}', err instanceof Error ? err.message : String(err)));
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('jarbench.selectJavaRuntime', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const requiredVersion = workspaceFolder ? await detectRequiredJavaVersion(workspaceFolder.uri.fsPath) : undefined;

		const jdks = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('JarBench: Scanning for installed JDKs…') },
			() => findAllJavaHomes(context)
		);

		const items: (vscode.QuickPickItem & { jdk?: DetectedJdkForPick })[] = jdks.map(jdk => ({
			label: `${jdk.majorVersion ? `Java ${jdk.majorVersion}` : 'Unknown version'}${jdk.majorVersion === requiredVersion ? ' — matches this project' : ''}`,
			description: jdk.version,
			detail: `${jdk.home}  ·  ${jdk.source}`,
			jdk
		}));
		items.push({ label: '$(cloud-download) ' + vscode.l10n.t('Install a different version…'), jdk: undefined });

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: requiredVersion
				? vscode.l10n.t('This project declares Java {0}', requiredVersion)
				: vscode.l10n.t('Select a JDK for this workspace')
		});
		if (!picked) {
			return;
		}
		if (!picked.jdk) {
			await vscode.commands.executeCommand('jarbench.installJava');
			return;
		}

		const scopePick = await vscode.window.showQuickPick(
			[
				{ label: vscode.l10n.t('This workspace'), target: vscode.ConfigurationTarget.WorkspaceFolder },
				{ label: vscode.l10n.t('All workspaces (user settings)'), target: vscode.ConfigurationTarget.Global }
			],
			{ placeHolder: vscode.l10n.t('Where should jarbench.javaHome be saved?') }
		);
		if (!scopePick) {
			return;
		}
		await vscode.workspace.getConfiguration('jarbench', workspaceFolder?.uri).update('javaHome', picked.jdk.home, scopePick.target);
		vscode.window.showInformationMessage(vscode.l10n.t('jarbench.javaHome set to {0}.', picked.jdk.home));
	}));

	if (vscode.workspace.getConfiguration('jarbench').get<boolean>('autoDetectJava', true)) {
		void maybeOfferJavaInstall(context);
	}
}

type DetectedJdkForPick = Awaited<ReturnType<typeof findAllJavaHomes>>[number];

async function maybeOfferJavaInstall(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const home = await findJavaHome(context, workspaceFolder);
	if (home) {
		return;
	}
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('JarBench could not find a JDK for this project. Install one now?'),
		vscode.l10n.t('Install Java'), vscode.l10n.t('Not now')
	);
	if (choice === vscode.l10n.t('Install Java')) {
		await vscode.commands.executeCommand('jarbench.installJava');
	}
}

export function deactivate(): void { }
