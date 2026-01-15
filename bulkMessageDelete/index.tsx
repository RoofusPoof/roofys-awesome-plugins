import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, Button, ChannelStore, FluxDispatcher, GuildStore, Menu, RestAPI, showToast, Text, Toasts, UserStore, useState, useEffect, useMemo, useCallback } from "@webpack/common";
import { addMessageToCache, deleteMessages, formatDelay, formatTimeRemaining, getCacheStats, initCacheFromDataStore, loadCache, parseDelay, syncMissedMessages, takeSnapshotAndReset } from "./scheduledWipe";
import { ScheduledWipeSettings } from "./ScheduledWipeSettings";

export const settings = definePluginSettings({
    exportPath: {
        type: OptionType.STRING,
        default: "",
        description: "Default export path"
    },
    scheduledWipeEnabled: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Enable scheduled auto-delete of your messages"
    },
    scheduledWipeDelay: {
        type: OptionType.STRING,
        default: "24h",
        description: "Delay before deletion (e.g., 5h, 1d 10h, 2d)"
    },
    scheduledWipeIncludePins: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Include pinned messages in scheduled deletion"
    },
    excludedUserIds: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated user IDs to exclude (hidden)",
        hidden: true
    },
    scheduledWipePanel: {
        type: OptionType.COMPONENT,
        description: "Scheduled wipe settings panel",
        component: ScheduledWipeSettings
    }
});

interface WipeState {
    inProgress: boolean;
    current: number;
    total: number;
    username: string;
    avatarUrl: string;
    hidden: boolean;
    cancelled: boolean;
    paused: boolean;
    minimized: boolean;
    lazyMode: boolean;
    startTime: number;
}

interface CachedData {
    messages: any[];
    timestamp: number;
}

let globalState: WipeState = { inProgress: false, current: 0, total: 0, username: "", avatarUrl: "", hidden: false, cancelled: false, paused: false, minimized: false, lazyMode: false, startTime: 0 };
let refreshUI: (() => void) | null = null;
const messageCache: Map<string, CachedData> = new Map();
let floatingEl: HTMLElement | null = null;

function setWipeState(update: Partial<WipeState>) {
    globalState = { ...globalState, ...update };
    refreshUI?.();
    updateFloatingProgress();
}
function cancelWipe() {
    globalState.cancelled = true;
}

function togglePause() {
    globalState.paused = !globalState.paused;
    updateFloatingProgress();
}

function toggleMinimize() {
    globalState.minimized = !globalState.minimized;
    updateFloatingProgress();
}

function getEstimatedTime(): string {
    if (globalState.current === 0 || !globalState.startTime) return "calculating...";
    const elapsed = Date.now() - globalState.startTime;
    const avgPerMsg = elapsed / globalState.current;
    const remaining = globalState.total - globalState.current;
    const msRemaining = remaining * avgPerMsg;
    if (globalState.lazyMode) {
        const batches = Math.ceil(remaining / 5);
        const lazyMs = batches * 180000;
        return formatEstTime(lazyMs);
    }
    return formatEstTime(msRemaining);
}

function formatEstTime(ms: number): string {
    if (ms < 1000) return "<1s";
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remSecs}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
}

