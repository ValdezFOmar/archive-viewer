import { BlobWriter, HttpReader, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';

const TEXT_FILE_EXTENSION = new Set(['.txt', '.py', '.md', '.json', '.csv', '.xml', '.html']);
const IMAGE_FILE_EXTENSION = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

class ArchiveEntry {
    readonly file: FileEntry;
    readonly stem: string;
    readonly extension: string;
    readonly parents: readonly string[];

    constructor(entry: FileEntry) {
        const components = entry.filename.split('/');
        const [name] = components.splice(components.length - 1, 1);
        const [stem, extension] = splitFileName(name);
        this.file = entry;
        this.stem = stem;
        this.extension = extension;
        this.parents = components;
    }

    get path(): string {
        return this.file.filename;
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
    comparePath(other: ArchiveEntry): number {
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
}

function naturalCompare(s1: string, s2: string): number {
    return s1.localeCompare(s2, undefined, { numeric: true });
}

/**
 * Split a file name into the stem (part before the extension) and
 * its file extension (includes '.').
 *
 * 'file.zip' => ['file', '.zip']
 * '.gitignore' => ['.gitignore', '']
 */
function splitFileName(filename: string): [string, string] {
    let index = filename.lastIndexOf('.');
    if (index === 0) {
        return [filename, ''];
    }
    if (index === -1) {
        index = filename.length;
    }
    const name = filename.slice(0, index);
    const ext = filename.slice(index);
    return [name, ext];
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} bytes`;
    }
    const kilobytes = bytes / 1024;
    if (kilobytes < 1024) {
        return kilobytes.toFixed(0) + ' KB';
    }
    const megabytes = kilobytes / 1024;
    return megabytes.toFixed(0) + ' MB';
}

// NOTE: Always consume the response, otherwise it could cause performance/memory problems.
async function updateProgressBar(progress: HTMLProgressElement, response: Response) {
    if (response.body) {
        const contentLength = response.headers.get('Content-Length');
        const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : null;
        if (totalBytes) {
            progress.max = totalBytes;
        } else {
            progress.removeAttribute('value'); // make progress indeterminate
        }
        let bytes = 0;
        const reader = response.body.getReader();
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            bytes += value.length;
            // updating 'value' only makes sense when there's a know 'max'
            if (totalBytes) {
                progress.value = bytes;
            }
        }
    }
}

document.getElementById('view-form')!.addEventListener('submit', async event => {
    event.preventDefault();

    const input = document.getElementById('url') as HTMLInputElement;
    const button = document.getElementById('view-button') as HTMLButtonElement;
    const progress = document.querySelector('progress')!;
    const archiveView = document.getElementById('archive-view')!;
    const archiveDetails = document.getElementById('archive-details')!;
    const archiveEntries = document.getElementById('archive-entries')!;

    const archiveUrl = input.value;
    const httpReader = new HttpReader(archiveUrl, {
        fetch: async (input, init) => {
            const isGet = !init?.method || init.method === 'GET';
            const response = await fetch(input, init);
            if (isGet && response.ok) {
                updateProgressBar(progress, response.clone());
            }
            return response;
        },
    });
    const zipReader = new ZipReader(httpReader);

    let entries: ArchiveEntry[] = [];
    try {
        input.disabled = true;
        button.disabled = true;
        progress.max = 1;
        progress.value = 0;
        progress.hidden = false;
        for await (const entry of zipReader.getEntriesGenerator()) {
            if (!entry.directory) {
                entries.push(new ArchiveEntry(entry));
            }
        }
    } catch (error) {
        alert('Could not preview file');
        console.error(error);
        return;
    } finally {
        input.disabled = false;
        button.disabled = false;
        progress.hidden = true;
        await zipReader.close();
    }

    // Maybe add other methods for sorting entries?
    entries.sort((a, b) => a.comparePath(b));

    // cleanup
    for (const img of archiveEntries.querySelectorAll('img')) {
        URL.revokeObjectURL(img.src);
    }
    archiveEntries.replaceChildren();

    const entryTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry')!;
    const textTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-text')!;
    const imageTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-image')!;

    for (const entry of entries) {
        const clone = document.importNode(entryTemplate.content, true);
        const container = clone.querySelector('li')!;
        const pathContainer = clone.querySelector<HTMLElement>('.file-path')!;
        pathContainer.textContent = entry.path;

        if (TEXT_FILE_EXTENSION.has(entry.extension)) {
            const text = await entry.file.getData(new TextWriter());
            if (text !== '') {
                const node = document.importNode(textTemplate.content, true);
                const pre = node.querySelector('pre')!;
                pre.textContent = text;
                pathContainer.parentElement?.append(node);
            }
        } else if (IMAGE_FILE_EXTENSION.has(entry.extension)) {
            const node = document.importNode(imageTemplate.content, true);
            const img = node.querySelector('img')!;
            const blob = await entry.file.getData(new BlobWriter());
            img.src = URL.createObjectURL(blob);
            container.append(node);
        }

        archiveEntries.append(clone);
    }

    archiveDetails.textContent = `Files: ${entries.length}; Size: ${formatFileSize(httpReader.size)}`;
    archiveView.hidden = false;

    const url = new URL(window.location.href);
    url.searchParams.set('url', archiveUrl);
    window.history.pushState(null, '', url);
});

{
    const input = document.querySelector<HTMLInputElement>('#url')!;
    const button = document.querySelector<HTMLButtonElement>('#view-button')!;
    const href = new URL(window.location.href);
    const url = href.searchParams.get('url');
    if (url) {
        input.value = url;
        button.click();
    }
}
