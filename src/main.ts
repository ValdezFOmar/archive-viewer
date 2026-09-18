import * as zip from '@zip.js/zip.js';
import { BlobWriter, HttpReader, ZipReader, type FileEntry } from '@zip.js/zip.js';

// Image and video mime types commonly supported in browsers
const IMAGE_MIME_TYPES = new Set([
    'image/apng',
    'image/avif',
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/jxl',
    'image/png',
    'image/svg+xml',
    'image/webp',
    'image/x-icon',
]);
const VIDEO_MIME_TYPES = new Set([
    'video/matroska',
    'video/mp4',
    'video/mpeg',
    'video/ogg',
    'video/webm',
    'video/x-matroska',
    'video/x-smvideo',
]);

class ArchiveEntry {
    readonly file: FileEntry;
    readonly stem: string;
    readonly name: string;
    readonly extension: string;
    readonly parents: readonly string[];

    constructor(entry: FileEntry) {
        const components = entry.filename.split('/');
        const name = components.pop()!;
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

function countLines(text: string): number {
    let lineCount = text.endsWith('\n') ? 0 : 1;
    for (const _ of text.matchAll(/\n/g)) {
        lineCount++;
    }
    return lineCount;
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

function hasMessage(value: unknown): value is { message: unknown } {
    return typeof value === 'object' && value !== null && 'message' in value;
}

class CancelDialog extends Error {}

async function showPasswordDialog(message?: string): Promise<string> {
    const dialog = document.querySelector('dialog')!;
    const label = dialog.querySelector('label')!;
    const input = dialog.querySelector('input')!;
    label.textContent = message ?? 'Password:';
    input.value = '';
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve, reject) => {
        const onClose = () => {
            if (dialog.returnValue === 'confirm') {
                resolve(input.value);
            } else {
                reject(new CancelDialog(`Closed with: "${dialog.returnValue}"`));
            }
        };
        dialog.addEventListener('close', onClose, { once: true });
    });
}

async function getPassword(entries: ArchiveEntry[]): Promise<string | undefined> {
    const testEntry = entries.find((entry) => entry.file.encrypted);
    if (!testEntry) {
        return undefined;
    }
    const writer = new BlobWriter();
    let message = 'Enter password:';
    while (true) {
        const password = await showPasswordDialog(message);
        try {
            await testEntry.file.getData(writer, { password, checkPasswordOnly: true });
            return password;
        } catch (error) {
            if (hasMessage(error) && error.message === zip.ERR_INVALID_PASSWORD) {
                message = 'Invalid password, try again:';
            } else {
                throw error;
            }
        }
    }
}

async function displayEntries(
    entries: ArchiveEntry[],
    archiveSize: number,
): Promise<DocumentFragment> {
    const archiveTemplate = document.querySelector<HTMLTemplateElement>('#t-archive')!;
    const entryTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry')!;
    const textTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-text')!;
    const imageTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-image')!;
    const videoTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-video')!;
    const buttonTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-extract')!;

    const password = await getPassword(entries);

    const promisess = entries.map(async (entry) => {
        const clone = document.importNode(entryTemplate.content, true);
        const container = clone.querySelector('li')!;
        const pathContainer = clone.querySelector<HTMLAnchorElement>('.file-path')!;

        const mimeType = zip.getMimeType(entry.name);
        const blob = await entry.file.getData(new BlobWriter(mimeType), { password });
        const objUrl = URL.createObjectURL(blob);

        pathContainer.href = objUrl;
        pathContainer.download = entry.name;
        pathContainer.textContent = entry.path.replaceAll('_', '_\u{200B}'); // for better word breaking

        if (mimeType.startsWith('text')) {
            const text = await blob.text();
            if (text !== '' && text !== '\n' && text !== '\r\n') {
                const node = document.importNode(textTemplate.content, true);
                const pre = node.querySelector('pre')!;
                const lines = node.querySelector('.lines')!;
                const button = node.querySelector('button')!;
                button.addEventListener('click', async () => {
                    await navigator.clipboard.writeText(text);
                });
                const lineCount = countLines(text);
                lines.textContent = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
                pre.textContent = text;
                container.append(node);
            }
        } else if (IMAGE_MIME_TYPES.has(mimeType)) {
            const node = document.importNode(imageTemplate.content, true);
            const img = node.querySelector('img')!;
            img.src = objUrl;
            img.alt = entry.name;
            container.append(node);
        } else if (VIDEO_MIME_TYPES.has(mimeType)) {
            const node = document.importNode(videoTemplate.content, true);
            const video = node.querySelector('video')!;
            video.src = objUrl;
            container.append(node);
        } else if (mimeType === 'application/zip') {
            const node = document.importNode(buttonTemplate.content, true);
            const button = node.querySelector('button')!;
            button.addEventListener('click', async () => {
                const httpReader = new HttpReader(objUrl, { preventHeadRequest: true });
                const subArchive = await getArchiveElement(httpReader);
                const subHeading = subArchive.querySelector('.sub-heading')!;
                subHeading.textContent = entry.path;
                viewContainer.append(subArchive);
                subHeading.parentElement?.scrollIntoView({ behavior: 'smooth' });
                button.remove();
            });
            container.children[0].append(node);
        }

        return { entry, node: clone };
    });

    const archiveEntries = await Promise.all(promisess);
    archiveEntries.sort((a, b) => a.entry.comparePath(b.entry));

    const archiveContainer = document.importNode(archiveTemplate.content, true);
    const detailsContainer = archiveContainer.querySelector('.archive-details')!;
    const entriesContainer = archiveContainer.querySelector('.archive-entries')!;

    detailsContainer.children[0].append(archiveEntries.length.toString());
    detailsContainer.children[1].append(formatFileSize(archiveSize));
    entriesContainer.append(...archiveEntries.map((entry) => entry.node));
    return archiveContainer;
}

async function getArchiveElement(httpReader: HttpReader): Promise<DocumentFragment> {
    const zipReader = new ZipReader(httpReader);
    try {
        const entries: ArchiveEntry[] = [];
        for await (const entry of zipReader.getEntriesGenerator()) {
            if (!entry.directory) {
                entries.push(new ArchiveEntry(entry));
            }
        }
        const node = await displayEntries(entries, httpReader.size);
        return node;
    } finally {
        await zipReader.close();
    }
}

const form = document.querySelector<HTMLFormElement>('#view-form')!;
const input = document.querySelector<HTMLInputElement>('#url')!;
const button = document.querySelector<HTMLButtonElement>('#view-button')!;
const viewContainer = document.getElementById('archive-view')!;

form.addEventListener('submit', async (event) => {
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

    try {
        input.disabled = true;
        button.disabled = true;
        progress.max = 1;
        progress.value = 0;
        progress.hidden = false;

        const node = await getArchiveElement(httpReader);
        // release resources before replacing the archive view
        for (const element of viewContainer.querySelectorAll('img, video, a')) {
            const url = element.getAttribute('src') ?? element.getAttribute('href');
            if (url) {
                URL.revokeObjectURL(url);
            }
        }
        viewContainer.replaceChildren(node);
    } catch (error) {
        if (error instanceof CancelDialog) {
            console.debug(error);
            return;
        }
        alert(`Error while processing archive:\n${error}`);
        console.error(error);
        return;
    } finally {
        input.disabled = false;
        button.disabled = false;
        progress.max = 1;
        progress.value = 0;
        progress.hidden = true;
    }

    viewContainer.hidden = false;

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
