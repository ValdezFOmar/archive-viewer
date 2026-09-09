import { BlobWriter, HttpReader, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';

const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.py', '.md', '.json', '.csv', '.xml', '.html']);
const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.webm']);

class ArchiveEntry {
    readonly file: FileEntry;
    readonly stem: string;
    readonly name: string;
    readonly extension: string;
    readonly parents: readonly string[];

    constructor(entry: FileEntry) {
        const components = entry.filename.split('/');
        const [name] = components.splice(components.length - 1, 1);
        const [stem, extension] = splitFileName(name);
        this.file = entry;
        this.name = name;
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
        return `${bytes} B`;
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

async function displayEntries(entries: ArchiveEntry[], archiveSize: number) {
    const entryTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry')!;
    const textTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-text')!;
    const imageTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-image')!;
    const videoTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-video')!;

    const promisess = entries.map(async entry => {
        const clone = document.importNode(entryTemplate.content, true);
        const container = clone.querySelector('li')!;
        const pathContainer = clone.querySelector<HTMLAnchorElement>('.file-path')!;

        const blob = await entry.file.getData(new BlobWriter());
        const objUrl = URL.createObjectURL(blob);

        pathContainer.href = objUrl;
        pathContainer.download = entry.name;
        pathContainer.textContent = entry.path;

        if (TEXT_FILE_EXTENSIONS.has(entry.extension)) {
            const text = await entry.file.getData(new TextWriter());
            if (text.trim() !== '') {
                const node = document.importNode(textTemplate.content, true);
                const pre = node.querySelector('pre')!;
                pre.textContent = text;
                pathContainer.parentElement?.append(node);
            }
        } else if (IMAGE_FILE_EXTENSIONS.has(entry.extension)) {
            const node = document.importNode(imageTemplate.content, true);
            const img = node.querySelector('img')!;
            img.src = objUrl;
            img.alt = entry.name;
            container.append(node);
        } else if (VIDEO_FILE_EXTENSIONS.has(entry.extension)) {
            const node = document.importNode(videoTemplate.content, true);
            const video = node.querySelector('video')!;
            video.src = objUrl;
            container.append(node);
        }

        return { entry, node: clone };
    });

    const archiveEntries = await Promise.all(promisess);
    archiveEntries.sort((a, b) => a.entry.comparePath(b.entry));

    const viewContainer = document.getElementById('archive-view')!;
    const detailsContainer = document.getElementById('archive-details')!;
    const entriesContainer = document.getElementById('archive-entries')!;

    // Cleanup
    for (const element of entriesContainer.querySelectorAll('img, video, a')) {
        const url = element.getAttribute('src') ?? element.getAttribute('href');
        if (url) {
            URL.revokeObjectURL(url);
        }
    }

    detailsContainer.children[0].textContent = `Files: ${archiveEntries.length}`;
    detailsContainer.children[1].textContent = `Size: ${formatFileSize(archiveSize)}`;
    entriesContainer.replaceChildren(...archiveEntries.map(entry => entry.node));
    viewContainer.hidden = false;
}

const form = document.querySelector<HTMLFormElement>('#view-form')!;
const input = document.querySelector<HTMLInputElement>('#url')!;
const button = document.querySelector<HTMLButtonElement>('#view-button')!;

form.addEventListener('submit', async event => {
    event.preventDefault();

    const progress = document.querySelector('progress')!;
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

    try {
        input.disabled = true;
        button.disabled = true;
        progress.max = 1;
        progress.value = 0;
        progress.hidden = false;

        const entries: ArchiveEntry[] = [];
        for await (const entry of zipReader.getEntriesGenerator()) {
            if (!entry.directory) {
                entries.push(new ArchiveEntry(entry));
            }
        }

        await displayEntries(entries, httpReader.size);
    } catch (error) {
        alert(`Error while processing archive:\n${error}`);
        console.error(error);
    } finally {
        input.disabled = false;
        button.disabled = false;
        progress.max = 1;
        progress.value = 0;
        progress.hidden = true;
        await zipReader.close();
    }

    if (import.meta.env.DEV) {
        const url = new URL(location.href);
        url.searchParams.set('url', input.value);
        history.pushState(null, '', url);
    }
});

{
    const href = new URL(location.href);
    const url = href.searchParams.get('url');
    if (url) {
        input.value = url;
        button.click();
    }
}
