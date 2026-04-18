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
    for (const key of AUTH_STORAGE_KEYS) {
        localStorage.removeItem(key);
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
            document.getElementById("displayUser").textContent = user.ten_dang_nhap || "Người dùng";
            document.getElementById("displayEmail").textContent = user.email || "";
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
                    if (avatarFile) {
                        formData.append("avatar", avatarFile);
                    }

                    res = await fetch(apiUrl("/api/auth/register"), {
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
                    localStorage.setItem("current_user", JSON.stringify(data.user));
                    setAuthStatus("Đăng nhập thành công!");
                    setTimeout(() => showLoggedState(data.user), 1000);
                } else {
                    setAuthStatus("Đăng ký thành công! Bạn có thể đăng nhập ngay.");
                    // Chuyển sang mode đăng nhập
                    setTimeout(() => {
                        document.getElementById('showLogin').click();
                    }, 2000);
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
            const res = await fetch(apiUrl("/api/auth/update-avatar"), {
                method: "POST",
                headers: { "ngrok-skip-browser-warning": "1" },
                body: formData
            });
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { throw new Error("Server error"); }
            if (!res.ok || !data.ok) throw new Error(data.error || "Lỗi cập nhật ảnh đại diện.");
            
            localStorage.setItem("current_user", JSON.stringify(data.user));
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