function getAvatarUrl(userId: string, avatar: string | null): string {
    if (!avatar) return `https://cdn.discordapp.com/embed/avatars/0.png`;
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=64`;
}

function updateFloatingProgress() {
    if (!globalState.inProgress) {
        if (floatingEl) {
            floatingEl.classList.add("bmd-floating-hiding");
            setTimeout(() => { floatingEl?.remove(); floatingEl = null; }, 300);
        }
        return;
    }

    if (globalState.hidden) {
        if (floatingEl) {
            floatingEl.classList.add("bmd-floating-hiding");
            setTimeout(() => { floatingEl?.remove(); floatingEl = null; }, 300);
        }
        return;
    }

    if (!floatingEl) {
        floatingEl = document.createElement("div");
        floatingEl.className = "bmd-floating";
        document.body.appendChild(floatingEl);
    }

    const pct = globalState.total ? Math.round((globalState.current / globalState.total) * 100) : 0;
    const estTime = getEstimatedTime();
    const pauseText = globalState.paused ? "resume" : "pause";
    const pauseClass = globalState.paused ? "bmd-floating-paused" : "";
    const minimizedClass = globalState.minimized ? "bmd-floating-minimized" : "";

    floatingEl.className = `bmd-floating ${pauseClass} ${minimizedClass}`;
    floatingEl.innerHTML = `
        <span class="bmd-floating-minimize-btn" title="Minimize">−</span>
        <img src="${globalState.avatarUrl}" class="bmd-floating-avatar" />
        <div class="bmd-floating-content">
            <div class="bmd-floating-info">
                <span class="bmd-floating-text">${globalState.current}/${globalState.total}${globalState.paused ? " (paused)" : ""}</span>
                <div class="bmd-floating-bar"><div class="bmd-floating-fill" style="width:${pct}%"></div></div>
                <span class="bmd-floating-eta">~${estTime} remaining</span>
            </div>
            <div class="bmd-floating-actions">
                <span class="bmd-floating-pause">${pauseText}</span>
                <span class="bmd-floating-cancel">cancel</span>
                <span class="bmd-floating-hide">hide</span>
            </div>
        </div>
    `;

    floatingEl.querySelector(".bmd-floating-avatar")?.addEventListener("click", () => {
        if (globalState.minimized) toggleMinimize();
    });
    floatingEl.querySelector(".bmd-floating-minimize-btn")?.addEventListener("click", () => toggleMinimize());
    floatingEl.querySelector(".bmd-floating-pause")?.addEventListener("click", () => togglePause());
    floatingEl.querySelector(".bmd-floating-hide")?.addEventListener("click", () => setWipeState({ hidden: true }));
    floatingEl.querySelector(".bmd-floating-cancel")?.addEventListener("click", () => cancelWipe());
}

function showCompletionNotification(count: number, username: string, avatarUrl: string, wasCancelled: boolean) {
    if (floatingEl) floatingEl.remove();

    floatingEl = document.createElement("div");
    floatingEl.className = "bmd-floating bmd-floating-complete";
    floatingEl.innerHTML = `
        <img src="${avatarUrl}" class="bmd-floating-avatar" />
        <span class="bmd-floating-text">${wasCancelled ? "cancelled - " : ""}deleted ${count} messages from ${username} ${wasCancelled ? "" : "✓"}</span>
        <span class="bmd-floating-hide">dismiss</span>
    `;
    document.body.appendChild(floatingEl);

    floatingEl.querySelector(".bmd-floating-hide")?.addEventListener("click", () => {
        floatingEl?.remove();
        floatingEl = null;
    });

    setTimeout(() => {
        floatingEl?.remove();
        floatingEl = null;
    }, 5000);
}

async function fetchAllMessages(channelId: string, onProgress?: (count: number) => void): Promise<any[]> {
    const cached = messageCache.get(channelId);
    if (cached && Date.now() - cached.timestamp < 60000) {
        return cached.messages;
    }

    const myId = UserStore.getCurrentUser()?.id;
    const allMessages: any[] = [];
    let beforeId: string | undefined;
    let hasMore = true;

    while (hasMore) {
        try {
            const query: any = { limit: 100 };
            if (beforeId) query.before = beforeId;

            const res = await RestAPI.get({
                url: `/channels/${channelId}/messages`,
                query,
                retries: 2
            });

            const msgs = res?.body || [];
            if (msgs.length === 0) {
                hasMore = false;
            } else {
                const myMsgs = msgs.filter((m: any) => m.author?.id === myId);
                allMessages.push(...myMsgs);
                beforeId = msgs[msgs.length - 1].id;
                onProgress?.(allMessages.length);
                if (msgs.length < 100) hasMore = false;
                await new Promise(r => setTimeout(r, 300));
            }
        } catch {
            hasMore = false;
        }
    }

    messageCache.set(channelId, { messages: allMessages, timestamp: Date.now() });
    return allMessages;
}

async function fetchAllMessagesForExport(channelId: string): Promise<any[]> {
    const allMessages: any[] = [];
    let beforeId: string | undefined;
    let hasMore = true;

    while (hasMore) {
        try {
            const query: any = { limit: 100 };
            if (beforeId) query.before = beforeId;

            const res = await RestAPI.get({
                url: `/channels/${channelId}/messages`,
                query,
                retries: 2
            });

            const msgs = res?.body || [];
            if (msgs.length === 0) {
                hasMore = false;
            } else {
                allMessages.push(...msgs);
                beforeId = msgs[msgs.length - 1].id;
                if (msgs.length < 100) hasMore = false;
                await new Promise(r => setTimeout(r, 300));
            }
        } catch {
            hasMore = false;
        }
    }

    return allMessages.reverse();
}

function hasAttachment(msg: any): boolean {
    return (msg.attachments?.length > 0) || (msg.embeds?.length > 0) || (msg.sticker_items?.length > 0);
}

function matchesFilter(msg: any, words: string[]): boolean {
    if (!words.length) return false;
    const content = msg.content?.toLowerCase() || "";
    return words.some(w => content.includes(w.toLowerCase()));
}

function formatDate(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
}

function truncateMsg(content: string): string {
    if (content.length > 1000) return content.slice(0, 1000) + "...";
    return content;
}

function exportToTxt(messages: any[], user: any): string {
    const lines = [`Chat with ${user?.username || "user"}`, `Exported: ${new Date().toLocaleString()}`, ""];
    for (const msg of messages) {
        const author = msg.author?.username || "Unknown";
        const time = formatDate(msg.timestamp);
        lines.push(`[${time}] ${author}: ${msg.content || "[no text]"}`);
    }
    return lines.join("\n");
}

function exportToHtml(messages: any[], user: any, myUser: any): string {
    const userAvatar = getAvatarUrl(user?.id, user?.avatar);
    const myAvatar = getAvatarUrl(myUser?.id, myUser?.avatar);

    const msgHtml = messages.map(msg => {
        const isMe = msg.author?.id === myUser?.id;
        const avatar = isMe ? myAvatar : userAvatar;
        const author = msg.author?.username || "Unknown";
        const time = formatDate(msg.timestamp);
        const content = msg.content?.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "";

        return `<div class="message"><img class="avatar" src="${avatar}" /><div class="content"><div class="header"><span class="author">${author}</span><span class="time">${time}</span></div><div class="text">${content}</div></div></div>`;
    }).join("\n");

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Chat</title><style>body{font-family:sans-serif;background:#313338;color:#dbdee1;padding:20px}.message{display:flex;padding:8px}.avatar{width:40px;height:40px;border-radius:50%;margin-right:12px}.author{font-weight:600;color:#f2f3f5;margin-right:8px}.time{font-size:12px;color:#949ba4}.text{color:#dbdee1}</style></head><body>${msgHtml}</body></html>`;
}
// holy fuck this is annoying to fucking make jesus christ
async function saveFile(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function wipeMessages(channelId: string, messages: any[], username: string, avatarUrl: string, lazyMode: boolean = false) {
    setWipeState({
        inProgress: true, current: 0, total: messages.length,
        username, avatarUrl, hidden: false, cancelled: false,
        paused: false, minimized: false, lazyMode, startTime: Date.now()
    });
    let deleted = 0;
    let batchCount = 0;

    for (let i = 0; i < messages.length; i++) {
        if (globalState.cancelled) break;

        while (globalState.paused && !globalState.cancelled) {
            await new Promise(r => setTimeout(r, 200));
        }
        if (globalState.cancelled) break;

        const msg = messages[i];
        let success = false;
        let attempts = 0;

        while (!success && attempts < 3) {
            if (globalState.cancelled) break;
            attempts++;
            try {
                await RestAPI.del({ url: `/channels/${channelId}/messages/${msg.id}` });
                success = true;
                deleted++;
            } catch (e: any) {
                const retryAfter = e?.body?.retry_after;
                if (retryAfter) await new Promise(r => setTimeout(r, retryAfter * 1000 + 200));
                else if (e?.status === 404) success = true;
                else await new Promise(r => setTimeout(r, 500));
            }
        }

        setWipeState({ current: i + 1 });

        if (lazyMode) {
            batchCount++;
            if (batchCount >= 5 && i < messages.length - 1) {
                batchCount = 0;
                await new Promise(r => setTimeout(r, 180000));
            } else {
                await new Promise(r => setTimeout(r, 100));
            }
        } else {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    const wasCancelled = globalState.cancelled;
    messageCache.delete(channelId);
    setWipeState({ inProgress: false, current: 0, total: 0, hidden: false, cancelled: false, paused: false, minimized: false, lazyMode: false, startTime: 0 });
    showCompletionNotification(deleted, username, avatarUrl, wasCancelled);
}

const PAGE_SIZE = 50;

function WipeModal({ channelId, user, onClose }: { channelId: string; user: any; onClose: () => void }) {
    const [filterWords, setFilterWords] = useState("");
    const [messages, setMessages] = useState<any[] | null>(null);
    const [counting, setCounting] = useState(true);
    const [countProgress, setCountProgress] = useState(0);
    const [exportFormat, setExportFormat] = useState<"html" | "txt">("html");
    const [showPreview, setShowPreview] = useState(false);
    const [previewTab, setPreviewTab] = useState<"browse" | "pending">("browse");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [previewSearch, setPreviewSearch] = useState("");
    const [previewPage, setPreviewPage] = useState(0);
    const [lazyMode, setLazyMode] = useState(false);
    const [, forceUpdate] = useState({});

    refreshUI = () => forceUpdate({});

    const channel = ChannelStore.getChannel(channelId);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const isServer = !!guild;
    const isGroupDM = channel?.type === 3;

    const getGroupDMIcon = () => {
        if (channel?.icon) {
            return `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.webp?size=64`;
        }
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    };

    const getGroupDMName = () => {
        if (channel?.name) return channel.name;
        if (channel?.recipients?.length) {
            const names = channel.recipients.slice(0, 3).map((r: any) => r.username || r.global_name || "user");
            return names.join(", ") + (channel.recipients.length > 3 ? ` +${channel.recipients.length - 3}` : "");
        }
        return "Group Chat";
    };

    const displayName = isServer
        ? `#${channel?.name || "channel"}`
        : isGroupDM
            ? getGroupDMName()
            : (user?.username || "user");
    const displayIcon = isServer
        ? (guild?.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp?size=64` : "https://cdn.discordapp.com/embed/avatars/0.png")
        : isGroupDM
            ? getGroupDMIcon()
            : getAvatarUrl(user?.id, user?.avatar);
    const displaySub = isServer ? guild?.name : (isGroupDM ? `${channel?.recipients?.length || 0} members` : null);

    const filteredCount = useMemo(() => {
        if (!messages || !filterWords.trim()) return 0;
        const words = filterWords.split(",").map(s => s.trim()).filter(Boolean);
        return messages.filter(m => matchesFilter(m, words)).length;
    }, [messages, filterWords]);

    useEffect(() => {
        const cached = messageCache.get(channelId);
        if (cached && Date.now() - cached.timestamp < 60000) {
            setMessages(cached.messages);
            setCounting(false);
            return;
        }

        fetchAllMessages(channelId, count => {
            setCountProgress(count);
        }).then(msgs => {
            setMessages(msgs);
            setCounting(false);
        });
    }, [channelId]);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        if (messages) setSelectedIds(new Set(messages.map(m => m.id)));
    }, [messages]);

    const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

    const handleWipe = async () => {
        if (!messages) return;
        const toDelete = messages.filter(m => selectedIds.has(m.id));
        if (!toDelete.length) { showToast("nothing selected", Toasts.Type.MESSAGE); return; }
        onClose();
        await wipeMessages(channelId, toDelete, displayName, displayIcon, lazyMode);
    };

    const handleQuickWipe = async (type: "all" | "attachments" | "filtered") => {
        if (!messages) return;
        let toProcess: any[];
        if (type === "all") toProcess = messages;
        else if (type === "attachments") toProcess = messages.filter(hasAttachment);
        else {
            const words = filterWords.split(",").map(s => s.trim()).filter(Boolean);
            toProcess = messages.filter(m => matchesFilter(m, words));
        }
        if (!toProcess.length) { showToast("nothing to wipe", Toasts.Type.MESSAGE); return; }
        onClose();
        await wipeMessages(channelId, toProcess, displayName, displayIcon, lazyMode);
    };

    const handleExport = async () => {
        showToast("fetching...", Toasts.Type.MESSAGE);
        const allMsgs = await fetchAllMessagesForExport(channelId);
        if (!allMsgs?.length) { showToast("no messages", Toasts.Type.MESSAGE); return; }
        const myUser = UserStore.getCurrentUser();
        const filename = `chat_${displayName.replace("#", "")}_${Date.now()}.${exportFormat}`;
        const content = exportFormat === "html" ? exportToHtml(allMsgs, user, myUser) : exportToTxt(allMsgs, user);
        saveFile(content, filename);
        showToast(`exported ${allMsgs.length} messages`, Toasts.Type.SUCCESS);
    };

    const getMessageCountText = () => {
        if (counting) return `calculating... (${countProgress} found)`;
        const total = messages?.length || 0;
        if (filterWords.trim()) return `${filteredCount} w/keywords (${total} total)`;
        return `${total} messages found`;
    };

    const pendingMessages = useMemo(() => {
        if (!messages) return [];
        return messages.filter(m => selectedIds.has(m.id));
    }, [messages, selectedIds]);

    const previewMessages = previewTab === "browse" ? (messages || []) : pendingMessages;
    const filteredPreview = useMemo(() => {
        if (!previewSearch.trim()) return previewMessages;
        const s = previewSearch.toLowerCase();
        return previewMessages.filter(m => m.content?.toLowerCase().includes(s));
    }, [previewMessages, previewSearch]);

    const totalPages = Math.ceil(filteredPreview.length / PAGE_SIZE);
    const pageMessages = filteredPreview.slice(previewPage * PAGE_SIZE, (previewPage + 1) * PAGE_SIZE);

    useEffect(() => { setPreviewPage(0); }, [previewTab, previewSearch]);

    if (globalState.inProgress) {
        const pct = globalState.total ? Math.round((globalState.current / globalState.total) * 100) : 0;
        const estTime = getEstimatedTime();
        return (
            <div className="bmd-modal-content">
                <div className="bmd-user-info">
                    <img src={displayIcon} className="bmd-avatar" />
                    <div className="bmd-user-text">
                        <span className="bmd-user-name">wiping from {displayName}...</span>
                        {globalState.lazyMode && <span className="bmd-server-name">lazy mode enabled</span>}
                        {globalState.paused && <span className="bmd-server-name" style={{ color: "#f0b232" }}>paused</span>}
                    </div>
                </div>
                <div className="bmd-progress"><div className={`bmd-progress-bar ${globalState.paused ? "" : "deleting"}`} style={{ width: `${pct}%` }} /></div>
                <div className="bmd-progress-text">{globalState.current}/{globalState.total} ({pct}%) • ~{estTime} remaining</div>
                <div className="bmd-buttons">
                    <button className="bmd-btn-blue" onClick={togglePause}>{globalState.paused ? "resume" : "pause"}</button>
                    <button className="bmd-btn-red" onClick={cancelWipe}>cancel</button>
                </div>
            </div>
        );
    }

    return (
        <div className={`bmd-layout ${showPreview ? "with-preview" : ""}`}>
            <div className="bmd-main">
                <div className="bmd-user-info">
                    <img src={displayIcon} className="bmd-avatar" />
                    <div className="bmd-user-text">
                        <span className="bmd-user-name">{displayName}</span>
                        {displaySub && <span className="bmd-server-name">{displaySub}</span>}
                        <span className="bmd-msg-count">{getMessageCountText()}</span>
                    </div>
                </div>

                <input className="bmd-input" placeholder="filter words (comma separated)" value={filterWords} onChange={e => setFilterWords(e.target.value)} />

                <div className="bmd-buttons">
                    <button className="bmd-btn-red" onClick={() => {
                        Alerts.show({
                            title: "Are you sure?",
                            body: "This will delete ALL your messages in this channel.",
                            confirmText: "Wipe All",
                            cancelText: "Cancel",
                            onConfirm: () => handleQuickWipe("all")
                        });
                    }} disabled={counting}>wipe all</button>
                    <button className="bmd-btn-blue" onClick={() => {
                        Alerts.show({
                            title: "Are you sure?",
                            body: "This will delete all messages with attachments.",
                            confirmText: "Wipe Attachments",
                            cancelText: "Cancel",
                            onConfirm: () => handleQuickWipe("attachments")
                        });
                    }} disabled={counting}>wipe attachments</button>
                    <button className="bmd-btn-blue" onClick={() => handleQuickWipe("filtered")} disabled={counting || !filterWords.trim()}>wipe filtered</button>
                </div>

                <div className="bmd-lazy-toggle">
                    <label className="bmd-toggle-label">
                        <input type="checkbox" checked={lazyMode} onChange={e => setLazyMode(e.target.checked)} />
                        <span className="bmd-toggle-text">Lazy Deleting</span>
                        <span className="bmd-toggle-info" title="Messages will be deleted in batches of 5 every 3 minutes to prevent Discord from limiting you from sending messages">?</span>
                    </label>
                </div>

                <button className="bmd-btn-outline" onClick={() => setShowPreview(!showPreview)} disabled={counting}>
                    {showPreview ? "hide preview" : "show preview"}
                </button>

                {selectedIds.size > 0 && (
                    <button className="bmd-btn-red" onClick={handleWipe}>wipe {selectedIds.size} selected</button>
                )}

                <div className="bmd-export-section">
                    <div className="bmd-export-header">export</div>
                    <div className="bmd-export-row">
                        <select className="bmd-select" value={exportFormat} onChange={e => setExportFormat(e.target.value as any)}>
                            <option value="html">HTML</option>
                            <option value="txt">TXT</option>
                        </select>
                        <button className="bmd-btn-green" onClick={handleExport} disabled={counting}>export</button>
                    </div>
                </div>
            </div>

            {showPreview && messages && (
                <div className="bmd-preview">
                    <div className="bmd-preview-header">
                        <span>Preview</span>
                        <button onClick={() => setShowPreview(false)}>✕</button>
                    </div>

                    <div className="bmd-preview-tabs">
                        <button className={previewTab === "browse" ? "active" : ""} onClick={() => setPreviewTab("browse")}>
                            Browse ({messages.length})
                        </button>
                        <button className={previewTab === "pending" ? "active" : ""} onClick={() => setPreviewTab("pending")}>
                            Pending ({selectedIds.size})
                        </button>
                    </div>

                    <div className="bmd-preview-actions">
                        <button onClick={selectAll}>select all</button>
                        <button onClick={deselectAll}>deselect all</button>
                    </div>

                    <input
                        className="bmd-preview-search"
                        placeholder="search messages..."
                        value={previewSearch}
                        onChange={e => setPreviewSearch(e.target.value)}
                    />

                    <div className="bmd-preview-list">
                        {pageMessages.map(msg => (
                            <div key={msg.id} className={`bmd-preview-item ${selectedIds.has(msg.id) ? "selected" : ""}`} onClick={() => toggleSelect(msg.id)}>
                                <input type="checkbox" checked={selectedIds.has(msg.id)} onChange={() => { }} />
                                <div className="bmd-preview-content">
                                    <div className="bmd-preview-time">{formatDate(msg.timestamp)}</div>
                                    <div className="bmd-preview-text">{truncateMsg(msg.content || "[no text]")}</div>
                                </div>
                                {selectedIds.has(msg.id) && <span className="bmd-preview-trash">🗑</span>}
                            </div>
                        ))}
                        {filteredPreview.length === 0 && <div className="bmd-preview-empty">no messages</div>}
                    </div>

                    {totalPages > 1 && (
                        <div className="bmd-preview-pagination">
                            <button disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>←</button>
                            <span>{previewPage + 1} / {totalPages}</span>
                            <button disabled={previewPage >= totalPages - 1} onClick={() => setPreviewPage(p => p + 1)}>→</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
// Did he skid from undiscord? On my momma!
function openWipeModal(channelId: string, user: any) {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ color: "#ffffff" }}>bulk message wipe</Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent>
                <WipeModal channelId={channelId} user={user} onClose={props.onClose} />
            </ModalContent>
        </ModalRoot>
    ));
}

const dmContextMenuPatch: NavContextMenuPatchCallback = (children, { channel, user }) => {
    if (!channel || channel.guild_id) return;
    const targetUser = user || (channel.recipients?.length === 1 ? channel.recipients[0] : null);
    const group = findGroupChildrenByChildId("mark-channel-read", children) || findGroupChildrenByChildId("unmute-channel", children);
    group?.push(<Menu.MenuItem id="bulk-message-delete" label="Bulk Wipe Messages" action={() => openWipeModal(channel.id, targetUser)} />);
};

const serverChannelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || !channel.guild_id || (channel.type !== 0 && channel.type !== 5)) return;
    const group = findGroupChildrenByChildId("mark-channel-read", children) || findGroupChildrenByChildId("mute-channel", children);
    group?.push(<Menu.MenuItem id="bulk-message-delete" label="Bulk Wipe My Messages" action={() => openWipeModal(channel.id, null)} />);
};

let scheduledWipeTimer: NodeJS.Timeout | null = null;

function getExcludedUserIds(): string[] {
    return settings.store.excludedUserIds
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function isExcludedChannel(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;

    const excluded = getExcludedUserIds();
    if (channel.recipients) {
        return channel.recipients.some((r: any) => excluded.includes(r.id || r));
    }
    return false;
}

function onMessageCreate(event: any) {
    if (!settings.store.scheduledWipeEnabled) return;

    const message = event.message || event;
    const myId = UserStore.getCurrentUser()?.id;

    if (!message || message.author?.id !== myId) return;
    if (isExcludedChannel(message.channel_id)) return;

    const delayMs = parseDelay(settings.store.scheduledWipeDelay);
    addMessageToCache(message, delayMs);

    checkScheduledWipeTimer();
}

function checkScheduledWipeTimer() {
    if (!settings.store.scheduledWipeEnabled) return;

    const cache = loadCache();
    if (!cache.messages.length || !cache.nextDeleteTime) return;

    const timeUntilDelete = cache.nextDeleteTime - Date.now();

    if (timeUntilDelete <= 0) {
        executeScheduledWipe();
    } else if (!scheduledWipeTimer) {
        scheduledWipeTimer = setTimeout(() => {
            scheduledWipeTimer = null;
            executeScheduledWipe();
        }, timeUntilDelete);
    }
}

async function executeScheduledWipe() {
    const delayMs = parseDelay(settings.store.scheduledWipeDelay);
    const snapshot = takeSnapshotAndReset(delayMs);

    if (!snapshot.length) return;

    showToast(`deleting ${snapshot.length} scheduled messages...`, Toasts.Type.MESSAGE);

    const deleted = await deleteMessages(snapshot);
    showToast(`scheduled wipe: deleted ${deleted} messages`, Toasts.Type.SUCCESS);

    checkScheduledWipeTimer();
}

export default definePlugin({
    name: "BulkMessageDelete",
    description: "quickly wipe your messages in DMs and servers - right click a channel to access",
    authors: [{ name: "RoofusPoof", id: 1352342643853492246n }],
    settings,
    contextMenus: {
        "gdm-context": dmContextMenuPatch,
        "user-context": dmContextMenuPatch,
        "channel-context": serverChannelContextMenuPatch
    },
    async start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);

        await initCacheFromDataStore();

        if (settings.store.scheduledWipeEnabled) {
            checkScheduledWipeTimer();

            const excluded = getExcludedUserIds();
            const delayMs = parseDelay(settings.store.scheduledWipeDelay);
            syncMissedMessages(excluded, delayMs).then(count => {
                if (count > 0) {
                    checkScheduledWipeTimer();
                }
            });
        }
    },
    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);

        if (scheduledWipeTimer) {
            clearTimeout(scheduledWipeTimer);
            scheduledWipeTimer = null;
        }

        floatingEl?.remove();
        floatingEl = null;
    }
});
