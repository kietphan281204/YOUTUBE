const API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";
const AUTH_STORAGE_KEYS = ["current_user", "currentUser"];

function apiUrl(path) {
    const p = String(path || "");
    if (!p.startsWith("/")) return API_BASE ? `${API_BASE}/${p}` : p;
    return API_BASE ? `${API_BASE}${p}` : p;
}

let isLoginMode = true;

function setAuthStatus(msg, isError = false) {
    const el = document.getElementById("authStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#ff4757" : "#2ed573";
    el.style.background = isError ? "rgba(255, 71, 87, 0.1)" : "rgba(46, 213, 115, 0.1)";
}

function handleLogout() {
    if (typeof saveCurrentUser === "function") {
        saveCurrentUser(null);
    } else {
        for (const key of AUTH_STORAGE_KEYS) {
            localStorage.removeItem(key);
        }
        localStorage.removeItem("auth_token");
    }
    showLoggedState(null);
}

function showLoggedState(user) {
    const section = document.getElementById("loginSection");
    const logged = document.getElementById("loggedInSection");
    if (user) {
        if (section) section.style.display = "none";
        if (logged) {
            logged.style.display = "block";
            const uInput = document.getElementById("updateUsernameInput");
            const eInput = document.getElementById("updateEmailInput");
            if (uInput) uInput.value = user.ten_dang_nhap || "";
            if (eInput) eInput.value = user.email || "";

            // Hiển thị tuổi
            const ageDisplay = document.getElementById("displayAge");
            if (ageDisplay) ageDisplay.textContent = user.do_tuoi || "Chưa cập nhật";

            // Hiển thị ảnh đại diện
            const avatarImg = document.getElementById("userAvatar");
            if (user.anh_dai_dien) {
                avatarImg.src = apiUrl(user.anh_dai_dien);
            } else {
                avatarImg.src = "https://cdn-icons-png.flaticon.com/512/149/149071.png";
            }
        }
    } else {
        if (section) section.style.display = "block";
        if (logged) logged.style.display = "none";
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("current_user") || localStorage.getItem("currentUser");
    if (saved) {
        try {
            showLoggedState(JSON.parse(saved));
        } catch {
            showLoggedState(null);
        }
    }

    const form = document.getElementById("authForm");
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = document.getElementById("username")?.value.trim();
            const password = document.getElementById("password")?.value;
            const email = document.getElementById("email")?.value.trim();
            const avatarFile = document.getElementById("avatarFile")?.files[0];
            const ageVal = document.getElementById("ageInput")?.value;

            if (!username || !password) {
                setAuthStatus("Vui lòng điền đầy đủ username và mật khẩu.", true);
                return;
            }

            setAuthStatus(isLoginMode ? "Đang đăng nhập..." : "Đang tạo tài khoản...");

            try {
                let res;
                if (isLoginMode) {
                    // Đăng nhập dùng JSON
                    res = await fetch(apiUrl("/api/auth/login"), {
                        method: "POST",
                        headers: { 
                            "Content-Type": "application/json",
                            "ngrok-skip-browser-warning": "1"
                        },
                        body: JSON.stringify({ login: username, password }),
                    });
                } else {
                    // Đăng ký dùng FormData để gửi file
                    const formData = new FormData();
                    formData.append("ten_dang_nhap", username);
                    formData.append("password", password);
                    formData.append("email", email || "");
                    formData.append("do_tuoi", ageVal || "18");
                    if (avatarFile) {
                        formData.append("avatar", avatarFile);
                    }

                    res = await fetch(apiUrl("/api/auth/register-request"), {
                        method: "POST",
                        headers: { "ngrok-skip-browser-warning": "1" },
                        body: formData,
                    });
                }

                const text = await res.text();
                let data;
                try {
                    data = JSON.parse(text);
                } catch {
                    throw new Error(`Server trả về lỗi: ${text.slice(0, 100)}`);
                }

                if (!res.ok || !data.ok) {
                    throw new Error(data.error || "Có lỗi xảy ra.");
                }

                if (isLoginMode) {
                    if (typeof saveCurrentUser === "function") {
                        saveCurrentUser(data.user, data.token);
                    } else {
                        localStorage.setItem("current_user", JSON.stringify(data.user));
                        localStorage.setItem("auth_token", data.token);
                    }
                    setAuthStatus("Đăng nhập thành công!");
                    setTimeout(() => showLoggedState(data.user), 1000);
                } else {
                    // Chế độ đăng ký: Hiện form nhập mã xác nhận
                    alert(data.message);
                    document.getElementById('authForm').style.display = 'none';
                    document.getElementById('registerVerifySection').style.display = 'block';
                    document.querySelector('.tab-buttons').style.display = 'none';
                }
            } catch (err) {
                setAuthStatus(err.message, true);
            }
        });
    }

    document.getElementById("updateAvatarFile")?.addEventListener("change", async function() {
        if (!this.files || !this.files[0]) return;
        const saved = localStorage.getItem("current_user") || localStorage.getItem("currentUser");
        if (!saved) return;
        const user = JSON.parse(saved);
        if (!user || (!user.nguoi_dung_id && !user.id)) return;
        
        const userId = user.nguoi_dung_id || user.id;
        const statusEl = document.getElementById("avatarUpdateStatus");
        statusEl.textContent = "Đang tải ảnh lên...";
        statusEl.style.color = "#666";
        
        const formData = new FormData();
        formData.append("avatar", this.files[0]);
        formData.append("nguoi_dung_id", userId);
        
        try {
            const res = await apiFetch("/api/auth/update-avatar", {
                method: "POST",
                body: formData
            });
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { throw new Error("Server error"); }
            if (!res.ok || !data.ok) throw new Error(data.error || "Lỗi cập nhật ảnh đại diện.");
            
            if (typeof saveCurrentUser === "function") {
                saveCurrentUser(data.user, localStorage.getItem("auth_token"));
            } else {
                localStorage.setItem("current_user", JSON.stringify(data.user));
            }
            document.getElementById("userAvatar").src = data.user.anh_dai_dien ? apiUrl(data.user.anh_dai_dien) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
            statusEl.textContent = "Cập nhật thành công!";
            statusEl.style.color = "#2ed573";
            setTimeout(() => statusEl.textContent = "", 3000);
        } catch (e) {
            statusEl.textContent = "Lỗi: " + e.message;
            statusEl.style.color = "#ff4757";
        }
    });

});

