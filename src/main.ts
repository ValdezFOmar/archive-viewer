import '@csstools/normalize.css';
import './style.css';
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
    const archiveView = document.getElementById('archive-view')!;
    const archiveDetails = document.getElementById('archive-details')!;
    const archiveEntries = document.getElementById('archive-entries')!;
    const template = document.getElementById('archive-entry-template') as HTMLTemplateElement;

    const archiveUrl = input.value;
    const httpReader = new HttpReader(archiveUrl);
    const zipReader = new ZipReader(httpReader);

    let entries: Entry[];
    try {
        entries = await zipReader.getEntries();
    } catch (error) {
        alert('Could not preview file');
        console.debug(error);
        return;
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

    let fileCount = 0;
    for (const entry of entries) {
        const clone = document.importNode(template.content, true);
        const parent = clone.querySelector('.archive-entry')!;

        if (!entry.directory) {
            fileCount++;
        }

        if (!entry.directory && /\.(txt|py|md|json|csv|xml|html)$/.test(entry.filename)) {
            const details = document.createElement('details');
            const pre = document.createElement('pre');
            pre.innerText = await entry.getData(new TextWriter());
            details.append(pre);
            parent.append(details);
        } else if (!entry.directory && /\.(png|jpg|jpeg|gif)$/.test(entry.filename)) {
            const img = document.createElement('img');
            const blob = await entry.getData(new BlobWriter());
            img.src = URL.createObjectURL(blob);
            parent.append(img);
        }

        const fileName = clone.querySelector<HTMLElement>('.file-name')!;
        fileName.innerText = entry.filename;
        if (entry.directory) {
            fileName.insertAdjacentText('afterend', ' (directory)');
        }
        archiveEntries.append(clone);
    }

    archiveDetails.textContent = `Entries: ${entries.length} (${fileCount} Files); Size: ${formatFileSize(httpReader.size)}`;
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
