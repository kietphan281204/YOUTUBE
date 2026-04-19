const API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";
const AUTH_STORAGE_KEYS = ["current_user", "currentUser"];

function apiUrl(path) {
    const p = String(path || "");
    if (!p.startsWith("/")) return API_BASE ? `${API_BASE}/${p}` : p;
    return API_BASE ? `${API_BASE}${p}` : p;
}

function apiFetch(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("ngrok-skip-browser-warning", "1");
    return fetch(apiUrl(path), { ...init, headers });
}

function loadCurrentUser() {
    try {
        for (const key of AUTH_STORAGE_KEYS) {
            const raw = localStorage.getItem(key);
            if (raw) return JSON.parse(raw);
        }
        return null;
    } catch {
        return null;
    }
}

function setDetailStatus(msg, isError = false) {
    const el = document.getElementById("detailStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#1b5e20";
}

function setCommentHint(msg, isError = false) {
    const el = document.getElementById("commentHint");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#555";
}

function explainApiFailure(status, text) {
    const t = String(text || "");
    if (status === 404 && t.includes("Cannot GET")) {
        return (
            "API không có route này (404). Thường do backend chưa chạy bản mới có GET /api/videos/:id. " +
            "Làm: git pull trong thư mục project → npm.cmd run dev → ngrok http 8080 → cập nhật window.API_BASE trong config.js " +
            "trùng URL ngrok hiện tại → push. Giữ cả Node và ngrok đang mở khi dùng GitHub Pages."
        );
    }
    return `Server trả về không phải JSON (HTTP ${status}): ${t.slice(0, 200)}`;
}

async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) return { ok: false, error: `Empty response (HTTP ${res.status})` };
    try {
        return JSON.parse(text);
    } catch {
        return {
            ok: false,
            error: explainApiFailure(res.status, text),
        };
    }
}

