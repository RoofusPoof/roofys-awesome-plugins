import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Menu, showToast, Toasts } from "@webpack/common";

import { openAccountModal } from "./AccountModal";
import { addTestAccount, clearAllAccounts, getAccounts, switchToAccount, validateAllAccounts } from "./accountStore";
import { settings } from "./settings";

function buildAccountSwitcherMenu() {
    const accounts = getAccounts();
    return (
        <Menu.MenuItem
            id="xl-account-switcher"
            label="Account Switcher"
        >
            {accounts.length > 0 ? (
                accounts.map(acc => (
                    <Menu.MenuItem
                        key={acc.id}
                        id={`xl-switch-${acc.id}`}
                        label={acc.nickname}
                        action={() => switchToAccount(acc)}
                    />
                ))
            ) : (
                <Menu.MenuItem
                    id="xl-no-accounts"
                    label="No accounts"
                    disabled={true}
                />
            )}
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="xl-manage-accounts"
                label="Manage..."
                action={() => openAccountModal(switchToAccount)}
            />
        </Menu.MenuItem>
    );
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    children.push(
        <Menu.MenuGroup>
            {buildAccountSwitcherMenu()}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "XLAccountSwitcher",
    description: "better account switcher so you're not limited to 5 only, right click your user in any chat to access",
    authors: [{ name: "RoofusPoof", id: 1352342643853492246n }],
    settings,

    contextMenus: {
        "user-context": userContextMenuPatch,
        "user-profile-actions": userContextMenuPatch,
    },

    toolboxActions: {
        "Manage Accounts": () => openAccountModal(switchToAccount),
        "Add Test (Dev)": addTestAccount,
        "Clear All (Dev)": clearAllAccounts,
    },

    start() {
        console.log("[XLAccountSwitcher] Started");
        // Validation is now done only when switching fails
    },

    stop() {
        console.log("[XLAccountSwitcher] Stopped");
    }
});
