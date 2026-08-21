/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — Java runtime detection and (optional) installation.
 *
 *  Detection order: `jarbench.javaHome` setting -> JAVA_HOME env var -> `java`/`javac` on PATH
 *  -> common per-OS install locations. Installation, when the user asks for it, downloads a
 *  Temurin build from the public Eclipse Adoptium API and extracts it with the platform's own
 *  archive tool (tar / Expand-Archive) rather than a bundled extractor or npm dependency.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as https from 'https';
import { IncomingMessage } from 'http';

function exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise(resolve => {
		cp.execFile(command, args, (error, stdout, stderr) => {
			resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', code: error ? (error as any).code ?? 1 : 0 });
		});
	});
}

async function isJavaHome(dir: string): Promise<boolean> {
	const javaBin = path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
	try {
		return (await fs.promises.stat(javaBin)).isFile();
	} catch {
		return false;
	}
}

/** Reads the version out of a JDK's `release` file (present in every modern JDK/JRE install) — no subprocess needed. */
export async function readJavaVersion(javaHome: string): Promise<string | undefined> {
	try {
		const content = await fs.promises.readFile(path.join(javaHome, 'release'), 'utf8');
		const match = content.match(/^JAVA_VERSION="([^"]+)"/m);
		return match?.[1];
	} catch {
		return undefined;
	}
}

/** Major version number parsed out of a version string like "17.0.9" or "1.8.0_392" ("1.8" means Java 8). */
export function majorVersionOf(version: string): number | undefined {
	const parts = version.split(/[.+_]/);
	if (parts.length === 0) {
		return undefined;
	}
	const first = parseInt(parts[0], 10);
	if (first === 1 && parts.length > 1) {
		return parseInt(parts[1], 10);
	}
	return Number.isNaN(first) ? undefined : first;
}

function commonInstallDirs(): string[] {
	switch (process.platform) {
		case 'darwin':
			return ['/Library/Java/JavaVirtualMachines'];
		case 'win32':
			return ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium'];
		default:
			return ['/usr/lib/jvm'];
	}
}

async function scanCommonInstalls(): Promise<string | undefined> {
	for (const base of commonInstallDirs()) {
		let children: string[];
		try {
			children = await fs.promises.readdir(base);
		} catch {
			continue;
		}
		// Prefer the most recently modified install (usually the newest version).
		const candidates: { dir: string; mtime: number }[] = [];
		for (const child of children) {
			const candidateDir = process.platform === 'darwin'
				? path.join(base, child, 'Contents', 'Home')
				: path.join(base, child);
			if (await isJavaHome(candidateDir)) {
				const stat = await fs.promises.stat(candidateDir).catch(() => undefined);
				candidates.push({ dir: candidateDir, mtime: stat?.mtimeMs ?? 0 });
			}
		}
		if (candidates.length > 0) {
			candidates.sort((a, b) => b.mtime - a.mtime);
			return candidates[0].dir;
		}
	}
	return undefined;
}

/** JarBench-managed install directory, used both to look for a prior install and as the extraction target. */
function managedJavaDir(context: vscode.ExtensionContext): string {
	return path.join(context.globalStorageUri.fsPath, 'jdk');
}

export async function findJavaHome(context: vscode.ExtensionContext, workspaceFolder?: vscode.WorkspaceFolder): Promise<string | undefined> {
	const configured = vscode.workspace.getConfiguration('jarbench', workspaceFolder?.uri).get<string>('javaHome', '');
	if (configured && await isJavaHome(configured)) {
		return configured;
	}

	const envHome = process.env.JAVA_HOME;
	if (envHome && await isJavaHome(envHome)) {
		return envHome;
	}

	const which = process.platform === 'win32' ? 'where' : 'which';
	const result = await exec(which, ['java']);
	if (result.code === 0 && result.stdout.trim().length > 0) {
		const javaBin = result.stdout.trim().split(/\r?\n/)[0];
		// bin/java -> JAVA_HOME is two levels up.
		const candidate = path.dirname(path.dirname(javaBin));
		if (await isJavaHome(candidate)) {
			return candidate;
		}
	}

	const managed = managedJavaDir(context);
	if (await isJavaHome(managed)) {
		return managed;
	}
	// A managed install extracts into a single versioned subfolder, e.g. jdk/jdk-17.0.9+9.
	try {
		const children = await fs.promises.readdir(managed);
		for (const child of children) {
			const candidate = process.platform === 'darwin'
				? path.join(managed, child, 'Contents', 'Home')
				: path.join(managed, child);
			if (await isJavaHome(candidate)) {
				return candidate;
			}
		}
	} catch {
		// managed dir doesn't exist yet
	}

	return scanCommonInstalls();
}

export interface DetectedJdk {
	home: string;
	version?: string;
	majorVersion?: number;
	source: 'JAVA_HOME' | 'PATH' | 'managed' | 'system';
}

