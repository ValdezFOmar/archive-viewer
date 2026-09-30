import { HttpReader } from '@zip.js/zip.js';
import { getEntriesWithData } from './archive/entry';
import { displayEntries } from './archive/render';
import './style.css';

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

function guessName(url: URL, headers?: Headers): string {
    const contentDisposition = headers?.get('Content-Disposition');
    if (contentDisposition) {
        const parts = contentDisposition.split(/\s*;\s*/);
        const param = parts.find((part) => part.startsWith('filename='));
        if (param) {
            const [_, filename] = param.trim().split('=');
            const match = /"([^"]|\\.)+"/.exec(filename);
            return match?.[1] || filename;
        }
    }
    return url.searchParams.get('f') || url.pathname.split('/').pop() || url.href;
}

const form = document.querySelector<HTMLFormElement>('#view-form')!;
const input = document.querySelector<HTMLInputElement>('#url')!;
const button = document.querySelector<HTMLButtonElement>('#view-button')!;

form.addEventListener('submit', async (event) => {
    event.preventDefault();

    let headers: Headers | undefined;
    const progress = document.querySelector('progress')!;
    const archiveUrl = new URL(input.value);
    const httpReader = new HttpReader(archiveUrl, {
        fetch: async (input, init) => {
            const isGet = !init?.method || init.method === 'GET';
            const response = await fetch(input, init);
            if (isGet && response.ok) {
                headers = response.headers;
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

        const entries = await getEntriesWithData(httpReader);
        if (!entries) {
            return;
        }
        const name = guessName(archiveUrl, headers);
        await displayEntries(entries, { name, size: httpReader.size, replace: true });
    } catch (error) {
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

    // NOTE:
    // Avoid pushing consecutive repetitions of the same URL
    // since it can be confusing for navigation.
    const url = archiveUrl.href;
    if (history.state?.url !== url) {
        const location = new URL(window.location.href);
        location.searchParams.set('url', url);
        history.pushState({ url }, '', location);
    }
});

window.addEventListener('popstate', (event) => {
    input.value = event.state?.url ?? '';
});

{
    const location = new URL(window.location.href);
    const url = location.searchParams.get('url');
    if (url) {
        history.replaceState({ url }, '', location);
        input.value = url;
        button.click();
    }
}
