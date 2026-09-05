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

document.getElementById('view-form')!.addEventListener('submit', async event => {
    event.preventDefault();

    const input = document.getElementById('url') as HTMLInputElement;
    const button = document.getElementById('view-button') as HTMLButtonElement;
    const archiveView = document.getElementById('archive-view')!;
    const archiveDetails = document.getElementById('archive-details')!;
    const archiveEntries = document.getElementById('archive-entries')!;

    const archiveUrl = input.value;
    const httpReader = new HttpReader(archiveUrl);
    const zipReader = new ZipReader(httpReader);

    let entries: Entry[];
    try {
        input.disabled = true;
        button.disabled = true;
        entries = await zipReader.getEntries();
    } catch (error) {
        alert('Could not preview file');
        console.debug(error);
        return;
    } finally {
        input.disabled = false;
        button.disabled = false;
    }

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
                const fragment = document.importNode(textTemplate.content, true);
                const pre = fragment.querySelector('pre')!;
                const text = await entry.getData(new TextWriter());
                if (text !== '') {
                    pre.textContent = await entry.getData(new TextWriter());
                    pathContainer.parentElement?.append(fragment);
                }
            } else if (/\.(png|jpg|jpeg|gif)$/.test(filePath)) {
                const fragment = document.importNode(imageTemplate.content, true);
                const img = fragment.querySelector('img')!;
                const blob = await entry.getData(new BlobWriter());
                img.src = URL.createObjectURL(blob);
                container.append(fragment);
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