function showForgotPasswordFlow(e) {
    e.preventDefault();
    document.getElementById('authForm').style.display = 'none';
    document.getElementById('recoverySection').style.display = 'block';
    document.querySelector('.tab-buttons').style.display = 'none';
}

function hideForgotPasswordFlow() {
    document.getElementById('authForm').style.display = 'block';
    document.getElementById('recoverySection').style.display = 'none';
    document.querySelector('.tab-buttons').style.display = 'flex';
}

async function sendRecoveryCode() {
    const email = document.getElementById('recoveryEmail').value.trim();
    if (!email) return alert("Vui lòng nhập email");

    try {
        const res = await fetch(apiUrl("/api/auth/forgot-password"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.ok) {
            alert(data.message);
            document.getElementById('step1').style.display = 'none';
            document.getElementById('step2').style.display = 'block';
        } else {
            alert(data.error);
        }
    } catch (e) { alert("Lỗi: " + e.message); }
}

async function resetPassword() {
    const email = document.getElementById('recoveryEmail').value.trim();
    const code = document.getElementById('recoveryCode').value.trim();
    const newPassword = document.getElementById('newPassword').value;

    if (!code || !newPassword) return alert("Vui lòng điền đầy đủ mã và mật khẩu mới");

    try {
        const res = await fetch(apiUrl("/api/auth/reset-password"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
            body: JSON.stringify({ email, code, newPassword })
        });
        const data = await res.json();
        if (data.ok) {
            alert(data.message);
            hideForgotPasswordFlow();
        } else {
            alert(data.error);
        }
    } catch (e) { alert("Lỗi: " + e.message); }
}

async function verifyRegistration() {
    const email = document.getElementById('email').value.trim();
    const code = document.getElementById('regVerifyCode').value.trim();
    if (!code) return alert("Vui lòng nhập mã xác nhận");

    try {
        const res = await apiFetch("/api/auth/register-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (data.ok) {
            alert("Đăng ký thành công!");
            if (typeof saveCurrentUser === "function") {
                saveCurrentUser(data.user, data.token);
            }
            cancelRegistration();
            setTimeout(() => window.location.href = 'index.html', 1000);
        } else {
            alert(data.error);
        }
    } catch (e) { alert("Lỗi: " + e.message); }
}

function cancelRegistration() {
    document.getElementById('authForm').style.display = 'block';
    document.getElementById('registerVerifySection').style.display = 'none';
    document.querySelector('.tab-buttons').style.display = 'flex';
}

async function updateAge() {
    const ageInput = document.getElementById("updateAgeInput");
    const age = ageInput?.value;
    if (!age || age < 7 || age > 120) {
        alert("Vui lòng nhập tuổi hợp lệ (7-120).");
        return;
    }

    const saved = localStorage.getItem("current_user") || localStorage.getItem("currentUser");
    if (!saved) return;
    const user = JSON.parse(saved);
    const userId = user.nguoi_dung_id || user.id;

    const statusEl = document.getElementById("ageUpdateStatus");
    statusEl.textContent = "Đang cập nhật...";
    statusEl.style.color = "#666";

    try {
        const res = await apiFetch("/api/auth/update-age", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ do_tuoi: age })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Lỗi cập nhật tuổi.");

        if (typeof saveCurrentUser === "function") {
            saveCurrentUser(data.user, localStorage.getItem("auth_token"));
        } else {
            localStorage.setItem("current_user", JSON.stringify(data.user));
        }
        showLoggedState(data.user);
        statusEl.textContent = "Cập nhật thành công!";
        statusEl.style.color = "#2ed573";
        setTimeout(() => statusEl.textContent = "", 3000);
    } catch (e) {
        statusEl.textContent = "Lỗi: " + e.message;
        statusEl.style.color = "#ff4757";
    }
}

