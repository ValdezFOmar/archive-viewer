import {
    BlobWriter,
    type FileEntry,
    type HttpReader,
    ZipReader,
    getMimeType,
} from '@zip.js/zip.js';
import { requestPassword } from './password';

export class Path {
    readonly #path: string;
    readonly stem: string;
    readonly name: string;
    readonly extension: string;
    readonly parents: readonly string[];

    constructor(path: string) {
        const components = path.split('/');
        const name = components.pop()!;
        const [stem, extension] = splitFileName(name);
        this.#path = path;
        this.name = name;
        this.stem = stem;
        this.extension = extension;
        this.parents = components;
    }

    /**
     * Part before the path's name.
     */
    get prefix(): string {
        return this.#path.slice(0, this.#path.length - this.name.length);
    }

    /**
     * Compare entries path using their prefix, with the order:
     *
     * 1. By prefix: Compares the entries parents.
     * 2. By depth: For entries sharing a prefix. Deeper entries later.
     * 3. By stem: Entries with the same prefix and depth (same directory).
     * 4. By extension: When all other comparisons are equal.
     *
     * Returns:
     *
     *  `<0` when `self < other`
     *   `0` when `self == other`
     *  `>0` when `self > other`
     */
    compare(other: Path): number {
        let sharedParents = 0;
        let lastParentCmp = this.parents.length - other.parents.length;
        for (let i = 0; i < this.parents.length && i < other.parents.length; i++) {
            lastParentCmp = naturalCompare(this.parents[i], other.parents[i]);
            if (lastParentCmp !== 0) {
                break;
            }
            sharedParents++;
        }
        if (this.parents.length === sharedParents && other.parents.length === sharedParents) {
            const result = naturalCompare(this.stem, other.stem);
            return result === 0 ? naturalCompare(this.extension, other.extension) : result;
        } else if (this.parents.length === sharedParents) {
            return -1;
        } else if (other.parents.length === sharedParents) {
            return 1;
        } else {
            return lastParentCmp;
        }
    }

    toString(): string {
        return this.#path;
    }
}

/**
 * Split a file name into the stem (part before the extension) and
 * its file extension (includes '.').
 *
 *  ```js
 * splitFileName('file.zip')    // ['file', '.zip']
 * splitFileName('file.tar.gz') // ['file.tar', '.gz']
 * splitFileName('LICENSE')     // ['LICENSE', '']
 * splitFileName('.gitignore')  // ['.gitignore', '']
 *  ```
 */
function splitFileName(name: string): [string, string] {
    const index = name.lastIndexOf('.');
    if (index === -1 || index === 0) {
        return [name, ''];
    }
    const stem = name.slice(0, index);
    const ext = name.slice(index);
    return [stem, ext];
}

function naturalCompare(s1: string, s2: string): number {
    return s1.localeCompare(s2, undefined, { numeric: true });
}

export interface EntryData {
    readonly path: Path;
    readonly content: Blob;
}

export async function getEntriesWithData(httpReader: HttpReader): Promise<EntryData[] | undefined> {
    const zipReader = new ZipReader(httpReader);
    try {
        const entries: FileEntry[] = [];
        for await (const entry of zipReader.getEntriesGenerator()) {
            if (!entry.directory) {
                entries.push(entry);
            }
        }
        let password: string | undefined;
        const encryptedEntry = entries.find((entry) => entry.encrypted);
        if (encryptedEntry) {
            password = await requestPassword(encryptedEntry);
            // user didn't provide a valid password, abort.
            if (!password) {
                return;
            }
        }
        const promises = entries.map(async (entry) => {
            const path = new Path(entry.filename);
            const mimeType = getMimeType(path.extension);
            const content = await entry.getData(new BlobWriter(mimeType), { password });
            return { content, path };
        });
        const entriesWithData = await Promise.all(promises);
        return entriesWithData;
    } finally {
        await zipReader.close();
    }
}