function renderComments(comments) {
    const list = document.getElementById("commentList");
    if (!list) return;
    list.innerHTML = "";
    if (!comments?.length) {
        list.innerHTML = "<p class=\"commentEmpty\">Chưa có bình luận.</p>";
        return;
    }
    for (const c of comments) {
        const row = document.createElement("div");
        row.className = "commentItem";
        const who = c.TenDangNhap || `User #${c.NguoiDungId ?? ""}`;
        
        // Format date strictly for Vietnam (24h format)
        let when = "";
        if (c.NgayTao) {
            const date = new Date(c.NgayTao);
            when = date.toLocaleString("vi-VN", {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        }

        row.innerHTML =
            `<div class="commentHead"><strong>${escapeHtml(who)}</strong>` +
            `<span class="commentTime">${escapeHtml(when)}</span></div>` +
            `<div class="commentBody">${escapeHtml(c.NoiDung || "")}</div>`;
        list.appendChild(row);
    }
}

function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

function pickVideoDescription(v) {
    if (!v || typeof v !== "object") return "";
    // API đã chuẩn hoá `Description`; giữ fallback cho bản cũ.
    const raw = v.Description ?? v.description ?? v.mo_ta ?? v.MO_TA;
    if (raw == null || raw === "") return "";
    return String(raw).trim();
}

async function loadLikeState(videoId, user) {
    const likeBtn = document.getElementById("likeBtn");
    const likeCount = document.getElementById("likeCount");

    if (likeBtn && !user?.nguoi_dung_id) {
        likeBtn.disabled = true;
        likeBtn.textContent = "Đăng nhập để like";
    }
    if (likeCount) likeCount.textContent = "0 lượt thích";

    if (!videoId || !user?.nguoi_dung_id) return;

    try {
        const url =
            `/api/videos/${encodeURIComponent(videoId)}/likes?nguoi_dung_id=${encodeURIComponent(
                user.nguoi_dung_id
            )}`;
        const res = await apiFetch(url);
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.ok) throw new Error(data.error || "Không tải lượt thích.");

        if (likeCount) {
            const n = Number(data.count || 0);
            likeCount.textContent = `${n} lượt thích`;
        }
        if (likeBtn) {
            if (data.liked) {
                likeBtn.classList.add("liked");
                likeBtn.textContent = "❤️ Đã thích";
            } else {
                likeBtn.classList.remove("liked");
                likeBtn.textContent = "👍 Thích";
            }
            likeBtn.disabled = false;
        }
    } catch (e) {
        setCommentHint(`Không tải lượt thích: ${e.message}`, true);
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    if (location.hostname.endsWith("github.io") && !API_BASE) {
        setDetailStatus(
            "Chưa cấu hình backend: mở config.js, đặt window.API_BASE = URL https ngrok (hoặc server API), commit và push.",
            true
        );
        document.getElementById("detailTitle").textContent = "Lỗi cấu hình";
        return;
    }

    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) {
        setDetailStatus("Thiếu tham số id trên URL.", true);
        return;
    }

    document.getElementById("backBtn")?.addEventListener("click", () => {
        window.location.href = "index.html";
    });
    document.getElementById("loginPageBtn")?.addEventListener("click", () => {
        window.location.href = "login.html";
    });

    const user = loadCurrentUser();
    const formWrap = document.getElementById("commentFormWrap");
    if (!user?.nguoi_dung_id) {
        if (formWrap) formWrap.style.display = "none";
        setCommentHint("Đăng nhập để gửi bình luận.", true);
    }

    try {
        const u0 = loadCurrentUser();
        const resV = await apiFetch(
            `/api/videos/${encodeURIComponent(id)}${
                u0?.nguoi_dung_id ? `?nguoi_dung_id=${encodeURIComponent(u0.nguoi_dung_id)}` : ""
            }`
        );
        const dataV = await parseJsonResponse(resV);
        if (!resV.ok || !dataV.ok) throw new Error(dataV.error || "Không tải được video.");
        const v = dataV.video;
        document.getElementById("detailTitle").textContent = v.Title || "Video";
        const descEl = document.getElementById("detailDescription");
        if (descEl) {
            const d = pickVideoDescription(v);
            if (d) {
                descEl.textContent = d;
                descEl.style.display = "block";
            } else {
                descEl.style.display = "none";
            }
        }
        const vid = document.getElementById("detailVideo");
        vid.src = apiUrl(v.RelativeUrl);
        const metaEl = document.getElementById("detailMeta");
        if (metaEl) {
            console.log("Dữ liệu video nhận được:", v); // Kiểm tra trong F12 Console
            
            let dateStr = "";
            if (v.UploadedAt) {
                const date = new Date(v.UploadedAt);
                dateStr = date.toLocaleString("vi-VN", {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            }
            
            // Nếu không có tên từ server, dùng "Người dùng hệ thống"
            const userName = v.TenDangNhap || "Người dùng hệ thống";
            const userId = v.NguoiDungId || "1";
            const avatarUrl = v.Avatar ? apiUrl(v.Avatar) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
            
            metaEl.style.display = "flex";
            metaEl.style.alignItems = "center";
            metaEl.style.gap = "15px";
            metaEl.style.padding = "10px";
            metaEl.style.background = "#f9f9f9";
            metaEl.style.borderLeft = "4px solid #0066ff";
            
            metaEl.innerHTML = `
                <img src="${avatarUrl}" alt="${userName}" style="width: 45px; height: 45px; border-radius: 50%; object-fit: cover; border: 2px solid #0066ff;">
                <div>
                    <div style="font-weight: bold; margin-bottom: 4px;">
                        Đăng bởi: <a href="user.html?id=${userId}" style="color: #0066ff; text-decoration: none;">${userName}</a>
                    </div>
                    <div style="font-size: 13px; color: #666;">Ngày đăng: ${dateStr}</div>
                </div>
            `;
        }
        const viewCountEl = document.getElementById("viewCount");
        if (viewCountEl) {
            const n = Number(v.LuotXem ?? v.luot_xem ?? 0);
            viewCountEl.textContent = `${Number.isFinite(n) ? n : 0} lượt xem`;
        }
        setDetailStatus("", false);
    } catch (e) {
        console.error("Lỗi Video JS:", e);
        setDetailStatus("Lỗi tải thông tin: " + e.message, true);
        return;
    }

    await loadLikeState(id, user);

    async function loadComments() {
        try {
            const res = await apiFetch(`/api/videos/${encodeURIComponent(id)}/comments`);
            const data = await parseJsonResponse(res);
            if (!res.ok || !data.ok) throw new Error(data.error || "Không tải bình luận.");
            renderComments(data.comments);
        } catch (e) {
            setCommentHint(`Không tải bình luận: ${e.message}`, true);
        }
    }

    await loadComments();

    document.getElementById("sendCommentBtn")?.addEventListener("click", async () => {
        const u = loadCurrentUser();
        if (!u?.nguoi_dung_id) {
            setCommentHint("Bạn cần đăng nhập.", true);
            return;
        }
        const input = document.getElementById("commentInput");
        const noiDung = (input?.value || "").trim();
        if (!noiDung) {
            setCommentHint("Nhập nội dung bình luận.", true);
            return;
        }
        setCommentHint("Đang gửi…", false);
        try {
            const res = await apiFetch(`/api/videos/${encodeURIComponent(id)}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ noi_dung: noiDung, nguoi_dung_id: u.nguoi_dung_id }),
            });
            const data = await parseJsonResponse(res);
            if (!res.ok || !data.ok) throw new Error(data.error || "Gửi thất bại");
            if (input) input.value = "";
            setCommentHint("Đã gửi bình luận.", false);
            await loadComments();
        } catch (e) {
            setCommentHint(e.message || String(e), true);
        }
    });

    document.getElementById("likeBtn")?.addEventListener("click", async () => {
        const u = loadCurrentUser();
        if (!u?.nguoi_dung_id) {
            setCommentHint("Bạn cần đăng nhập để thích video.", true);
            return;
        }
        try {
            const res = await apiFetch(`/api/videos/${encodeURIComponent(id)}/likes/toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nguoi_dung_id: u.nguoi_dung_id }),
            });
            const data = await parseJsonResponse(res);
            if (!res.ok || !data.ok) throw new Error(data.error || "Không cập nhật lượt thích.");
            await loadLikeState(id, u);
        } catch (e) {
            setCommentHint(e.message || String(e), true);
        }
    });
});