async function updateProfile() {
    const username = document.getElementById("updateUsernameInput")?.value.trim();
    const email = document.getElementById("updateEmailInput")?.value.trim();

    if (!username || !email) {
        alert("Vui lòng nhập đầy đủ Tên đăng nhập và Email.");
        return;
    }

    const saved = localStorage.getItem("current_user") || localStorage.getItem("currentUser");
    if (!saved) return;
    const user = JSON.parse(saved);
    const userId = user.nguoi_dung_id || user.id;

    const statusEl = document.getElementById("profileUpdateStatus");
    if (statusEl) {
        statusEl.textContent = "Đang lưu...";
        statusEl.style.color = "#666";
    }

    try {
        const res = await apiFetch("/api/auth/update-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                ten_dang_nhap: username, 
                email: email 
            })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Lỗi cập nhật thông tin.");

        if (typeof saveCurrentUser === "function") {
            saveCurrentUser(data.user, localStorage.getItem("auth_token"));
        } else {
            localStorage.setItem("current_user", JSON.stringify(data.user));
        }
        if (typeof showLoggedState === "function") showLoggedState(data.user);
        
        if (statusEl) {
            statusEl.textContent = "Cập nhật thành công!";
            statusEl.style.color = "#2ed573";
            setTimeout(() => statusEl.textContent = "", 3000);
        }
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = "Lỗi: " + e.message;
            statusEl.style.color = "#ff4757";
        }
    }
}
