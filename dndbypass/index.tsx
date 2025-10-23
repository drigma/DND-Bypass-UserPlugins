/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User, Message } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, Menu, MessageStore, NavigationRouter, PresenceStore, UserStore, WindowStore } from "@webpack/common";
import { showToast } from "@webpack/common";
import { getCurrentChannel } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { playAudio } from "@api/AudioPlayer";
import { Notifications } from "@api/index";
import { Flex } from "@components/Flex";
import { DeleteIcon } from "@components/Icons";
import { useForceUpdater } from "@utils/react";
import { Button, Forms, React, TextInput } from "@webpack/common";
import { OptionType } from "@utils/types";

export const DATASTORE_KEY = "DnDBypass_whitelistedUsers";
export let userWhitelist: string[] = [];

const SelfPresenceStore = findStoreLazy("SelfPresenceStore");

interface IMessageCreate {
    channelId: string;
    guildId: string | undefined;
    message: Message;
}

async function showNotification(message: Message, guildId: string | undefined): Promise<void> {
    try {
        const channel = ChannelStore.getChannel(message.channel_id);
        const channelRegex = /<#(\d{19})>/g;
        const userRegex = /<@(\d{18})>/g;

        let content = message.content;
        content = content.replace(channelRegex, (match: any, channelId: string) => {
            return `#${ChannelStore.getChannel(channelId)?.name ?? channelId}`;
        });

        content = content.replace(userRegex, (match: any, userId: string) => {
            return `@${UserStore.getUser(userId)?.globalName ?? userId}`;
        });

        await Notifications.showNotification({
            title: `${message.author.globalName ?? message.author.username} ${guildId ? `(#${channel?.name ?? 'unknown'}, ${ChannelStore.getChannel(channel?.parent_id)?.name ?? ''})` : "(DM)"}`,
            body: content,
            icon: UserStore.getUser(message.author.id).getAvatarURL(undefined, undefined, false),
            onClick: () => {
                NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${message.channel_id}/${message.id}`);
            }
        });

        if (settings.store.notificationSound) {
            playAudio("message1");
        }
    } catch (error) {
        new Logger("DnDBypass").error("Failed to show notification:", error);
    }
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, props: { user: User }) => {
    if (!props.user || props.user.id === UserStore.getCurrentUser().id) return;

    const isWhitelisted = userWhitelist.includes(props.user.id);
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            label={isWhitelisted ? "Remove from DND Whitelist" : "Add to DND Whitelist"}
            id="vc-dnd-whitelist"
            action={() => whitelistUser(props.user)}
        />
    );
};

async function whitelistUser(user: User) {
    if (userWhitelist.includes(user.id)) {
        userWhitelist = userWhitelist.filter(id => id !== user.id);
        showToast("Removed user from DND whitelist");
    } else {
        userWhitelist.push(user.id);
        showToast("Added user to DND whitelist");
    }

    await DataStore.set(DATASTORE_KEY, userWhitelist);
}

function WhitelistedUsersComponent({ update }: { update: () => void }) {
    async function onClickRemove(index: number) {
        userWhitelist.splice(index, 1);
        await DataStore.set(DATASTORE_KEY, userWhitelist);
        update();
    }

    async function onChange(e: string, index: number) {
        if (index === userWhitelist.length - 1 && e) {
            userWhitelist.push("");
        }

        userWhitelist[index] = e;

        if (index !== userWhitelist.length - 1 && e === "") {
            userWhitelist.splice(index, 1);
        }

        await DataStore.set(DATASTORE_KEY, userWhitelist);
        update();
    }

    return (
        <>
            <Forms.FormTitle tag="h4">Whitelisted Users (bypass DND for these)</Forms.FormTitle>
            <Forms.FormText>If no users are added, you'll receive notifications from everyone in DND mode (full bypass).</Forms.FormText>
            <Flex flexDirection="column" style={{ gap: "0.5em" }}>
                {userWhitelist.map((user, index) => (
                    <Flex key={`${user}-${index}`} flexDirection="row" style={{ gap: 0, flexGrow: 1 }}>
                        <TextInput
                            placeholder="User ID"
                            value={user}
                            onChange={e => onChange(e, index)}
                            spellCheck={false}
                        />
                        <Button
                            size={Button.Sizes.MIN}
                            onClick={() => onClickRemove(index)}
                            style={{
                                background: "none",
                                color: "var(--status-danger)"
                            }}
                        >
                            <DeleteIcon />
                        </Button>
                    </Flex>
                ))}
                {userWhitelist.length === 0 && (
                    <Button
                        onClick={() => {
                            userWhitelist.push("");
                            update();
                        }}
                    >
                        Add User
                    </Button>
                )}
            </Flex>
        </>
    );
}

export const settings = definePluginSettings({
    whitelistedUsers: {
        type: OptionType.COMPONENT,
        description: "Users that can bypass DND mode",
        component: () => {
            const update = useForceUpdater();
            return <WhitelistedUsersComponent update={update} />;
        }
    },
    allowOutsideOfDms: {
        type: OptionType.BOOLEAN,
        description: "Allow whitelisted users to bypass DND in servers too (notifications if they ping you anywhere)",
        default: false
    },
    allowAllPingsInServers: {
        type: OptionType.BOOLEAN,
        description: "If no users whitelisted, get notifications for all pings in servers (in addition to all DMs)",
        default: true
    },
    notificationSound: {
        type: OptionType.BOOLEAN,
        description: "Play notification sound for bypassed messages",
        default: true
    },
    statusToBypass: {
        type: OptionType.SELECT,
        description: "Status to apply bypass for",
        options: [
            { label: "Online", value: "online" },
            { label: "Idle", value: "idle" },
            { label: "Do Not Disturb", value: "dnd", default: true },
            { label: "Invisible", value: "invisible" }
        ]
    }
});

export default definePlugin({
    name: "DnDBypass",
    description: "Bypass DND (or other statuses) for notifications from whitelisted users. If no users whitelisted, get notifications from everyone. Right-click users to add/remove from whitelist.",
    authors: [{ name: "Ohesz", id: 1013417132102516776n }],
    dependencies: ["AudioPlayerAPI"],

    settings,

    contextMenus: {
        "user-context": userContextMenuPatch
    },

    flux: {
        async MESSAGE_CREATE({ message, guildId, channelId }: IMessageCreate): Promise<void> {
            try {
                const currentUser = UserStore.getCurrentUser();
                const userStatus = PresenceStore.getStatus(currentUser.id);
                const currentChannelId = getCurrentChannel()?.id ?? "";
                if (
                    message.state === "SENDING" ||
                    message.content === "" ||
                    message.author.id === currentUser.id ||
                    (channelId === currentChannelId && WindowStore.isFocused()) ||
                    userStatus !== settings.store.statusToBypass
                ) {
                    return;
                }

                const isDM = !guildId;
                const mentioned = MessageStore.getMessage(channelId, message.id)?.mentioned ?? false;
                const isWhitelisted = userWhitelist.includes(message.author.id);
                const noWhitelist = userWhitelist.length === 0 || userWhitelist.every(id => id.trim() === "");

                let shouldNotify = false;

                if (noWhitelist) {
                    if (isDM || (mentioned && settings.store.allowAllPingsInServers)) {
                        shouldNotify = true;
                    }
                } else {
                    if (isWhitelisted && (isDM || (mentioned && settings.store.allowOutsideOfDms))) {
                        shouldNotify = true;
                    }
                }

                if (shouldNotify) {
                    await showNotification(message, guildId);
                }
            } catch (error) {
                new Logger("DnDBypass").error("Failed to handle message:", error);
            }
        }
    },

    async start() {
        userWhitelist = (await DataStore.get(DATASTORE_KEY)) ?? [];
        if (userWhitelist.length === 0) {
            userWhitelist.push("");
        }
    },

    stop() {}
});