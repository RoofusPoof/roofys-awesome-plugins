import { showToast, Toasts } from "@webpack/common";
import { localStorage } from "@utils/localStorage";

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

export async function switchToAccount(account: Account) {
    showToast(`Verifying ${account.nickname}...`, Toasts.Type.MESSAGE);

    // Validate the token first
    const userInfo = await validateToken(account.token);
    if (!userInfo) {
        // Token is invalid - move to invalid tab
        showToast(`${account.nickname} is invalid - moved to Invalid tab`, Toasts.Type.FAILURE);

        const accounts = getAccounts();
        const invalid = getInvalidAccounts();

        // Remove from valid, add to invalid
        saveAccounts(accounts.filter(a => a.id !== account.id));
        invalid.push(account);
        saveInvalidAccounts(invalid);
        return;
    }

    showToast(`Switching to ${account.nickname}...`, Toasts.Type.MESSAGE);

    if (!localStorage) {
        console.error("[XLAccountSwitcher] localStorage not available");
        showToast("Switch failed - no storage access", Toasts.Type.FAILURE);
        return;
    }

    // Clear session-related keys
    const keysToRemove = [
        "MultiAccountStore",
        "accounts",
        "accountIndex",
        "shard_count",
        "tokens",
        "fingerprint",
        "gatewayURL",
        "email_cache"
    ];

    for (const key of keysToRemove) {
        try { localStorage.removeItem(key); } catch { }
    }

    // Set the new token - Discord expects it as a quoted string
    try {
        localStorage.setItem("token", JSON.stringify(account.token));
    } catch (e) {
        console.error("[XLAccountSwitcher] Failed to set token:", e);
        showToast("Switch failed - storage error", Toasts.Type.FAILURE);
        return;
    }

    // Reload the page
    setTimeout(() => {
        location.reload();
    }, 100);
}

export function clearAllAccounts() {
    saveAccounts([]);
    showToast("Cleared all", Toasts.Type.SUCCESS);
}

export function addTestAccount(): Account {
    const accounts = getAccounts();
    return addAccount(`Test ${accounts.length + 1}`, `TEST_TOKEN_${Date.now()}`);
}

export function getInvalidAccounts(): Account[] {
    try {
        return JSON.parse(settings.store.invalidAccounts);
    } catch {
        return [];
    }
}

export function saveInvalidAccounts(accounts: Account[]) {
    settings.store.invalidAccounts = JSON.stringify(accounts);
}

export function deleteInvalidAccount(id: string): boolean {
    const invalid = getInvalidAccounts();
    const filtered = invalid.filter(acc => acc.id !== id);
    saveInvalidAccounts(filtered);
    showToast("Deleted invalid account", Toasts.Type.SUCCESS);
    return true;
}

export async function retryValidateAccount(id: string): Promise<boolean> {
    const invalid = getInvalidAccounts();
    const account = invalid.find(acc => acc.id === id);
    if (!account) return false;

    const userInfo = await validateToken(account.token);
    if (userInfo) {
        const updated = {
            ...account,
            discordId: userInfo.id,
            avatarUrl: getAvatarUrl(userInfo.id, userInfo.avatar),
            nickname: userInfo.global_name || userInfo.username
        };
        const accounts = getAccounts();
        accounts.push(updated);
        saveAccounts(accounts);
        saveInvalidAccounts(invalid.filter(acc => acc.id !== id));
        showToast(`Restored: ${updated.nickname}`, Toasts.Type.SUCCESS);
        return true;
    }
    showToast("Still invalid", Toasts.Type.FAILURE);
    return false;
}

export interface ValidationResult {
    valid: number;
    invalid: number;
    invalidNames: string[];
}

export async function validateAllAccounts(
    onProgress?: (current: number, total: number) => void
): Promise<ValidationResult> {
    const accounts = getAccounts();
    const result: ValidationResult = { valid: 0, invalid: 0, invalidNames: [] };
    const validAccounts: Account[] = [];
    const invalidAccounts: Account[] = [...getInvalidAccounts()];

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
                invalidAccounts.push(acc);
                result.invalid++;
                result.invalidNames.push(acc.nickname);
                console.log(`[XLAccountSwitcher] Marked invalid: ${acc.nickname}`);
            }
        } catch {
            invalidAccounts.push(acc);
            result.invalid++;
            result.invalidNames.push(acc.nickname);
            console.log(`[XLAccountSwitcher] Marked invalid (error): ${acc.nickname}`);
        }

        await new Promise(r => setTimeout(r, 50));
    }

    saveAccounts(validAccounts);
    saveInvalidAccounts(invalidAccounts);

    console.log(`[XLAccountSwitcher] Validation done: ${result.valid} valid, ${result.invalid} invalid`);
    return result;
}
