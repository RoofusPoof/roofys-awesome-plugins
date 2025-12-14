import { showToast, Toasts } from "@webpack/common";

import { settings } from "./settings";

export interface Account {
    id: string;
    nickname: string;
    token: string;
    avatarUrl?: string;
    discordId?: string;
    addedAt: number;
}

export interface DiscordUserInfo {
    id: string;
    username: string;
    discriminator: string;
    global_name: string | null;
    avatar: string | null;
}

export interface ParsedTokenLine {
    email?: string;
    password?: string;
    token: string;
}

export interface MassImportResult {
    success: number;
    failed: number;
    errors: string[];
}

export function getAccounts(): Account[] {
    try {
        return JSON.parse(settings.store.accounts);
    } catch {
        return [];
    }
}

export function saveAccounts(accounts: Account[]) {
    settings.store.accounts = JSON.stringify(accounts);
}

export function getAvatarUrl(userId: string, avatarHash: string | null): string {
    if (!avatarHash) {
        const defaultIndex = Number(BigInt(userId) >> 22n) % 6;
        return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
    }
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
}

export function parseTokenLine(line: string): ParsedTokenLine | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const parts = trimmed.split(":");

    if (parts.length >= 3) {
        const email = parts[0];
        const password = parts[1];
        const token = parts.slice(2).join(":");
        return { email, password, token };
    } else if (parts.length === 1) {
        return { token: trimmed };
    }

    return null;
}

export async function validateToken(token: string): Promise<DiscordUserInfo | null> {
    try {
        const response = await fetch("https://discord.com/api/v9/users/@me", {
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) return null;
        return await response.json() as DiscordUserInfo;
    } catch {
        return null;
    }
}

export function addAccountSilent(nickname: string, token: string, discordId?: string, avatarUrl?: string): Account | null {
    const accounts = getAccounts();
    if (accounts.find(acc => acc.token === token)) return null;

    const newAccount: Account = {
        id: `account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nickname: nickname.trim(),
        token: token.trim(),
        discordId,
        avatarUrl,
        addedAt: Date.now()
    };

    accounts.push(newAccount);
    saveAccounts(accounts);
    return newAccount;
}

export function addAccount(nickname: string, token: string, discordId?: string, avatarUrl?: string): Account {
    const accounts = getAccounts();
    const existing = accounts.find(acc => acc.token === token);
    if (existing) {
        showToast(`Already saved as "${existing.nickname}"`, Toasts.Type.FAILURE);
        throw new Error("Token exists");
    }

    const newAccount: Account = {
        id: `account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nickname: nickname.trim(),
        token: token.trim(),
        discordId,
        avatarUrl,
        addedAt: Date.now()
    };

    accounts.push(newAccount);
    saveAccounts(accounts);
    showToast(`Added: ${nickname}`, Toasts.Type.SUCCESS);
    return newAccount;
}

export async function massImportTokens(
    text: string,
    onProgress?: (current: number, total: number) => void
): Promise<MassImportResult> {
    const lines = text.split("\n").filter(line => line.trim());
    const result: MassImportResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < lines.length; i++) {
        if (onProgress) onProgress(i + 1, lines.length);

        const parsed = parseTokenLine(lines[i]);
        if (!parsed) {
            result.failed++;
            result.errors.push(`Line ${i + 1}: Invalid format`);
            continue;
        }

        try {
            const userInfo = await validateToken(parsed.token);
            if (!userInfo) {
                result.failed++;
                result.errors.push(`Line ${i + 1}: Invalid token`);
                continue;
            }

            const displayName = userInfo.global_name || userInfo.username;
            const avatarUrl = getAvatarUrl(userInfo.id, userInfo.avatar);
            const account = addAccountSilent(displayName, parsed.token, userInfo.id, avatarUrl);

            if (account) {
                result.success++;
            } else {
                result.failed++;
                result.errors.push(`Line ${i + 1}: Already exists`);
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            result.failed++;
            result.errors.push(`Line ${i + 1}: ${error}`);
        }
    }

    return result;
}

export function updateAccount(id: string, nickname: string, token: string): boolean {
    const accounts = getAccounts();
    const index = accounts.findIndex(acc => acc.id === id);

    if (index === -1) {
        showToast("Not found", Toasts.Type.FAILURE);
        return false;
    }

    const existing = accounts.find(acc => acc.token === token && acc.id !== id);
    if (existing) {
        showToast(`Already saved as "${existing.nickname}"`, Toasts.Type.FAILURE);
        return false;
    }

    accounts[index] = { ...accounts[index], nickname: nickname.trim(), token: token.trim() };
    saveAccounts(accounts);
    showToast(`Updated: ${nickname}`, Toasts.Type.SUCCESS);
    return true;
}

export function deleteAccount(id: string): boolean {
    const accounts = getAccounts();
    const account = accounts.find(acc => acc.id === id);

    if (!account) {
        showToast("Not found", Toasts.Type.FAILURE);
        return false;
    }

    saveAccounts(accounts.filter(acc => acc.id !== id));
    showToast(`Deleted: ${account.nickname}`, Toasts.Type.SUCCESS);
    return true;
}

export function switchToAccount(account: Account) {
    showToast(`Switching to ${account.nickname}...`, Toasts.Type.MESSAGE);

    setTimeout(() => {
        try {
            const iframe = document.createElement("iframe");
            document.body.appendChild(iframe);

            const iframeWindow = iframe.contentWindow;
            if (iframeWindow) {
                iframeWindow.localStorage.setItem("token", JSON.stringify(account.token));
                try {
                    localStorage.setItem("token", JSON.stringify(account.token));
                } catch { }
            }

            document.body.removeChild(iframe);
            setTimeout(() => location.reload(), 100);
        } catch (error) {
            console.error("[XLAccountSwitcher]", error);
            showToast("Switch failed", Toasts.Type.FAILURE);
        }
    }, 500);
}

export function clearAllAccounts() {
    saveAccounts([]);
    showToast("Cleared all", Toasts.Type.SUCCESS);
}

export function addTestAccount(): Account {
    const accounts = getAccounts();
    return addAccount(`Test ${accounts.length + 1}`, `TEST_TOKEN_${Date.now()}`);
}

export interface ValidationResult {
    valid: number;
    removed: number;
    removedNames: string[];
}

export async function validateAllAccounts(
    onProgress?: (current: number, total: number) => void
): Promise<ValidationResult> {
    const accounts = getAccounts();
    const result: ValidationResult = { valid: 0, removed: 0, removedNames: [] };
    const validAccounts: Account[] = [];

    console.log(`[XLAccountSwitcher] Validating ${accounts.length} accounts...`);

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        if (onProgress) onProgress(i + 1, accounts.length);

        try {
            const userInfo = await validateToken(acc.token);
            if (userInfo) {
                validAccounts.push({
                    ...acc,
                    discordId: userInfo.id,
                    avatarUrl: getAvatarUrl(userInfo.id, userInfo.avatar)
                });
                result.valid++;
            } else {
                result.removed++;
                result.removedNames.push(acc.nickname);
                console.log(`[XLAccountSwitcher] Removed invalid: ${acc.nickname}`);
            }
        } catch {
            result.removed++;
            result.removedNames.push(acc.nickname);
            console.log(`[XLAccountSwitcher] Removed (error): ${acc.nickname}`);
        }

        await new Promise(r => setTimeout(r, 50));
    }

    if (result.removed > 0) {
        saveAccounts(validAccounts);
    }

    console.log(`[XLAccountSwitcher] Validation done: ${result.valid} valid, ${result.removed} removed`);
    return result;
}