/** Scans every source findJavaHome() checks and returns ALL distinct JDKs found, for a picker UI rather than picking just one. */
export async function findAllJavaHomes(context: vscode.ExtensionContext): Promise<DetectedJdk[]> {
	const seen = new Set<string>();
	const results: DetectedJdk[] = [];

	async function add(home: string, source: DetectedJdk['source']): Promise<void> {
		const resolved = path.resolve(home);
		if (seen.has(resolved) || !(await isJavaHome(resolved))) {
			return;
		}
		seen.add(resolved);
		const version = await readJavaVersion(resolved);
		results.push({ home: resolved, version, majorVersion: version ? majorVersionOf(version) : undefined, source });
	}

	if (process.env.JAVA_HOME) {
		await add(process.env.JAVA_HOME, 'JAVA_HOME');
	}

	const which = process.platform === 'win32' ? 'where' : 'which';
	const whichResult = await exec(which, ['java']);
	if (whichResult.code === 0) {
		for (const line of whichResult.stdout.trim().split(/\r?\n/)) {
			if (line.trim()) {
				await add(path.dirname(path.dirname(line.trim())), 'PATH');
			}
		}
	}

	const managed = managedJavaDir(context);
	try {
		for (const child of await fs.promises.readdir(managed)) {
			const candidate = process.platform === 'darwin'
				? path.join(managed, child, 'Contents', 'Home')
				: path.join(managed, child);
			await add(candidate, 'managed');
		}
	} catch {
		// no managed installs yet
	}

	for (const base of commonInstallDirs()) {
		let children: string[];
		try {
			children = await fs.promises.readdir(base);
		} catch {
			continue;
		}
		for (const child of children) {
			const candidate = process.platform === 'darwin'
				? path.join(base, child, 'Contents', 'Home')
				: path.join(base, child);
			await add(candidate, 'system');
		}
	}

	results.sort((a, b) => (b.majorVersion ?? 0) - (a.majorVersion ?? 0));
	return results;
}

/** Best-effort read of the Java version a Gradle project declares, defaulting to 17 (current MC/Forge/Fabric baseline) when unspecified. */
export async function detectRequiredJavaVersion(rootPath: string): Promise<number> {
	const candidates = ['build.gradle', 'build.gradle.kts'];
	for (const name of candidates) {
		try {
			const content = await fs.promises.readFile(path.join(rootPath, name), 'utf8');
			const toolchain = content.match(/languageVersion\s*(?:=|\.set\()\s*JavaLanguageVersion\.of\((\d+)\)/);
			if (toolchain) {
				return parseInt(toolchain[1], 10);
			}
			const sourceCompat = content.match(/sourceCompatibility\s*=\s*['"]?(?:JavaVersion\.VERSION_)?(\d+(?:\.\d+)?)['"]?/);
			if (sourceCompat) {
				const parts = sourceCompat[1].split('.');
				// Old-style "1.8" means Java 8; "17" or "VERSION_17" means Java 17.
				return parts.length > 1 && parts[0] === '1' ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
			}
		} catch {
			// try next candidate
		}
	}
	return 17;
}

function adoptiumOsName(): string {
	switch (process.platform) {
		case 'darwin': return 'mac';
		case 'win32': return 'windows';
		default: return 'linux';
	}
}

function adoptiumArch(): string {
	switch (process.arch) {
		case 'arm64': return 'aarch64';
		case 'x64': return 'x64';
		default: return process.arch;
	}
}

function httpsGetFollowingRedirects(url: string, maxRedirects = 5): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'User-Agent': 'JarBench' } }, res => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				if (maxRedirects <= 0) {
					reject(new Error('Too many redirects while downloading JDK.'));
					return;
				}
				httpsGetFollowingRedirects(res.headers.location, maxRedirects - 1).then(resolve, reject);
				return;
			}
			if (!res.statusCode || res.statusCode >= 400) {
				reject(new Error(`Download failed with status ${res.statusCode}`));
				return;
			}
			resolve(res);
		}).on('error', reject);
	});
}

async function downloadTo(url: string, destFile: string, progress?: vscode.Progress<{ message?: string }>): Promise<void> {
	const res = await httpsGetFollowingRedirects(url);
	await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
	await new Promise<void>((resolve, reject) => {
		const out = fs.createWriteStream(destFile);
		res.pipe(out);
		res.on('error', reject);
		out.on('error', reject);
		out.on('finish', () => resolve());
	});
	progress?.report({ message: 'Download complete.' });
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
	await fs.promises.mkdir(destDir, { recursive: true });
	if (archivePath.endsWith('.zip')) {
		if (process.platform === 'win32') {
			await exec('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`]);
		} else {
			await exec('unzip', ['-q', '-o', archivePath, '-d', destDir]);
		}
	} else {
		// .tar.gz
		await exec('tar', ['-xzf', archivePath, '-C', destDir]);
	}
}

/**
 * Downloads and extracts a Temurin JDK matching this machine and the given major version,
 * via the public Eclipse Adoptium API, then writes the resolved home to `jarbench.javaHome`.
 * Returns the resolved JAVA_HOME on success.
 */
export async function installJava(context: vscode.ExtensionContext, majorVersion: number, target: vscode.ConfigurationTarget, workspaceFolder?: vscode.WorkspaceFolder): Promise<string> {
	return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `JarBench: Installing Temurin JDK ${majorVersion}` }, async progress => {
		const imageType = 'jdk';
		const osName = adoptiumOsName();
		const arch = adoptiumArch();
		const archiveExt = osName === 'windows' ? 'zip' : 'tar.gz';
		const apiUrl = `https://api.adoptium.net/v3/binary/latest/${majorVersion}/ga/${osName}/${arch}/${imageType}/hotspot/normal/eclipse?project=jdk`;

		progress.report({ message: 'Downloading from Eclipse Adoptium…' });
		const destDir = managedJavaDir(context);
		const archiveFile = path.join(context.globalStorageUri.fsPath, `jdk-download.${archiveExt}`);
		await downloadTo(apiUrl, archiveFile);

		progress.report({ message: 'Extracting…' });
		await extractArchive(archiveFile, destDir);
		await fs.promises.rm(archiveFile, { force: true });

		const home = await findJavaHome(context, workspaceFolder);
		if (!home) {
			throw new Error('JDK was downloaded and extracted, but a valid Java home could not be located inside it.');
		}

		await vscode.workspace.getConfiguration('jarbench', workspaceFolder?.uri).update('javaHome', home, target);
		return home;
	});
}
