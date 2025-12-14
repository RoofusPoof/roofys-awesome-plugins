/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin from "@utils/types";
import { Guild } from "@vencord/discord-types";
import { FluxDispatcher, GuildMemberStore, Menu, showToast, Toasts } from "@webpack/common";

/*
 */
function MakeshiftEveryoneIcon() {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
        >
            <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            />
            <circle cx="18" cy="18" r="4" fill="currentColor" />
            <path
                fill="white"
                d="M18 16v4m-2-2h4"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

/**
 *
 * @param guildId
 * @returns
 */
async function getAllGuildMemberIds(guildId: string): Promise<string[]> {
    const existingMemberIds = GuildMemberStore.getMemberIds(guildId);

    if (existingMemberIds && existingMemberIds.length > 0) {
        return existingMemberIds;
    }

    return new Promise((resolve) => {
        const handleMembersChunk = () => {
            const memberIds = GuildMemberStore.getMemberIds(guildId);
            if (memberIds && memberIds.length > 0) {
                FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", handleMembersChunk);
                resolve(memberIds);
            }
        };

        FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", handleMembersChunk);


        FluxDispatcher.dispatch({
            type: "GUILD_MEMBERS_REQUEST",
            guildIds: [guildId],
            presences: false
        });


        setTimeout(() => {
            FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", handleMembersChunk);
            const memberIds = GuildMemberStore.getMemberIds(guildId);
            resolve(memberIds || []);
        }, 5000);
    });
}

/**
 *
 * @param guild
 */
async function handleMakeshiftEveryone(guild: Guild) {
    try {
        const memberIds = await getAllGuildMemberIds(guild.id);

        if (!memberIds || memberIds.length === 0) {
            showToast("No members found!", Toasts.Type.FAILURE);
            return;
        }

        const mentions = memberIds.map(id => `<@${id}>`).join(" ");

        insertTextIntoChatInputBox(mentions);

        showToast(`${memberIds.length} members copied`, Toasts.Type.SUCCESS);
    } catch (error) {
        console.error("MakeshiftEveryone error:", error);
        showToast("failed to fetch members", Toasts.Type.FAILURE);
    }
}

/**
 *
 */
const Patch: NavContextMenuPatchCallback = (children, { guild }: { guild: Guild; }) => { // why the fuck are context menus hard to patch
    if (!guild) return;

    const group = findGroupChildrenByChildId("privacy", children);

    group?.push(
        <Menu.MenuItem
            id="vc-makeshift-everyone"
            label="Makeshift @everyone"
            action={() => handleMakeshiftEveryone(guild)}
            icon={MakeshiftEveryoneIcon}
            style={{
                background: "linear-gradient(135deg, #FF1493 0%, #FF69B4 50%, #FFB6C1 100%)",
                color: "white",
                fontWeight: "600",
                borderRadius: "4px",
                padding: "6px 8px",
                margin: "2px 0",
                boxShadow: "0 2px 8px rgba(255, 20, 147, 0.3)"
            }}
        />
    );
};

export default definePlugin({
    name: "MakeshiftEveryone",
    description: "new button under server context menu that works as a @everyone, you should off syntax markdown in chat settings to copy the ids",
    authors: [{ name: "RoofusPoof", id: 1352342643853492246n }],

    contextMenus: {
        "guild-context": Patch,
        "guild-header-popout": Patch
    }
});
