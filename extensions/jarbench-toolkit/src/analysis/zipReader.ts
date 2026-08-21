/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — minimal, dependency-free ZIP/JAR reader.
 *
 *  Jars are ordinary ZIP files. Listing entries only requires the central directory (no
 *  decompression); reading one entry's bytes needs its local header (to find the data offset)
 *  plus Node's built-in zlib for the near-universal DEFLATE case. This intentionally avoids
 *  pulling in an npm dependency, matching how other in-tree extensions are built.
 *--------------------------------------------------------------------------------------------*/

import * as zlib from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

export interface ZipEntry {
	name: string;
	compressedSize: number;
	uncompressedSize: number;
	compressionMethod: number;
	localHeaderOffset: number;
	isDirectory: boolean;
}

function findEndOfCentralDirectory(buf: Buffer): number {
	const maxCommentLength = 65535;
	const searchStart = Math.max(0, buf.length - 22 - maxCommentLength);
	for (let i = buf.length - 22; i >= searchStart; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
			return i;
		}
	}
	throw new Error('Not a valid zip/jar file: end of central directory record not found.');
}

export function readCentralDirectory(buf: Buffer): ZipEntry[] {
	const eocdOffset = findEndOfCentralDirectory(buf);
	let totalEntries = buf.readUInt16LE(eocdOffset + 10);
	let centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

	// ZIP64: a 0xFFFFFFFF sentinel means the real values live in the ZIP64 EOCD locator/record.
	if (centralDirOffset === 0xffffffff || totalEntries === 0xffff) {
		const locatorOffset = eocdOffset - 20;
		if (locatorOffset >= 0 && buf.readUInt32LE(locatorOffset) === 0x07064b50) {
			const zip64EocdOffset = Number(buf.readBigUInt64LE(locatorOffset + 8));
			if (buf.readUInt32LE(zip64EocdOffset) === 0x06064b50) {
				totalEntries = Number(buf.readBigUInt64LE(zip64EocdOffset + 32));
				centralDirOffset = Number(buf.readBigUInt64LE(zip64EocdOffset + 48));
			}
		}
	}

	const entries: ZipEntry[] = [];
	let offset = centralDirOffset;
	for (let i = 0; i < totalEntries; i++) {
		if (buf.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
			break;
		}
		const compressionMethod = buf.readUInt16LE(offset + 10);
		const compressedSize = buf.readUInt32LE(offset + 20);
		const uncompressedSize = buf.readUInt32LE(offset + 24);
		const nameLength = buf.readUInt16LE(offset + 28);
		const extraLength = buf.readUInt16LE(offset + 30);
		const commentLength = buf.readUInt16LE(offset + 32);
		const localHeaderOffset = buf.readUInt32LE(offset + 42);
		const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);

		entries.push({
			name,
			compressedSize,
			uncompressedSize,
			compressionMethod,
			localHeaderOffset,
			isDirectory: name.endsWith('/')
		});

		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** Reads and (if needed) inflates one entry's raw bytes. */
export function readEntryData(buf: Buffer, entry: ZipEntry): Buffer {
	if (buf.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
		throw new Error(`Corrupt local file header for "${entry.name}".`);
	}
	const nameLength = buf.readUInt16LE(entry.localHeaderOffset + 26);
	const extraLength = buf.readUInt16LE(entry.localHeaderOffset + 28);
	const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
	const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);

	switch (entry.compressionMethod) {
		case 0: // stored
			return Buffer.from(raw);
		case 8: // deflate
			return zlib.inflateRawSync(raw);
		default:
			throw new Error(`Unsupported compression method ${entry.compressionMethod} for "${entry.name}".`);
	}
}

export function findEntry(entries: ZipEntry[], name: string): ZipEntry | undefined {
	return entries.find(e => e.name === name);
}
