/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { closeModal, openModal } from "@utils/modal";
import { chooseFile } from "@utils/web";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { CloudUpload } from "@vencord/discord-types";
import { findCssClassesLazy, findStoreLazy } from "@webpack";
import { Constants, FluxDispatcher, Menu, MessageActions, RestAPI, SelectedChannelStore, Toasts } from "@webpack/common";

import { CatboxPreviewModal } from "./modal";
import { showUploadToast } from "./UploadToast";

const logger = new Logger("CatboxUploader");
const Native = VencordNative.pluginHelpers.CatboxUploader as PluginNative<typeof import("./native")>;
const OptionClasses = findCssClassesLazy("optionName", "optionIcon", "optionLabel");
const PendingReplyStore = findStoreLazy("PendingReplyStore");

// Store pending reply before Discord clears it
const pendingReplies = new Map<string, any>();


function CatboxIcon({ className, height = 24, width = 24 }: { className?: string; height?: number; width?: number; }) {
    return (
        <svg
            className={className}
            height={height}
            width={width}
            viewBox="25 25 225 195"
            fill="currentColor"
        >
            <path fillRule="evenodd" d="M60.955406,185.595627 C64.550674,186.336990 68.158829,186.988358 71.851700,186.540665 C80.637802,185.475525 85.891426,179.542816 84.534660,171.891510 C83.628937,166.783829 80.078377,163.454803 75.879623,160.809189 C72.923157,158.946320 69.767578,157.385483 66.891296,155.412262 C60.989319,151.363373 61.079620,145.174713 66.894691,141.153961 C69.745354,139.182938 71.548485,139.186859 72.628990,143.063049 C73.840904,147.410629 75.620438,151.574661 79.639122,154.257202 C99.168221,167.293243 118.499855,180.657349 139.806229,190.756271 C141.674316,191.641724 143.499405,193.018265 145.886093,192.487900 C145.932556,190.198792 144.013275,189.360886 142.886642,188.038208 C135.965149,179.912277 135.513702,167.374741 142.785278,159.610870 C153.821335,147.827652 165.062088,136.192490 176.840698,125.161606 C187.114975,115.539574 198.546738,115.803993 209.204102,124.955162 C213.486725,128.632523 217.291840,132.861938 221.393097,136.757126 C222.542511,137.848785 223.721832,139.560638 225.618164,138.730270 C227.343033,137.974991 227.511169,136.072540 227.567001,134.418472 C228.330353,111.805038 230.827408,89.277458 230.746841,66.614059 C230.726257,60.824810 228.669403,56.882030 224.041458,53.617451 C212.318436,45.347919 200.002014,38.090641 187.537674,31.017998 C182.485016,28.150965 177.987213,27.507965 173.110626,30.768585 C168.194336,34.055763 163.146698,34.123043 157.465820,32.499153 C148.361694,29.896729 139.010605,28.170195 129.808151,25.894442 C125.734192,24.886955 121.961372,25.170610 118.156433,26.924267 C95.880722,37.190899 74.481956,48.984478 54.361702,63.063416 C50.101871,66.044189 48.696060,69.421379 50.396282,74.587158 C54.399906,86.751343 57.773582,99.124168 61.843693,111.264534 C63.480930,116.148109 62.776295,118.935020 57.810955,120.929649 C54.621929,122.210716 51.668949,124.298309 48.923267,126.428040 C32.785511,138.945572 27.693827,159.558304 42.929260,175.948898 C47.738579,181.122864 53.695080,183.577118 60.955406,185.595627 M201.611435,192.496155 C201.611435,182.775131 201.611435,173.054123 201.611435,163.311447 C204.630051,163.329437 205.458664,165.195404 206.705048,166.427628 C211.087128,170.759903 215.290497,175.282593 219.818069,179.454803 C223.186569,182.558929 227.689407,182.424377 230.687225,179.646210 C234.039642,176.539429 234.684204,172.048264 231.401337,168.476257 C220.807846,156.949753 209.880096,145.723831 198.204391,135.282700 C194.599365,132.058868 190.521194,132.520706 186.983017,135.926910 C184.462952,138.353012 182.003860,140.842636 179.527527,143.313889 C171.509216,151.315720 163.409821,159.238922 155.515366,167.361237 C151.440720,171.553482 151.412842,175.685074 154.897934,179.249680 C158.313583,182.743271 162.474640,182.670029 166.812347,178.661789 C171.092087,174.707092 175.102371,170.462082 179.281540,166.396500 C180.546494,165.165924 181.518539,163.445969 183.844894,163.279602 C184.870529,164.910065 184.498016,166.755447 184.485703,168.511581 C184.399277,180.831146 185.112427,193.140976 184.567215,205.474640 C184.302444,211.464233 188.075638,215.507187 192.740097,215.589691 C197.708954,215.677567 201.385468,211.551895 201.567795,205.488388 C201.687912,201.493256 201.603073,197.491974 201.611435,192.496155 M129.733795,63.796188 C126.314148,66.222107 123.188515,68.439217 120.071915,70.668945 C117.178558,72.738953 116.622169,75.112373 119.389542,77.674538 C130.513474,87.973618 141.611023,98.302803 152.856689,108.467789 C156.092651,111.392776 159.533539,110.307365 162.934586,108.100922 C178.308350,98.127098 193.741989,88.245308 209.188492,78.384277 C210.628845,77.464745 211.858795,75.820831 213.920197,76.287964 C214.612534,77.625351 213.620468,78.275391 212.933594,78.861664 C197.968277,91.634979 182.547623,103.793159 165.836609,114.260376 C160.845978,117.386337 156.051773,117.724174 150.713135,115.322823 C124.276253,103.431404 98.345482,90.481842 72.226677,77.925789 C71.681702,77.663795 71.279472,77.104828 70.565018,76.464134 C72.363922,75.043373 73.863022,75.968307 75.373177,76.343658 C85.711113,78.913139 96.061455,81.432938 106.392509,84.029602 C108.936317,84.668983 111.300255,85.082520 112.886642,82.347328 C106.657967,71.601135 106.735718,71.029289 117.681557,64.152176 C132.360092,54.929859 147.604828,46.679245 162.741608,38.247139 C163.730621,37.696198 164.713013,36.968601 167.627258,37.765015 C154.765411,47.134804 142.319305,55.255344 129.733795,63.796188 z" />
        </svg>
    );
}

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".gif", ".m4v", ".flv", ".wmv"];
const MAX_FILE_SIZE = 200 * 1024 * 1024;

