import { HttpReader } from '@zip.js/zip.js';
import { type EntryData, Path, getEntriesWithData } from './entry';

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

class Template {
    readonly #template;

    constructor(template: HTMLTemplateElement) {
        this.#template = template;
    }

    clone(): DocumentFragment {
        return document.importNode(this.#template.content, true);
    }

    static validate<K extends string>(elements: Record<K, unknown>): Record<K, Template> {
        const templates = Object.create(null) as Record<K, Template>;
        for (const key in elements) {
            if (!Object.hasOwn(elements, key)) {
                continue;
            }
            const element = elements[key];
            if (!(element instanceof HTMLTemplateElement)) {
                throw new Error(`Expected a template element for "${key}", got "${element}"`);
            }
            templates[key] = new Template(element);
        }
        return templates;
    }
}

const templates = Template.validate({
    archive: document.querySelector('#t-archive'),
    entry: document.querySelector('#t-archive-entry'),
    entryText: document.querySelector('#t-archive-entry-text'),
    entryImage: document.querySelector('#t-archive-entry-image'),
    entryVideo: document.querySelector('#t-archive-entry-video'),
    entryExtract: document.querySelector('#t-archive-entry-extract'),
});

function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const kilobytes = bytes / 1024;
    if (kilobytes < 1024) {
        return `${kilobytes.toFixed(1)} KB`;
    }
    const megabytes = kilobytes / 1024;
    return `${megabytes.toFixed(2)} MB`;
}

function countLines(text: string): number {
    let lineCount = text.endsWith('\n') ? 0 : 1;
    for (const _ of text.matchAll(/\n/g)) {
        lineCount++;
    }
    return lineCount;
}

function displayPath(container: Element, path: Path): void {
    // 'Zero Width Space' to mark possible line breaks.
    const zws = '\u{200B}';
    if (path.prefix !== '') {
        const span = document.createElement('span');
        span.classList.add('text-zinc-400');
        span.append(path.prefix.replaceAll('_', zws + '_' + zws));
        container.append(span);
    }
    container.append(path.name.replaceAll('_', zws + '_' + zws));
}

interface DisplayInfo {
    readonly size: number;
    readonly name: string;
    readonly replace?: boolean;
}

const viewContainer = document.getElementById('archive-view')!;

export async function displayEntries(entries: EntryData[], info: DisplayInfo): Promise<Element> {
    const archiveContainer = templates.archive.clone();
    const detailsContainer = archiveContainer.querySelector('.archive-details')!;
    const entriesContainer = archiveContainer.querySelector('.archive-entries')!;
    const nameContainer = archiveContainer.querySelector('.archive-name')!;

    nameContainer.textContent = info.name;
    detailsContainer.children[0].append(entries.length.toString());
    detailsContainer.children[1].append(formatFileSize(info.size));

    entries.sort((a, b) => a.path.compare(b.path));

    for (const { content, path } of entries) {
        const clone = templates.entry.clone();
        const container = clone.querySelector('li')!;
        const pathContainer = clone.querySelector('.path')!;
        const downloadButton = clone.querySelector('a')!;

        const mimeType = content.type;
        const objUrl = URL.createObjectURL(content);

        downloadButton.href = objUrl;
        downloadButton.download = path.name;
        displayPath(pathContainer, path);

        if (mimeType.startsWith('text')) {
            const text = await content.text();
            if (text !== '' && text !== '\n' && text !== '\r\n') {
                const node = templates.entryText.clone();
                const pre = node.querySelector('pre')!;
                const lines = node.querySelector('.lines')!;
                const button = node.querySelector('button')!;
                button.addEventListener('click', async () => {
                    await navigator.clipboard.writeText(pre.innerText);
                });
                const lineCount = countLines(text);
                lines.textContent = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
                pre.textContent = text;
                container.append(node);
            }
        } else if (IMAGE_MIME_TYPES.has(mimeType)) {
            const node = templates.entryImage.clone();
            const img = node.querySelector('img')!;
            img.src = objUrl;
            img.alt = `Contents of ${path}`;
            container.append(node);
        } else if (VIDEO_MIME_TYPES.has(mimeType)) {
            const node = templates.entryVideo.clone();
            const video = node.querySelector('video')!;
            video.src = objUrl;
            container.append(node);
        } else if (mimeType === 'application/zip') {
            const node = templates.entryExtract.clone();
            const button = node.querySelector('button')!;
            pathContainer.after(node);
            button.addEventListener('click', async () => {
                try {
                    button.disabled = true;
                    const httpReader = new HttpReader(objUrl, { preventHeadRequest: true });
                    const entries = await getEntriesWithData(httpReader);
                    if (!entries) {
                        return;
                    }
                    const container = await displayEntries(entries, {
                        size: httpReader.size,
                        name: path.name,
                    });
                    container.scrollIntoView({ behavior: 'smooth' });
                } catch (error) {
                    alert(`Error while processing archive "${path.name}":\n${error}`);
                    console.error(error);
                    return;
                } finally {
                    button.disabled = false;
                }
                button.remove();
            });
        }

        entriesContainer.append(clone);
    }

    const archive = archiveContainer.children[0];
    if (info.replace) {
        for (const element of viewContainer.querySelectorAll('img, video, a')) {
            const url = element.getAttribute('src') ?? element.getAttribute('href');
            if (url) {
                URL.revokeObjectURL(url);
            }
        }
        viewContainer.replaceChildren(archiveContainer);
    } else {
        viewContainer.append(archiveContainer);
    }

    return archive;
}
