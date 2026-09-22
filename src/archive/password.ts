import * as zip from '@zip.js/zip.js';

const dialog = document.querySelector<HTMLDialogElement>('#archive-password-dialog')!;
const dialogLabel = dialog.querySelector('label')!;
const dialogInput = dialog.querySelector('input')!;

/**
 * Show a request for the archive password in a dialog.
 * Returns `undefined` if the user cancels or dismisses the dialog.
 */
async function showDialog(message: string): Promise<string | undefined> {
    dialogLabel.textContent = message;
    dialogInput.value = '';
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
        const onClose = () => {
            const password = dialog.returnValue === 'confirm' ? dialogInput.value : undefined;
            resolve(password);
        };
        dialog.addEventListener('close', onClose, { once: true });
    });
}

function hasMessage(value: unknown): value is { message: unknown } {
    return typeof value === 'object' && value !== null && 'message' in value;
}

const PASSWORD_MESSAGE = 'Enter archive password:';
const INVALID_PASSWORD_MESSAGE = 'Invalid password, try again:';

/**
 * Repeatedly request for the entry's password until it succeeds or the request is canceled.
 */
export async function requestPassword(entry: zip.FileEntry): Promise<string | undefined> {
    const writer = new zip.BlobWriter();
    let message = PASSWORD_MESSAGE;
    while (true) {
        const password = await showDialog(message);
        if (!password) {
            return undefined;
        }
        try {
            await entry.getData(writer, { password, checkPasswordOnly: true });
            return password;
        } catch (error) {
            if (hasMessage(error) && error.message === zip.ERR_INVALID_PASSWORD) {
                message = INVALID_PASSWORD_MESSAGE;
            } else {
                throw error;
            }
        }
    }
}
