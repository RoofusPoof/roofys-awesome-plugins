import * as DataStore from "@api/DataStore";
import { RestAPI, UserStore } from "@webpack/common";

export interface CachedMessage {
    id: string;
    channelId: string;
    timestamp: number;
    content: string;
}

export interface ScheduledWipeCache {
    messages: CachedMessage[];
    nextDeleteTime: number;
    lastSyncTime: number;
}

const CACHE_KEY = "BulkMessageDelete_scheduledCache";

let memoryCache: ScheduledWipeCache = { messages: [], nextDeleteTime: 0, lastSyncTime: 0 };
let cacheLoaded = false;

export function parseDelay(input: string): number {
    let ms = 0;
    const days = input.match(/(\d+)\s*d/i);
    const hours = input.match(/(\d+)\s*h/i);
    const minutes = input.match(/(\d+)\s*m/i);

    if (days) ms += parseInt(days[1]) * 24 * 60 * 60 * 1000;
    if (hours) ms += parseInt(hours[1]) * 60 * 60 * 1000;
    if (minutes) ms += parseInt(minutes[1]) * 60 * 1000;

    return ms || 24 * 60 * 60 * 1000;
}

export function formatDelay(ms: number): string {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    const parts: string[] = [];
    if (days) parts.push(`${days} day${days > 1 ? "s" : ""}`);
    if (hours) parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
    if (minutes) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
    // oh my god 1 minute like that one moment when gus fring warned hank schrader about cousins when they were about to kill him in the parking lot and he had 1 minute to act....

    return parts.join(", ") || "24 hours";
}

export function formatTimeRemaining(ms: number): string {
    if (ms <= 0) return "now";

    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h`;
    }

    return `${hours}h ${minutes}m`;
}

export async function initCacheFromDataStore(): Promise<void> {
    try {
        const data = await DataStore.get(CACHE_KEY);
        if (data) {
            memoryCache = data as ScheduledWipeCache;
        }
        cacheLoaded = true;
    } catch (e) {
        console.error("[BMD] Error loading cache from DataStore:", e);
        cacheLoaded = true;
    }
}

export function loadCache(): ScheduledWipeCache {
    return memoryCache;
}

export async function saveCache(cache: ScheduledWipeCache): Promise<void> {
    memoryCache = cache;
    try {
        await DataStore.set(CACHE_KEY, cache);
    } catch (e) {
        console.error("[BMD] Error saving cache to DataStore:", e);
    }
}

export async function clearCache(): Promise<void> {
    memoryCache = { messages: [], nextDeleteTime: 0, lastSyncTime: 0 };
    await DataStore.del(CACHE_KEY);
}

export function addMessageToCache(msg: { id: string; channel_id: string; content: string }, delayMs: number): void {
    if (memoryCache.messages.some(m => m.id === msg.id)) return;

    memoryCache.messages.push({
        id: msg.id,
        channelId: msg.channel_id,
        timestamp: Date.now(),
        content: msg.content?.substring(0, 50) || ""
    });

    if (!memoryCache.nextDeleteTime || memoryCache.nextDeleteTime < Date.now()) {
        memoryCache.nextDeleteTime = Date.now() + delayMs;
    }

    saveCache(memoryCache);
}

export function getCacheStats(): { count: number; sizeKb: number; nextDelete: number } {
    const cacheStr = JSON.stringify(memoryCache);

    return {
        count: memoryCache.messages.length,
        sizeKb: Math.round(new Blob([cacheStr]).size / 1024 * 10) / 10,
        nextDelete: memoryCache.nextDeleteTime
    };
}

export function takeSnapshotAndReset(delayMs: number): CachedMessage[] {
    const snapshot = [...memoryCache.messages];

    memoryCache = {
        messages: [],
        nextDeleteTime: 0,
        lastSyncTime: memoryCache.lastSyncTime
    };
    saveCache(memoryCache);

    return snapshot;
}

export async function deleteMessages(messages: CachedMessage[]): Promise<number> {
    let deleted = 0;

    for (const msg of messages) {
        try {
            await RestAPI.del({ url: `/channels/${msg.channelId}/messages/${msg.id}` });
            deleted++;
        } catch (e: any) {
            const retryAfter = e?.body?.retry_after;
            if (retryAfter) {
                await new Promise(r => setTimeout(r, retryAfter * 1000 + 200));
                try {
                    await RestAPI.del({ url: `/channels/${msg.channelId}/messages/${msg.id}` });
                    deleted++;
                } catch { }
            }
        }
        await new Promise(r => setTimeout(r, 50));
    }

    return deleted;
}

export async function syncMissedMessages(excludedUserIds: string[], delayMs: number): Promise<number> {
    const myId = UserStore.getCurrentUser()?.id;
    if (!myId) return 0;

    let added = 0;
    const lastSync = memoryCache.lastSyncTime || (Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
        const channelsRes = await RestAPI.get({ url: "/users/@me/channels" });
        const channels = channelsRes?.body || [];

        for (const channel of channels.slice(0, 20)) {
            if (channel.recipients?.some((r: any) => excludedUserIds.includes(r.id))) continue;

            try {
                const msgsRes = await RestAPI.get({
                    url: `/channels/${channel.id}/messages`,
                    query: { limit: 50 }
                });

                const msgs = msgsRes?.body || [];
                for (const msg of msgs) {
                    if (msg.author?.id !== myId) continue;

                    const msgTime = new Date(msg.timestamp).getTime();
                    if (msgTime <= lastSync) continue;
                    if (memoryCache.messages.some(m => m.id === msg.id)) continue;

                    memoryCache.messages.push({
                        id: msg.id,
                        channelId: channel.id,
                        timestamp: msgTime,
                        content: msg.content?.substring(0, 50) || ""
                    });
                    added++;
                }

                await new Promise(r => setTimeout(r, 200));
            } catch { }
        }

        memoryCache.lastSyncTime = Date.now();

        if (added > 0 && (!memoryCache.nextDeleteTime || memoryCache.nextDeleteTime < Date.now())) {
            memoryCache.nextDeleteTime = Date.now() + delayMs;
        }

        await saveCache(memoryCache);
    } catch { }

    return added;
}