const settings = definePluginSettings({
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Auto-redirect video uploads to Catbox (for files under 10MB)",
        default: true,
    },
    userhash: {
        type: OptionType.STRING,
        description: "Catbox userhash for account-linked uploads (optional)",
        default: "",
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications for upload status",
        default: true,
    }
});

function isVideoFile(filename: string): boolean {
    const lowerName = filename.toLowerCase();
    return VIDEO_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function uploadToCatbox(file: File, userhash?: string): Promise<string> {
    const base64Data = await fileToBase64(file);
    const result = await Native.uploadToCatbox(base64Data, file.name, file.type || "application/octet-stream", userhash);

    if (!result.success) {
        throw new Error(result.error || "Unknown error");
    }

    return result.url!;
}

async function sendMessage(channelId: string, content: string, reply?: any): Promise<any> {
    const msg = {
        content,
        tts: false,
        invalidEmojis: [],
        validNonShortcutEmojis: []
    };
    const options = reply ? MessageActions.getSendMessageOptionsForReply(reply) : {};
    return MessageActions._sendMessage(channelId, msg, options);
}

async function editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    await RestAPI.patch({
        url: Constants.Endpoints.MESSAGE(channelId, messageId),
        body: { content }
    });
}

async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    await RestAPI.del({
        url: Constants.Endpoints.MESSAGE(channelId, messageId)
    });
}


const ChatBarContextCheckbox: NavContextMenuPatchCallback = children => {
    const { isEnabled } = settings.use(["isEnabled"]);

    const group = findGroupChildrenByChildId("submit-button", children);
    if (!group) return;

    const idx = group.findIndex(c => c?.props?.id === "submit-button");

    group.splice(idx + 1, 0,
        <Menu.MenuCheckboxItem
            id="vc-catbox-uploader"
            label="Auto Catbox for Videos"
            checked={isEnabled}
            action={() => settings.store.isEnabled = !settings.store.isEnabled}
        />
    );
};


const AttachContextMenu: NavContextMenuPatchCallback = (children, props) => {
    children.push(
        <Menu.MenuItem
            id="vc-catbox-upload"
            label={
                <div className={OptionClasses.optionLabel}>
                    <CatboxIcon className={OptionClasses.optionIcon} height={24} width={24} />
                    <div className={OptionClasses.optionName}>Upload Video to Catbox</div>
                </div>
            }
            action={() => uploadVideoViaCatbox()}
        />
    );
};

async function uploadVideoViaCatbox() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;

    const file = await chooseFile("video/*");
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        Toasts.show({
            message: "ERR: File too large (max 200MB)",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
            options: { duration: 5000 }
        });
        return;
    }

    const key = openModal(props => (
        <CatboxPreviewModal
            rootProps={props}
            file={file}
            onConfirm={async processedFile => {
                await performUpload(channelId, processedFile);
            }}
            close={() => closeModal(key)}
        />
    ));
}

