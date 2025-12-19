import "./styles.css";
import { settings } from "./index";
import { formatDelay, formatTimeRemaining, getCacheStats, parseDelay } from "./scheduledWipe";
import { Button, Forms, showToast, TextInput, Toasts, UserStore, useState, useEffect } from "@webpack/common";
import { UserUtils } from "@webpack/common";

interface ExcludedUser {
    id: string;
    username: string;
    avatar: string | null;
}

function getAvatarUrl(userId: string, avatar: string | null): string {
    if (!avatar) return `https://cdn.discordapp.com/embed/avatars/0.png`;
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=32`;
}

export function ScheduledWipeSettings() {
    const [excludedUsers, setExcludedUsers] = useState<ExcludedUser[]>([]);
    const [newUserId, setNewUserId] = useState("");
    const [stats, setStats] = useState({ count: 0, sizeKb: 0, nextDelete: 0 });
    const [delayPreview, setDelayPreview] = useState("");

    const delay = settings.store.scheduledWipeDelay;

    useEffect(() => {
        const ms = parseDelay(delay);
        setDelayPreview(formatDelay(ms));
    }, [delay]);

    useEffect(() => {
        const loadExcluded = async () => {
            const ids = settings.store.excludedUserIds.split(",").map(s => s.trim()).filter(Boolean);
            const users: ExcludedUser[] = [];
            for (const id of ids) {
                try {
                    const user = await UserUtils.getUser(id);
                    if (user) {
                        users.push({ id, username: user.username, avatar: user.avatar });
                    }
                } catch {
                    users.push({ id, username: `Unknown (${id})`, avatar: null });
                }
            }
            setExcludedUsers(users);
        };
        loadExcluded();
    }, [settings.store.excludedUserIds]);

    useEffect(() => {
        const updateStats = () => setStats(getCacheStats());
        updateStats();
        const interval = setInterval(updateStats, 5000);
        return () => clearInterval(interval);
    }, []);

    const addUser = async () => {
        if (!newUserId.trim()) return;
        try {
            const user = await UserUtils.getUser(newUserId.trim());
            if (!user) {
                showToast("user not found", Toasts.Type.FAILURE);
                return;
            }

            const currentIds = settings.store.excludedUserIds.split(",").map(s => s.trim()).filter(Boolean);
            if (currentIds.includes(user.id)) {
                showToast("user already excluded", Toasts.Type.MESSAGE);
                return;
            }

            settings.store.excludedUserIds = [...currentIds, user.id].join(",");
            setNewUserId("");
            showToast(`excluded ${user.username}`, Toasts.Type.SUCCESS);
        } catch {
            showToast("failed to find user", Toasts.Type.FAILURE);
        }
    };

    const removeUser = (id: string) => {
        const currentIds = settings.store.excludedUserIds.split(",").map(s => s.trim()).filter(Boolean);
        settings.store.excludedUserIds = currentIds.filter(uid => uid !== id).join(",");
    };

    const timeRemaining = stats.nextDelete > Date.now() ? formatTimeRemaining(stats.nextDelete - Date.now()) : "no timer";

    return (
        <div className="bmd-settings">
            <Forms.FormTitle tag="h3" style={{ color: "#ffffff" }}>Scheduled Auto-Delete</Forms.FormTitle>

            <div className="bmd-settings-section">
                <Forms.FormText style={{ color: "#b5bac1" }}>
                    Delay: <strong style={{ color: "#ffffff" }}>{delayPreview}</strong>
                </Forms.FormText>
            </div>

            <div className="bmd-settings-section">
                <Forms.FormTitle tag="h4" style={{ color: "#ffffff" }}>Excluded Users</Forms.FormTitle>
                <Forms.FormText style={{ color: "#72767d", marginBottom: "8px" }}>
                    Messages to these users won't be cached or auto-deleted.
                </Forms.FormText>

                <div className="bmd-excluded-list">
                    {excludedUsers.map(user => (
                        <div key={user.id} className="bmd-excluded-user">
                            <img src={getAvatarUrl(user.id, user.avatar)} className="bmd-excluded-avatar" />
                            <span className="bmd-excluded-name">{user.username}</span>
                            <button className="bmd-excluded-remove" onClick={() => removeUser(user.id)}>✕</button>
                        </div>
                    ))}
                    {excludedUsers.length === 0 && (
                        <Forms.FormText style={{ color: "#72767d" }}>No excluded users.</Forms.FormText>
                    )}
                </div>

                <div className="bmd-add-user">
                    <TextInput
                        placeholder="User ID"
                        value={newUserId}
                        onChange={setNewUserId}
                        style={{ flex: 1 }}
                    />
                    <Button onClick={addUser} size={Button.Sizes.SMALL}>Add</Button>
                </div>
            </div>

            <div className="bmd-settings-section">
                <Forms.FormTitle tag="h4" style={{ color: "#ffffff" }}>Stats</Forms.FormTitle>
                <div className="bmd-stats">
                    <div className="bmd-stat">
                        <span className="bmd-stat-label">Messages pending</span>
                        <span className="bmd-stat-value">{stats.count}</span>
                    </div>
                    <div className="bmd-stat">
                        <span className="bmd-stat-label">Cache size</span>
                        <span className="bmd-stat-value">{stats.sizeKb} KB</span>
                    </div>
                    <div className="bmd-stat">
                        <span className="bmd-stat-label">Next delete</span>
                        <span className="bmd-stat-value">{timeRemaining}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
