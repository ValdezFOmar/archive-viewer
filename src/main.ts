import { BlobWriter, HttpReader, TextWriter, ZipReader, type Entry } from '@zip.js/zip.js';

function splitFileName(filename: string): [string, string] {
    let index = filename.lastIndexOf('.');
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

    let entries: Entry[];
    try {
        input.disabled = true;
        button.disabled = true;
        progress.max = 1;
        progress.value = 0;
        progress.hidden = false;
        entries = await zipReader.getEntries();
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

    // TODO:
    // To provide better sorting, transform the entries array and parse
    // the 'filename' property into directory components and the actual filename,
    // then entries can be sorted in order:
    //  - depth (top level files first, nested files later)
    //  - directory name (for directories at the same depth)
    //  - file name (for files within the same directory)
    //  - extension (when all other values are the same)
    entries.sort((entry1, entry2) => {
        const [name1, ext1] = splitFileName(entry1.filename);
        const [name2, ext2] = splitFileName(entry2.filename);
        const result = name1.localeCompare(name2, undefined, { numeric: true });
        return result === 0 ? ext1.localeCompare(ext2) : result;
    });

    // cleanup
    for (const img of archiveEntries.querySelectorAll('img')) {
        URL.revokeObjectURL(img.src);
    }
    archiveEntries.replaceChildren();

    const entryTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry')!;
    const textTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-text')!;
    const imageTemplate = document.querySelector<HTMLTemplateElement>('#t-archive-entry-image')!;

    let fileCount = 0;
    for (const entry of entries) {
        const clone = document.importNode(entryTemplate.content, true);
        const container = clone.querySelector('li')!;
        const pathContainer = clone.querySelector<HTMLElement>('.file-path')!;
        const filePath = entry.filename;
        pathContainer.textContent = filePath;

        if (!entry.directory) {
            fileCount++;
            if (/\.(txt|py|md|json|csv|xml|html)$/.test(filePath)) {
                const text = await entry.getData(new TextWriter());
                if (text !== '') {
                    const node = document.importNode(textTemplate.content, true);
                    const pre = node.querySelector('pre')!;
                    pre.textContent = text;
                    pathContainer.parentElement?.append(node);
                }
            } else if (/\.(png|jpg|jpeg|gif|webp)$/.test(filePath)) {
                const node = document.importNode(imageTemplate.content, true);
                const img = node.querySelector('img')!;
                const blob = await entry.getData(new BlobWriter());
                img.src = URL.createObjectURL(blob);
                container.append(node);
            }
        }

        archiveEntries.append(clone);
    }

    archiveDetails.textContent = `Files: ${fileCount}; Size: ${formatFileSize(httpReader.size)}`;
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
