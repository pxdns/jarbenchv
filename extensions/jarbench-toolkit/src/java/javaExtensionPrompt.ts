/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — Java language intelligence prompt.
 *
 *  JarBench doesn't bundle a Java language server (diagnostics, completion, navigation,
 *  refactoring) — that's a large, independently-maintained project (Eclipse JDT.LS) rather
 *  than something to fork. Instead, the first time a .java file is opened without it already
 *  installed, offer Microsoft's "Extension Pack for Java", which pulls in JDT.LS (redhat.java)
 *  plus the debugger, test runner, Maven support, and project explorer together.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const JAVA_PACK_ID = 'vscjava.vscode-java-pack';
const JDT_ID = 'redhat.java';
const DISMISSED_KEY = 'jarbench.javaExtensionPackPromptDismissed';

export function registerJavaExtensionPrompt(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => {
		if (doc.languageId === 'java') {
			void maybeOfferJavaExtensionPack(context);
		}
	}));
	if (vscode.workspace.textDocuments.some(doc => doc.languageId === 'java')) {
		void maybeOfferJavaExtensionPack(context);
	}
}

async function maybeOfferJavaExtensionPack(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.getConfiguration('jarbench').get<boolean>('recommendJavaExtensionPack', true)) {
		return;
	}
	if (context.globalState.get<boolean>(DISMISSED_KEY)) {
		return;
	}
	if (vscode.extensions.getExtension(JDT_ID) || vscode.extensions.getExtension(JAVA_PACK_ID)) {
		return;
	}

	const install = vscode.l10n.t('Install Java Tools');
	const dontAsk = vscode.l10n.t('Don\'t Ask Again');
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('JarBench doesn\'t bundle Java language intelligence (diagnostics, completion, go to definition, rename). Install the Extension Pack for Java — built on the same JDT engine Eclipse uses — for full support?'),
		install, dontAsk
	);
	if (choice === install) {
		await vscode.commands.executeCommand('workbench.extensions.installExtension', JAVA_PACK_ID);
	} else if (choice === dontAsk) {
		await context.globalState.update(DISMISSED_KEY, true);
	}
}
