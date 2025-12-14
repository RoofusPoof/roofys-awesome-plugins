/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

/**
 * @param message
 * @returns
 */
function isWelcomeMessage(message: any): boolean {
    return message.type === 7 && message.author?.id === UserStore.getCurrentUser()?.id;
}

/**
 *
 * @param channelId
 * @param messageId
 */
function silentDeleteMessage(channelId: string, messageId: string): void {
    try {
        MessageActions.deleteMessage(channelId, messageId);
    } catch (error) {
        console.error("AutoDeleteWelcome: failed to delete message", error);
    }
}

export default definePlugin({
    name: "AutoDeleteWelcome",
    description: "auto-deletes your welcome messages",
    authors: [{ name: "RoofusPoof", id: 1352342643853492246n }],

    flux: {
        MESSAGE_CREATE({ message, channelId }: { message: any; channelId: string; }) {
            if (isWelcomeMessage(message)) {
                setTimeout(() => {
                    silentDeleteMessage(channelId, message.id);
                }, 1);
            }
        }
    }
});
