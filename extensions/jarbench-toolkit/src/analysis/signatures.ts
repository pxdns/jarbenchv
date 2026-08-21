/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — signature-based source identification.
 *
 *  This table only records well-established public facts about these projects' package
 *  layout (Mojang's `net.minecraft`, Forge's `net.minecraftforge`, Fabric's `net.fabricmc`,
 *  Mixin's `org.spongepowered.asm.mixin`, and Eaglercraft's `net.lax1dude.eaglercraft` base
 *  package). It is intentionally editable: as real jars are inspected, prefixes can be added
 *  or corrected here without touching the detection engine.
 *--------------------------------------------------------------------------------------------*/

export interface Signature {
	id: string;
	label: string;
	/** Path prefixes (as they appear in a jar's zip entries, using '/' separators) that count as a hit. */
	pathPrefixes: string[];
	/** Free-text substrings to look for in class/manifest content as a weaker, secondary signal. */
	contentHints?: string[];
	kind: 'platform' | 'loader' | 'library';
}

export const SIGNATURES: Signature[] = [
	{
		id: 'minecraft',
		label: 'Minecraft Java Edition (vanilla)',
		pathPrefixes: ['net/minecraft/client/', 'net/minecraft/server/', 'net/minecraft/world/'],
		kind: 'platform'
	},
	{
		id: 'forge',
		label: 'Minecraft Forge',
		pathPrefixes: ['net/minecraftforge/', 'net/neoforged/'],
		kind: 'loader'
	},
	{
		id: 'fabric',
		label: 'Fabric',
		pathPrefixes: ['net/fabricmc/'],
		kind: 'loader'
	},
	{
		id: 'mixin',
		label: 'Mixin (SpongePowered)',
		pathPrefixes: ['org/spongepowered/asm/mixin/'],
		kind: 'library'
	},
	{
		id: 'eaglercraft',
		label: 'Eaglercraft (browser-based Minecraft client fork)',
		pathPrefixes: ['net/lax1dude/eaglercraft/', 'net/lax1dude/', 'eaglercraft/'],
		contentHints: ['eaglercraft', 'EaglercraftVersion', 'teavm', 'TeaVM'],
		kind: 'platform'
	},
	{
		id: 'lwjgl',
		label: 'LWJGL (native desktop rendering)',
		pathPrefixes: ['org/lwjgl/'],
		kind: 'library'
	}
];

export interface MatchedSignature {
	signature: Signature;
	/** Matching entry paths (capped) used as evidence. */
	evidence: string[];
	count: number;
}

/**
 * Scans a list of jar/zip entry paths against the signature table.
 * Kept separate from any I/O so it can run against both real jar entries and
 * workspace directory listings.
 */
export function matchSignatures(entryPaths: string[]): MatchedSignature[] {
	const results: MatchedSignature[] = [];
	for (const sig of SIGNATURES) {
		const evidence: string[] = [];
		let count = 0;
		for (const entry of entryPaths) {
			if (sig.pathPrefixes.some(prefix => entry.startsWith(prefix))) {
				count++;
				if (evidence.length < 8) {
					evidence.push(entry);
				}
			}
		}
		if (count > 0) {
			results.push({ signature: sig, evidence, count });
		}
	}
	return results.sort((a, b) => b.count - a.count);
}

export function summarizeVerdict(matches: MatchedSignature[], totalEntries: number): string {
	if (matches.length === 0) {
		return totalEntries === 0
			? 'No entries were scanned — nothing to report.'
			: 'No known Minecraft/Eaglercraft/Forge/Fabric signatures matched. This does not look like a Minecraft-related jar (or it uses layouts not yet in JarBench\'s signature table).';
	}
	const platform = matches.find(m => m.signature.kind === 'platform');
	const loaders = matches.filter(m => m.signature.kind === 'loader');
	const libs = matches.filter(m => m.signature.kind === 'library');
	const parts: string[] = [];
	if (platform) {
		parts.push(`Base platform: ${platform.signature.label} (${platform.count} matching ${platform.count === 1 ? 'entry' : 'entries'}).`);
	}
	if (loaders.length > 0) {
		parts.push(`Loader(s): ${loaders.map(m => `${m.signature.label} (${m.count})`).join(', ')}.`);
	}
	if (libs.length > 0) {
		parts.push(`Also uses: ${libs.map(m => `${m.signature.label} (${m.count})`).join(', ')}.`);
	}
	return parts.join(' ');
}
