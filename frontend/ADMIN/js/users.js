/* ==========================================================================
   users.js — User account management module
   Handles: CRUD for crew user accounts.
   ========================================================================== */

// ── Setup ──────────────────────────────────────────────────────────────────

function setupUserTableSelection() {
    const userTableBody = document.getElementById("userTableBody");
    if (!userTableBody) return;

    userTableBody.addEventListener("click", event => {
        const row = event.target.closest("tr[data-user-id]");
        if (!row) return;

        const user = allUsers.find(item => item._id === row.dataset.userId);
        if (user) selectUserRow(user);
    });
}

function setupUserActionButtons() {
    const addUserBtn    = document.getElementById("addUserBtn");
    const updateUserBtn = document.getElementById("updateUserBtn");
    const removeUserBtn = document.getElementById("removeUserBtn");
    const clearUserBtn  = document.getElementById("clearUserBtn");

    if (addUserBtn)    addUserBtn.addEventListener("click", addUser);
    if (updateUserBtn) updateUserBtn.addEventListener("click", updateUser);
    if (removeUserBtn) removeUserBtn.addEventListener("click", deleteUser);
    if (clearUserBtn)  clearUserBtn.addEventListener("click", clearUserForm);
}

// ── Row Selection ──────────────────────────────────────────────────────────

function selectUserRow(user) {
    selectedUserId = user._id;

    const usernameInput = document.getElementById("usernameInput");
    const passwordInput = document.getElementById("passwordInput");
    const roleSelect    = document.getElementById("roleSelect");

    if (usernameInput) usernameInput.value = user.username || "";
    if (passwordInput) passwordInput.value = user.password || "";
    if (roleSelect)    roleSelect.value    = user.role     || "Admin";
}

// ── Form Reset ─────────────────────────────────────────────────────────────

function clearUserForm() {
    selectedUserId = null;

    const usernameInput = document.getElementById("usernameInput");
    const passwordInput = document.getElementById("passwordInput");
    const roleSelect    = document.getElementById("roleSelect");

    if (usernameInput) usernameInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (roleSelect)    roleSelect.value    = "Admin";
}

// ── Payload Builder ────────────────────────────────────────────────────────

function getUserPayload() {
    const usernameInput = document.getElementById("usernameInput");
    const passwordInput = document.getElementById("passwordInput");
    const roleSelect    = document.getElementById("roleSelect");

    const username = usernameInput ? usernameInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value        : "";
    const role     = roleSelect    ? roleSelect.value           : "Admin";

    if (!username || !password || !role) {
        alert("Please complete username, password, and role before saving.");
        return null;
    }

    return {
        username,
        password,
        role,
        status: "Active",
        date: new Date().toLocaleDateString()
    };
}

// ── CRUD Operations ────────────────────────────────────────────────────────

async function addUser() {
    const payload = getUserPayload();
    if (!payload) return;

    try {
        const response = await apiFetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("✅ New user added successfully!");
            clearUserForm();
            loadLiveUserData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to create user.");
    } catch (err) {
        console.error("❌ User creation pipeline error:", err);
        alert("Failed to save user to database server.");
    }
}

async function updateUser() {
    if (!selectedUserId) {
        alert("Please select a user row from the table first before updating.");
        return;
    }

    const payload = getUserPayload();
    if (!payload) return;

    try {
        const response = await apiFetch(`/api/users/${selectedUserId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("✅ User updated successfully!");
            clearUserForm();
            loadLiveUserData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to update user.");
    } catch (err) {
        console.error("❌ User update pipeline error:", err);
        alert("Failed to update user.");
    }
}

async function deleteUser() {
    if (!selectedUserId) {
        alert("Please select a user row from the table first to delete.");
        return;
    }

    if (!confirm("Are you sure you want to delete this user?")) return;

    try {
        const response = await apiFetch(`/api/users/${selectedUserId}`, {
            method: "DELETE"
        });

        if (response.ok) {
            alert("🗑️ User deleted successfully.");
            clearUserForm();
            loadLiveUserData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to delete user.");
    } catch (err) {
        console.error("❌ User deletion pipeline error:", err);
        alert("Failed to delete user.");
    }
}

// ── Data Loader & Renderer ─────────────────────────────────────────────────

async function loadLiveUserData() {
    try {
        const response = await apiFetch("/api/users");
        if (!response.ok) throw new Error("Failed to fetch user list");

        const users = await response.json();
        allUsers = users;
        renderUserTable(users);
    } catch (err) {
        console.error("❌ User data load error:", err);
    }
}

function renderUserTable(users) {
    const tbody = document.getElementById("userTableBody");
    if (!tbody) return;

    tbody.innerHTML = users.map(user => `
        <tr data-user-id="${user._id}">
            <td>${escapeHtml(user._id)}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.password)}</td>
            <td>${escapeHtml(user.role)}</td>
            <td>${escapeHtml(user.status)}</td>
            <td>${escapeHtml(user.date)}</td>
        </tr>
    `).join("");
}
