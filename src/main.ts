import { BlobReader, HttpReader } from '@zip.js/zip.js';
import { parse } from 'content-disposition';
import { getEntriesWithData } from './archive/entry';
import { displayEntries } from './archive/render';
import './style.css';

const scrollTopButton = document.getElementById('scroll-top')!;
scrollTopButton.addEventListener('click', () => window.scroll({ top: 0 }));

// Show/hide 'scroll to top' button
window.addEventListener('scroll', () => {
    const button = scrollTopButton;
    if (button.hidden) {
        const viewportHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const isDocumentTallEnough = documentHeight > viewportHeight * 2;
        const hasScrolledFarEnough = window.scrollY > viewportHeight * 0.75;
        button.hidden = !(isDocumentTallEnough && hasScrolledFarEnough);
    } else if (window.scrollY === 0) {
        const listener = () => {
            button.hidden = true;
            button.classList.replace('opacity-0', 'opacity-100');
            button.removeEventListener('transitionend', listener);
        };
        button.addEventListener('transitionend', listener);
        button.classList.replace('opacity-100', 'opacity-0');
    }
});

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
        const { filename } = parse(contentDisposition).parameters;
        if (filename) {
            return filename;
        }
    }
    const param = url.searchParams.get('f');
    if (param) {
        return param;
    }
    const component = url.pathname.split('/').at(-1);
    return component ? decodeURIComponent(component) : url.href;
}

const form = document.querySelector<HTMLFormElement>('#view-form')!;
const input = document.querySelector<HTMLInputElement>('#url')!;
const button = document.querySelector<HTMLButtonElement>('#view-button')!;
const filePicker = document.querySelector<HTMLInputElement>('#file-picker')!;
const view = document.querySelector<HTMLElement>('#archive-view')!;

document.getElementById('focus-input')?.addEventListener('click', () => {
    input.select();
    input.focus();
});

filePicker.addEventListener('change', async () => {
    if (filePicker.files?.length !== 1) {
        return;
    }
    const file = filePicker.files[0];
    try {
        view.inert = true;
        input.disabled = true;
        button.disabled = true;
        filePicker.disabled = true;

        const entries = await getEntriesWithData(new BlobReader(file));
        if (!entries) {
            return;
        }
        const { name, size } = file;
        await displayEntries(entries, { name, size, replace: true });
    } catch (error) {
        alert(`Error while processing archive:\n${error}`);
        console.error(error);
        return;
    } finally {
        view.inert = false;
        input.disabled = false;
        button.disabled = false;
        filePicker.disabled = false;
    }
});

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
        view.inert = true;
        input.disabled = true;
        button.disabled = true;
        filePicker.disabled = true;
        progress.max = 1;
        progress.value = 0;
        progress.classList.remove('invisible');

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
        view.inert = false;
        input.disabled = false;
        button.disabled = false;
        filePicker.disabled = false;
        progress.max = 1;
        progress.value = 0;
        progress.classList.add('invisible');
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