async function performUpload(channelId: string, file: File) {
    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    let placeholderMessageId: string | null = null;
    try {
        const result = await sendMessage(channelId, `Uploading ${file.name} to Catbox`, reply);
        placeholderMessageId = result?.body?.id;
    } catch (e) {
        logger.error("Failed to send placeholder:", e);
        return;
    }

    const toast = settings.store.showToast
        ? showUploadToast(file.name, file.size)
        : null;

    try {
        const catboxUrl = await uploadToCatbox(file, settings.store.userhash);
        logger.info(`Uploaded ${file.name} to Catbox: ${catboxUrl}`);

        toast?.complete();

        if (placeholderMessageId) {
            try {
                await editMessage(channelId, placeholderMessageId, catboxUrl);
            } catch (editErr) {
                logger.error("Failed to edit message:", editErr);
            }
        }
    } catch (error) {
        logger.error(`Failed to upload ${file.name}:`, error);
        toast?.error();

        if (placeholderMessageId) {
            try {
                await deleteMessage(channelId, placeholderMessageId);
            } catch { }
        }

        Toasts.show({
            message: "ERR",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
            options: { duration: 5000 }
        });
    }
}

export default definePlugin({
    name: "CatboxUploader",
    authors: [{ name: "RoofusPoof", id: 1352342643853492246n }],
    description: "Upload videos to Catbox.moe. Right-click the attachment button and select 'Upload Video to Catbox' to bypass Discord's file size limit.",
    settings,

    contextMenus: {
        "textarea-context": ChatBarContextCheckbox,
        "channel-attach": AttachContextMenu
    },
    // hacks TTV
    patches: [
        {
            find: "async uploadFiles(",
            replacement: [
                {
                    match: /async uploadFiles\((\i)\){/,
                    replace: "$&if(await $self.handleVideoUploads($1))return;"
                }
            ],
        },
        {
            find: ".addFilesTo(",
            replacement: {
                match: /(\i)\.addFilesTo\((\i),(\i),/,
                replace: "$self.captureReply($2),$1.addFilesTo($2,$3,"
            }
        }
    ],

    captureReply(channelId: string) {
        const reply = PendingReplyStore.getPendingReply(channelId);
        if (reply) pendingReplies.set(channelId, reply);
    },


    async handleVideoUploads(uploads: CloudUpload[]): Promise<boolean> {
        if (!settings.store.isEnabled) return false;

        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return false;

        const videosToProcess: { index: number; upload: CloudUpload; }[] = [];

        for (let i = 0; i < uploads.length; i++) {
            const upload = uploads[i];
            if (upload?.item?.file && isVideoFile(upload.filename)) {
                const file = upload.item.file as File;
                if (file.size <= MAX_FILE_SIZE) {
                    videosToProcess.push({ index: i, upload });
                }
            }
        }

        if (videosToProcess.length === 0) return false;

        const hasOtherFiles = uploads.some((u, i) =>
            !videosToProcess.some(v => v.index === i) && u?.item?.file
        );

        if (hasOtherFiles) {
            return false;
        }

        const reply = pendingReplies.get(channelId);
        if (reply) {
            pendingReplies.delete(channelId);
            FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
        }

        const fileNames = videosToProcess.map(v => (v.upload.item.file as File).name).join(", ");
        const totalSize = videosToProcess.reduce((sum, v) => sum + (v.upload.item.file as File).size, 0);

        let placeholderMessageId: string | null = null;
        try {
            const result = await sendMessage(channelId, `Uploading to Catbox: ${fileNames}`, reply);
            placeholderMessageId = result?.body?.id;
        } catch (e) {
            logger.error("Failed to send placeholder:", e);
            return false;
        }

        const toast = settings.store.showToast
            ? showUploadToast(fileNames, totalSize)
            : null;

        const catboxUrls: string[] = [];
        const errors: string[] = [];

        for (const { upload } of videosToProcess) {
            const file = upload.item.file as File;
            try {
                const catboxUrl = await uploadToCatbox(file, settings.store.userhash);
                logger.info(`Uploaded ${file.name} to Catbox: ${catboxUrl}`);
                catboxUrls.push(catboxUrl);
            } catch (error) {
                logger.error(`Failed to upload ${file.name}:`, error);
                errors.push(file.name);
            }
        }

        if (placeholderMessageId) {
            try {
                if (catboxUrls.length > 0) {
                    await editMessage(channelId, placeholderMessageId, catboxUrls.join("\n"));
                    toast?.complete();
                } else {
                    await deleteMessage(channelId, placeholderMessageId);
                    toast?.error();
                    Toasts.show({
                        message: "ERR",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId(),
                        options: { duration: 5000 }
                    });
                }
            } catch (e) {
                logger.error("Failed to update placeholder:", e);
                toast?.error();
            }
        }

        return catboxUrls.length > 0;
    },
});
