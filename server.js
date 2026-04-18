const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sql = require("mssql");
const crypto = require("crypto");
const { execFile } = require("child_process");

require("dotenv").config();

const { sqlConfig } = require("./sql.config");

const app = express();

// Sau ngrok, client IP thường nằm trong `x-forwarded-for`.
// bật trust proxy để `req.ip` có ý nghĩa hơn.
app.set("trust proxy", true);

// CORS: GitHub Pages → ngrok cần preflight; không giới hạn allowedHeaders quá hẹp
// (trình duyệt có thể gửi thêm header → nếu thiếu sẽ báo Failed to fetch).
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
    // Preflight phải cho phép header tùy chỉnh (GitHub Pages → ngrok), nếu không trình duyệt bỏ X-Video-Description.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
      "X-Video-Description",
      "X-Mo-Ta",
    ],
  })
);
app.use(express.json());

const staticDir = __dirname;

// Keep uploaded videos in a top-level uploads/ folder (ignored by Git).
const uploadsDir = path.join(staticDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path
      .basename(file.originalname || "video", ext)
      .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
      .trim()
      .slice(0, 80);
    const safeBase = base.length ? base : "video";
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    fieldSize: 5 * 1024 * 1024, // mô tả dài vẫn an toàn
  },
  fileFilter: (_req, file, cb) => {
    // Nếu upload ảnh đại diện thì cho phép định dạng ảnh
    if (file.fieldname === "avatar") {
      const isImage = file.mimetype.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(path.extname(file.originalname).toLowerCase());
      if (isImage) return cb(null, true);
      return cb(new Error("File không phải ảnh. Vui lòng chọn ảnh đại diện hợp lệ."));
    }

    const mime = String(file.mimetype || "");
    const ext = path.extname(file.originalname || "").toLowerCase();
    const okByMime = mime.startsWith("video/");
    const okByExt = [".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v"].includes(ext);
    // Một số trình duyệt/mobile không gửi mimetype → vẫn cho phép nếu đuôi file là video.
    if (okByMime || okByExt) return cb(null, true);
    return cb(new Error("File không phải video (chọn file .mp4, .webm, ...)."));
  },
});

function hashPassword(raw) {
  return crypto.createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

function mapNguoiDungRow(row) {
  if (!row) return null;
  return {
    nguoi_dung_id: row.nguoi_dung_id || row.id,
    ten_dang_nhap: row.ten_dang_nhap || row.username,
    email: row.email,
    anh_dai_dien: row.anh_dai_dien || row.avatar_url || null
  };
}

/** Multer đặt text field vào req.body; đôi khi key khác chữ hoa hoặc là mảng — không được nhầm với tiêu đề. */
function getMultipartField(body, keys) {
  if (!body || typeof body !== "object") return undefined;
  const lower = {};
  for (const k of Object.keys(body)) {
    lower[String(k).toLowerCase()] = body[k];
  }
  for (const key of keys) {
    let v = body[key];
    if (v === undefined) v = lower[String(key).toLowerCase()];
    if (v === undefined) continue;
    return Array.isArray(v) ? v[v.length - 1] : v;
  }
  return undefined;
}

function sliceText(raw, maxLen) {
  if (raw == null) return "";
  if (Buffer.isBuffer(raw)) return raw.toString("utf8").trim().slice(0, maxLen);
  if (Array.isArray(raw)) return sliceText(raw[raw.length - 1], maxLen);
  const s = typeof raw === "string" ? raw : String(raw);
  return s.trim().slice(0, maxLen);
}

/** Chuẩn hoá key cột (mssql có thể trả PascalCase / camelCase / moTa). */
function rowLowerKeys(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    o[String(k).toLowerCase()] = v;
  }
  return o;
}

/** JSON trả về cho frontend — luôn có Description (null nếu không có mô tả trong DB). */
function videoFromRow(row) {
  if (!row || typeof row !== "object") return row;
  const L = rowLowerKeys(row);
  const mo = L.mo_ta ?? L.mota ?? L.description ?? null;
  const desc =
    mo == null || mo === "" ? null : sliceText(mo, 4000) || null;
  return {
    Id: L.id ?? L.video_id,
    Title: L.title ?? L.tieu_de ?? "",
    Description: desc,
    RelativeUrl: L.relativeurl ?? L.duong_dan_video,
    LuotXem: Number(L.luotxem ?? L.luot_xem ?? 0),
    SoLike: Number(L.so_like ?? L.solike ?? 0),
    SoBinhLuan: Number(L.so_binh_luan ?? L.sobinhluan ?? 0),
    UploadedAt: L.uploadedat ?? L.ngay_tao ?? L.thoi_gian_dang,
    CategoryId: L.categoryid ?? L.danh_muc_id ?? null,
    NguoiDungId: L.nguoidungid ?? L.nguoi_dung_id,
    TenDangNhap: L.tendangnhap ?? L.ten_dang_nhap,
    Avatar: L.avatar ?? L.anh_dai_dien ?? null
  };
}

/**
 * Đọc tiêu đề + mô tả khi đăng video (làm lại gọn):
 * 1) Field `meta` = JSON { title, mo_ta } — ổn định nhất với multipart/multer.
 * 2) Query ?mo_ta=... (dự phòng).
 * 3) Form field mo_ta / description.
 */
function readUploadMeta(req) {
  let title = "";
  let moTa = "";
  const metaRaw = getMultipartField(req.body, ["meta"]);
  if (metaRaw != null && String(metaRaw).trim()) {
    try {
      const cleaned = String(metaRaw).replace(/^\uFEFF/, "").trim();
      const m = JSON.parse(cleaned);
      if (m && typeof m.mo_ta === "string") moTa = sliceText(m.mo_ta, 4000);
      if (m && typeof m.title === "string") title = sliceText(m.title, 255);
    } catch {
      /* meta không phải JSON */
    }
  }
  if (!moTa) {
    const q = req.query?.mo_ta;
    if (q != null && q !== "") {
      try {
        moTa = sliceText(decodeURIComponent(String(q)), 4000);
      } catch {
        moTa = sliceText(String(q), 4000);
      }
    }
  }
  if (!moTa) {
    moTa = sliceText(getMultipartField(req.body, ["mo_ta", "description", "video_description"]), 4000);
  }
  if (!title) {
    title = sliceText(getMultipartField(req.body, ["title", "tieu_de"]), 255);
  }
  return { title, moTa };
}

let nguoiXemColumnsCache = null;
async function getNguoiXemColumns(pool) {
  if (nguoiXemColumnsCache) return nguoiXemColumnsCache;
  const result = await pool
    .request()
    .query(`
      SELECT c.name AS column_name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_xem')
      ORDER BY c.column_id
    `);
  nguoiXemColumnsCache = new Set((result.recordset || []).map((r) => r.column_name));
  return nguoiXemColumnsCache;
}

let nguoiXemMetaCache = null;
async function getNguoiXemMeta(pool) {
  if (nguoiXemMetaCache) return nguoiXemMetaCache;
  const result = await pool
    .request()
    .query(`
      SELECT
        c.name AS column_name,
        TYPE_NAME(c.user_type_id) AS data_type,
        c.max_length
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_xem')
      ORDER BY c.column_id
    `);

  const meta = {};
  for (const row of result.recordset || []) {
    const max_length = Number(row.max_length);
    const type = String(row.data_type || "").toLowerCase();
    let maxChars = Infinity;
    if (Number.isFinite(max_length) && max_length >= 0) {
      // NVARCHAR/NCHAR: max_length tính theo byte
      if (type.includes("nvarchar") || type.includes("nchar")) maxChars = Math.floor(max_length / 2);
      else maxChars = max_length;
    }
    meta[row.column_name] = { maxChars };
  }

  nguoiXemMetaCache = meta;
  return nguoiXemMetaCache;
}

function safeSlice(str, maxChars) {
  const s = String(str ?? "");
  if (!Number.isFinite(maxChars) || maxChars === Infinity) return s;
  if (maxChars <= 0) return "";
  return s.slice(0, maxChars);
}

let ffprobePath = process.env.FFPROBE_PATH || null;
try {
  if (!ffprobePath) {
    // Bundled ffprobe binary (cross-platform) if installed.
    ffprobePath = require("ffprobe-static").path;
  }
} catch {
  // ffprobe-static may be absent; fallback to client duration.
}

function probeVideoDurationSeconds(filePath) {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(0);
    execFile(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(0);
        const n = Number.parseFloat(String(stdout || "").trim());
        if (!Number.isFinite(n) || n < 0) return resolve(0);
        return resolve(Math.round(n));
      }
    );
  });
}

function toAbsoluteUploadPath(relativeUrl) {
  const p = String(relativeUrl || "").trim();
  if (!p) return "";
  // "/uploads/abc.mp4" -> "uploads/abc.mp4"
  const cleaned = p.replace(/^[/\\]+/, "");
  return path.join(staticDir, cleaned);
}

async function backfillVideoDurations() {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(
      "SELECT TOP (300) video_id, duong_dan_video, thoi_luong FROM dbo.video WHERE ISNULL(thoi_luong, 0) = 0 ORDER BY video_id DESC"
    );
    const rows = result.recordset || [];
    if (!rows.length) return;

    let updated = 0;
    for (const row of rows) {
      const absPath = toAbsoluteUploadPath(row.duong_dan_video);
      if (!absPath || !fs.existsSync(absPath)) continue;
      const dur = await probeVideoDurationSeconds(absPath);
      if (!Number.isFinite(dur) || dur <= 0) continue;

      await pool
        .request()
        .input("Id", sql.Int, Number(row.video_id))
        .input("Duration", sql.Int, Math.trunc(dur))
        .query("UPDATE dbo.video SET thoi_luong = @Duration WHERE video_id = @Id");
      updated += 1;
    }

    // eslint-disable-next-line no-console
    console.log(`[duration] backfill done: updated ${updated}/${rows.length} rows with thoi_luong.`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[duration] backfill failed:", e?.message || e);
  }
}

app.post("/api/auth/register", upload.single("avatar"), async (req, res) => {
  try {
    // Lấy dữ liệu từ body (hỗ trợ cả snake_case và camelCase)
    const tenDangNhap = String(req.body?.ten_dang_nhap || req.body?.username || "").trim().slice(0, 255);
    const email = String(req.body?.email || "").trim().slice(0, 255);
    const password = String(req.body?.password || "").trim();

    if (!tenDangNhap || !password) {
      return res.status(400).json({
        ok: false,
        error: "Thiếu dữ liệu. Vui lòng nhập Tên đăng nhập và Mật khẩu.",
      });
    }

    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const pool = await sql.connect(sqlConfig);
    const inserted = await pool
      .request()
      .input("TenDangNhap", sql.NVarChar(255), tenDangNhap)
      .input("Email", sql.NVarChar(255), email)
      .input("MatKhauHash", sql.NVarChar(255), hashPassword(password))
      .input("Avatar", sql.NVarChar(500), avatarUrl)
      .query(
        "INSERT INTO dbo.nguoi_dung (ten_dang_nhap, email, mat_khau_hash, anh_dai_dien, ngay_tao, ngay_cap_nhat) " +
          "OUTPUT INSERTED.nguoi_dung_id, INSERTED.ten_dang_nhap, INSERTED.email, INSERTED.anh_dai_dien " +
          "VALUES (@TenDangNhap, @Email, @MatKhauHash, @Avatar, GETDATE(), GETDATE())"
      );

    return res.json({ ok: true, user: mapNguoiDungRow(inserted.recordset?.[0] || null) });
  } catch (err) {
    if (err?.number === 2627 || err?.number === 2601) {
      return res.status(409).json({
        ok: false,
        error: "Tên đăng nhập hoặc email đã tồn tại.",
      });
    }
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const login = String(req.body?.login || "").trim().slice(0, 255);
    const password = String(req.body?.password || "");
    if (!login || !password) {
      return res.status(400).json({
        ok: false,
        error: "Thiếu dữ liệu. Cần login (tên đăng nhập hoặc email) và password.",
      });
    }

    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("Login", sql.NVarChar(255), login)
      .query(
        "SELECT TOP (1) nguoi_dung_id, ten_dang_nhap, email, mat_khau_hash, anh_dai_dien " +
          "FROM dbo.nguoi_dung " +
          "WHERE ten_dang_nhap = @Login OR email = @Login"
      );

    const user = result.recordset?.[0];
    if (!user) return res.status(401).json({ ok: false, error: "Sai tài khoản hoặc mật khẩu." });

    const incomingHash = hashPassword(password);
    if (String(user.mat_khau_hash || "") !== incomingHash) {
      return res.status(401).json({ ok: false, error: "Sai tài khoản hoặc mật khẩu." });
    }

    return res.json({ ok: true, user: mapNguoiDungRow(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/categories", async (_req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query("SELECT danh_muc_id, ten_danh_muc FROM dbo.danh_muc ORDER BY danh_muc_id ASC");
    res.json({ ok: true, categories: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/tags", async (req, res) => {
  try {
    const catId = Number(req.query.categoryId);
    const pool = await sql.connect(sqlConfig);
    const request = pool.request();
    let q = "SELECT tag_id, ten_tag FROM dbo.the_tag";
    if (Number.isFinite(catId) && catId > 0) {
      q += " WHERE danh_muc_id = @CatId";
      request.input("CatId", sql.Int, catId);
    }
    q += " ORDER BY ten_tag ASC";
    const result = await request.query(q);
    res.json({ ok: true, tags: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/tags", async (req, res) => {
  try {
    let categoryId = Number(req.body.categoryId);
    const tagName = String(req.body.tagName || "").trim();
    
    if (!tagName) {
      return res.status(400).json({ ok: false, error: "Tên tag không được để trống." });
    }
    
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      categoryId = null; // Cứ cho phép lưu tag dù không có category ID hợp lệ
    }

    const pool = await sql.connect(sqlConfig);
    const request = pool.request();
    
    // Kiểm tra xem thẻ tag gốc đã tồn tại chưa để tránh lỗi uq_ten_tag
    const checkQuery = "SELECT 1 FROM dbo.the_tag WHERE ten_tag = @TagName";
    request.input("TagName", sql.NVarChar(255), tagName);
    const checkRes = await request.query(checkQuery);
    
    if (checkRes.recordset && checkRes.recordset.length > 0) {
      return res.json({ ok: true, message: "Thẻ tag đã tồn tại trên hệ thống." });
    }

    request.input("CatId", sql.Int, categoryId);
    await request.query("INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES (@CatId, @TagName)");
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos", async (req, res) => {
  try {
    const catId = Number(req.query.categoryId);
    const searchQuery = String(req.query.q || "").trim();
    const pool = await sql.connect(sqlConfig);
    const request = pool.request();
    let q = "SELECT TOP (100) Id, Title, Description, RelativeUrl, UploadedAt FROM dbo.vw_tim_kiem_video WHERE 1=1";
    if (Number.isFinite(catId) && catId > 0) {
      q += " AND CategoryId = @CatId";
      request.input("CatId", sql.Int, catId);
    }
    if (searchQuery) {
      q += " AND (Title LIKE @Search OR Description LIKE @Search OR UploaderName LIKE @Search OR CategoryName LIKE @Search)";
      request.input("Search", sql.NVarChar(255), `%${searchQuery}%`);
      request.input("SearchExact", sql.NVarChar(255), searchQuery);
      request.input("SearchPrefix", sql.NVarChar(255), `${searchQuery}%`);
      request.input("SearchWord", sql.NVarChar(255), `% ${searchQuery} %`);
      q += ` ORDER BY
        CASE
          WHEN LOWER(Title) = LOWER(@SearchExact)
            OR LOWER(Description) = LOWER(@SearchExact)
            OR LOWER(UploaderName) = LOWER(@SearchExact)
            OR LOWER(CategoryName) = LOWER(@SearchExact) THEN 0
          WHEN LOWER(Title) LIKE LOWER(@SearchPrefix)
            OR LOWER(Description) LIKE LOWER(@SearchPrefix)
            OR LOWER(UploaderName) LIKE LOWER(@SearchPrefix)
            OR LOWER(CategoryName) LIKE LOWER(@SearchPrefix) THEN 1
          WHEN LOWER(Title) LIKE LOWER(@SearchWord)
            OR LOWER(Description) LIKE LOWER(@SearchWord)
            OR LOWER(UploaderName) LIKE LOWER(@SearchWord)
            OR LOWER(CategoryName) LIKE LOWER(@SearchWord) THEN 2
          WHEN LOWER(Title) LIKE LOWER(@Search)
            OR LOWER(Description) LIKE LOWER(@Search)
            OR LOWER(UploaderName) LIKE LOWER(@Search)
            OR LOWER(CategoryName) LIKE LOWER(@Search) THEN 3
          ELSE 4
        END, Id DESC`;
    } else {
      q += " ORDER BY Id DESC";
    }
    
    // Đọc ra từ View (Nằm trong thư mục Views của SSMS)
    const result = await request.query(q);
    res.json({ ok: true, videos: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos/history/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ ok: false, error: "ID người dùng không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("Uid", sql.Int, userId)
      .query(
        "SELECT " +
          "l.video_id AS Id, " +
          "l.tieu_de AS Title, " +
          "l.mo_ta AS Description, " +
          "l.video_url AS RelativeUrl, " +
          "ISNULL(v.luot_xem, 0) AS LuotXem, " +
          "ISNULL((SELECT COUNT(*) FROM dbo.luot_thich lt WHERE lt.video_id = l.video_id), 0) AS SoLike, " +
          "ISNULL((SELECT COUNT(*) FROM dbo.binh_luan bl WHERE bl.video_id = l.video_id), 0) AS SoBinhLuan, " +
          "l.thoi_gian_dang AS UploadedAt, " +
          "u.ten_dang_nhap AS TenDangNhap, " +
          "u.anh_dai_dien AS Avatar " +
          "FROM dbo.lich_su_dang_video l " +
          "LEFT JOIN dbo.video v ON l.video_id = v.video_id " +
          "LEFT JOIN dbo.nguoi_dung u ON l.nguoi_dung_id = u.nguoi_dung_id " +
          "WHERE l.nguoi_dung_id = @Uid " +
          "ORDER BY l.thoi_gian_dang DESC"
      );
    const rows = (result.recordset || []).map((r) => videoFromRow(r));
    res.json({ ok: true, videos: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * Video xu hướng: đủ điều kiện like / bình luận / lượt xem (mặc định 3 / 3 / 5).
 * Phải khai báo TRƯỚC route /api/videos/:id để không bị coi id = "trending".
 */
async function fetchTrendingVideos(req) {
  const pool = await sql.connect(sqlConfig);
  const result = await pool
    .request()
    .query(
      "SELECT TOP (50) " +
        "video_id AS Id, tieu_de AS Title, mo_ta AS Description, duong_dan_video AS RelativeUrl, " +
        "ngay_tao AS UploadedAt, luot_xem AS LuotXem, " +
        "so_like AS SoLike, so_binh_luan AS SoBinhLuan, diem_xu_huong AS DiemXuHuong " +
        "FROM dbo.video_xu_huong " +
        "ORDER BY diem_xu_huong DESC"
    );
  const rows = (result.recordset || []).map((r) => {
    const base = videoFromRow(r);
    return {
      ...base,
      SoLike: Number(r.SoLike ?? r.soLike ?? 0),
      SoBinhLuan: Number(r.SoBinhLuan ?? r.soBinhLuan ?? 0),
      DiemXuHuong: Number(r.DiemXuHuong ?? r.diemXuHuong ?? 0),
    };
  });
  return { rows };
}

app.get("/api/videos/trending", async (req, res) => {
  try {
    const { rows } = await fetchTrendingVideos(req);
    res.json({ ok: true, videos: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos/:id", async (req, res) => {
  if (String(req.params.id).toLowerCase() === "trending") {
    try {
      const { rows } = await fetchTrendingVideos(req);
      return res.json({ ok: true, videos: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  }
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);

    // Ghi nhận người xem (dbo.nguoi_xem) khi mở trang chi tiết.
    // Logic upsert theo: dia_chi_ip + thiet_bi (nếu 2 cột này tồn tại).
    try {
      const cols = await getNguoiXemColumns(pool);
      const meta = await getNguoiXemMeta(pool);

      const xff = String(req.headers["x-forwarded-for"] || "");
      // x-forwarded-for có thể dạng "client, proxy1, proxy2"
      const ip = (xff.split(",")[0] || req.ip || "").trim();
      const thietBiRaw = String(req.headers["user-agent"] || "");

      const viewerHash = crypto
        .createHash("sha256")
        .update(`${ip}|${thietBiRaw}`)
        .digest("hex")
        .slice(0, 12);
      const ipSafe = ip || "0.0.0.0";
      const tenNguoiXemDefault = `viewer_${viewerHash}`;

      // Nếu dbo.nguoi_xem có cột nguoi_dung_id NOT NULL, ta phải điền giá trị.
      // Ưu tiên lấy nguoi_dung_id từ query (nếu frontend gửi), sau đó mới fallback env/first user.
      const nguoiDungIdFromReq = Number(req.query?.nguoi_dung_id);
      const defaultEnvId = Number(process.env.DEFAULT_NGUOI_DUNG_ID);
      let viewerNguoiDungId = NaN;
      let tenNguoiXem = tenNguoiXemDefault;

      if (cols.has("nguoi_dung_id")) {
        const candidates = [nguoiDungIdFromReq, defaultEnvId].filter(
          (x) => Number.isFinite(x) && x > 0
        );

        for (const cand of candidates) {
          const ok = await pool
            .request()
            .input("Uid", sql.Int, Math.trunc(cand))
            .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
          if (ok.recordset?.length) {
            viewerNguoiDungId = cand;
            break;
          }
        }

        if (!Number.isFinite(viewerNguoiDungId) || viewerNguoiDungId <= 0) {
          const first = await pool
            .request()
            .query("SELECT TOP (1) nguoi_dung_id FROM dbo.nguoi_dung ORDER BY nguoi_dung_id");
          const raw = first.recordset?.[0]?.nguoi_dung_id;
          if (raw != null) viewerNguoiDungId = Number(raw);
        }

        if (Number.isFinite(viewerNguoiDungId) && viewerNguoiDungId > 0 && cols.has("ten_nguoi_xem")) {
          const name = await pool
            .request()
            .input("Uid", sql.Int, Math.trunc(viewerNguoiDungId))
            .query("SELECT TOP (1) ten_dang_nhap FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
          const ten = name.recordset?.[0]?.ten_dang_nhap;
          tenNguoiXem =
            ten != null ? String(ten).trim().slice(0, 255) : tenNguoiXemDefault;
        }
      }

      const hasDiaChiIp = cols.has("dia_chi_ip");
      const hasThietBi = cols.has("thiet_bi");
      const hasNguoiDungIdCol = cols.has("nguoi_dung_id");
      const hasTenNguoiXemCol = cols.has("ten_nguoi_xem");
      const hasLuotXemCol = cols.has("luot_xem");

      // Nếu schema không có đủ cột để định danh, chỉ bỏ qua ghi nhận.
      if (hasDiaChiIp && hasThietBi) {
        const ipMax = meta?.dia_chi_ip?.maxChars ?? Infinity;
        const tbMax = meta?.thiet_bi?.maxChars ?? Infinity;
        const nameMax = meta?.ten_nguoi_xem?.maxChars ?? Infinity;

        const ipClamped = safeSlice(ipSafe, ipMax);
        const thietBi = safeSlice(thietBiRaw, tbMax);
        tenNguoiXem = safeSlice(tenNguoiXem, nameMax);

        const existing = await pool
          .request()
          .input("Ip", sql.NVarChar(255), ipClamped)
          .input("Tb", sql.NVarChar(500), thietBi)
          .query(
            "SELECT TOP (1) nguoi_xem_id AS Id FROM dbo.nguoi_xem WHERE dia_chi_ip = @Ip AND thiet_bi = @Tb"
          );

        const existedRow = existing.recordset?.[0];
        if (existedRow?.Id) {
          // cập nhật mốc thời gian nếu schema có sẵn
          if (cols.has("ngay_truy_cap")) {
            await pool
              .request()
              .input("Id", sql.Int, existedRow.Id)
              .query(
                `UPDATE dbo.nguoi_xem SET ngay_truy_cap = GETDATE()${
                  hasLuotXemCol ? ", luot_xem = ISNULL(luot_xem, 0) + 1" : ""
                } WHERE nguoi_xem_id = @Id`
              );
          } else if (cols.has("ngay_cap_nhat")) {
            await pool
              .request()
              .input("Id", sql.Int, existedRow.Id)
              .query(
                `UPDATE dbo.nguoi_xem SET ngay_cap_nhat = GETDATE()${
                  hasLuotXemCol ? ", luot_xem = ISNULL(luot_xem, 0) + 1" : ""
                } WHERE nguoi_xem_id = @Id`
              );
          }
        } else {
          // Nếu bảng nguoi_xem có UNIQUE theo nguoi_dung_id,
          // thì có thể đã tồn tại 1 dòng cho user đó (dù ip/thiet_bi khác).
          // Khi đó cần UPDATE theo nguoi_dung_id thay vì INSERT.
          if (hasNguoiDungIdCol && Number.isFinite(viewerNguoiDungId) && viewerNguoiDungId > 0) {
            const existingByUser = await pool
              .request()
              .input("Uid", sql.Int, Math.trunc(viewerNguoiDungId))
              .query("SELECT TOP (1) nguoi_xem_id AS Id FROM dbo.nguoi_xem WHERE nguoi_dung_id = @Uid");

            const existedByUser = existingByUser.recordset?.[0];
            if (existedByUser?.Id) {
              const setParts = [];
              if (cols.has("ten_nguoi_xem")) setParts.push("ten_nguoi_xem = @TenNguoiXem");
              if (cols.has("dia_chi_ip")) setParts.push("dia_chi_ip = @Ip");
              if (cols.has("thiet_bi")) setParts.push("thiet_bi = @Tb");
              if (cols.has("ngay_truy_cap")) setParts.push("ngay_truy_cap = GETDATE()");
              else if (cols.has("ngay_cap_nhat")) setParts.push("ngay_cap_nhat = GETDATE()");
              if (hasLuotXemCol) setParts.push("luot_xem = ISNULL(luot_xem, 0) + 1");

              if (setParts.length) {
                const uReq = pool.request().input("Id", sql.Int, existedByUser.Id).input("TenNguoiXem", sql.NVarChar(255), tenNguoiXem).input("Ip", sql.NVarChar(255), ipClamped).input("Tb", sql.NVarChar(500), thietBi);
                await uReq.query(`UPDATE dbo.nguoi_xem SET ${setParts.join(", ")} WHERE nguoi_xem_id = @Id`);
              }
              return; // đã update theo nguoi_dung_id
            }
          }

          // build insert theo cột tồn tại để tránh lỗi do schema khác
          const insertCols = [];
          const insertVals = [];
          const reqSql = pool.request();

          if (cols.has("ten_nguoi_xem")) {
            insertCols.push("ten_nguoi_xem");
            insertVals.push("@TenNguoiXem");
            reqSql.input("TenNguoiXem", sql.NVarChar(255), tenNguoiXem);
          }
          if (cols.has("dia_chi_ip")) {
            insertCols.push("dia_chi_ip");
            insertVals.push("@Ip");
            reqSql.input("Ip", sql.NVarChar(255), ipClamped);
          }
          if (cols.has("thiet_bi")) {
            insertCols.push("thiet_bi");
            insertVals.push("@Tb");
            reqSql.input("Tb", sql.NVarChar(500), thietBi);
          }
          if (cols.has("nguoi_dung_id") && Number.isFinite(viewerNguoiDungId) && viewerNguoiDungId > 0) {
            insertCols.push("nguoi_dung_id");
            insertVals.push("@NguoiDungId");
            reqSql.input("NguoiDungId", sql.Int, Math.trunc(viewerNguoiDungId));
          }
          if (hasLuotXemCol) {
            insertCols.push("luot_xem");
            insertVals.push("1");
          }

          if (hasNguoiDungIdCol && (!Number.isFinite(viewerNguoiDungId) || viewerNguoiDungId <= 0)) {
            console.warn("[viewer] nguoi_xem has nguoi_dung_id but viewerNguoiDungId not set", {
              nguoi_dung_id: viewerNguoiDungId,
              ipClamped,
              thietBiLen: String(thietBi || "").length,
            });
          }
          if (cols.has("ngay_tao")) {
            insertCols.push("ngay_tao");
            insertVals.push("GETDATE()");
          }
          if (cols.has("ngay_truy_cap")) {
            insertCols.push("ngay_truy_cap");
            insertVals.push("GETDATE()");
          }
          if (cols.has("ngay_cap_nhat")) {
            insertCols.push("ngay_cap_nhat");
            insertVals.push("GETDATE()");
          }

          if (insertCols.length >= 2) {
            await reqSql
              .query(
                `INSERT INTO dbo.nguoi_xem (${insertCols.join(",")}) VALUES (${insertVals.join(
                  ","
                )})`
              );
          }

          if (insertCols.length < 2) {
            console.warn("[viewer] skip insert because insertCols empty", {
              hasTenNguoiXemCol,
              hasNguoiDungIdCol,
              insertCols,
            });
          }
        }
      }
      else {
        console.warn("[viewer] missing dia_chi_ip/thiet_bi columns, skip upsert", {
          hasDiaChiIp,
          hasThietBi,
          columns: Array.from(cols || []),
        });
      }
    } catch (e) {
      // Không làm hỏng luồng xem video nếu insert nguoi_xem lỗi
      // (nhưng vẫn log để bạn biết vì sao không có dữ liệu).
      console.warn("[viewer]", {
        message: e?.message || String(e),
      });
    }

    await pool
      .request()
      .input("Id", sql.Int, Math.trunc(id))
      .query("UPDATE dbo.video SET luot_xem = luot_xem + 1 WHERE video_id = @Id");

    const result = await pool
      .request()
      .input("Id", sql.Int, Math.trunc(id))
      .query(
        "SELECT v.video_id AS Id, v.tieu_de AS Title, v.mo_ta AS Description, " +
          "v.duong_dan_video AS RelativeUrl, v.luot_xem AS LuotXem, v.ngay_tao AS UploadedAt, " +
          "v.danh_muc_id AS CategoryId, v.nguoi_dung_id AS NguoiDungId, u.ten_dang_nhap AS TenDangNhap, u.anh_dai_dien AS Avatar " +
          "FROM dbo.video v " +
          "LEFT JOIN dbo.nguoi_dung u ON v.nguoi_dung_id = u.nguoi_dung_id " +
          "WHERE v.video_id = @Id"
      );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    
    const videoData = videoFromRow(row);
    videoData.NguoiDungId = row.NguoiDungId;
    videoData.TenDangNhap = row.TenDangNhap;
    
    res.json({ ok: true, video: videoData });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos/:id/comments", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("VideoId", sql.Int, Math.trunc(id))
      .query(
        "SELECT b.binh_luan_id AS Id, b.video_id AS VideoId, b.nguoi_dung_id AS NguoiDungId, " +
          "b.noi_dung AS NoiDung, b.ngay_tao AS NgayTao, n.ten_dang_nhap AS TenDangNhap " +
          "FROM dbo.binh_luan b " +
          "LEFT JOIN dbo.nguoi_dung n ON n.nguoi_dung_id = b.nguoi_dung_id " +
          "WHERE b.video_id = @VideoId " +
          "ORDER BY b.ngay_tao DESC"
      );
    res.json({ ok: true, comments: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.put("/api/videos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const { title, description, categoryId } = req.body;
    
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input("Title", sql.NVarChar(255), title || "")
      .input("Desc", sql.NVarChar(sql.MAX), description || "")
      .input("CatId", sql.Int, categoryId ? Number(categoryId) : null)
      .input("Vid", sql.Int, id)
      .query(
        "UPDATE dbo.video SET tieu_de = @Title, mo_ta = @Desc, danh_muc_id = @CatId WHERE video_id = @Vid; " +
        "UPDATE dbo.lich_su_dang_video SET tieu_de = @Title, mo_ta = @Desc WHERE video_id = @Vid"
      );
      
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.delete("/api/videos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);
    
    // Xoá các dữ liệu liên quan trước (vì ko có ON DELETE CASCADE toàn bộ)
    await pool.request().input("Vid", sql.Int, id).query("DELETE FROM dbo.binh_luan WHERE video_id = @Vid");
    await pool.request().input("Vid", sql.Int, id).query("DELETE FROM dbo.luot_thich WHERE video_id = @Vid");
    
    // Bảng lịch sử có ON DELETE CASCADE trên video, nhưng cứ an toàn
    await pool.request().input("Vid", sql.Int, id).query("DELETE FROM dbo.lich_su_dang_video WHERE video_id = @Vid");
    
    // Xoá video chính
    await pool.request().input("Vid", sql.Int, id).query("DELETE FROM dbo.video WHERE video_id = @Vid");
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/videos/:id/comments", async (req, res) => {
  try {
    const videoId = Number(req.params.id);
    if (!Number.isFinite(videoId) || videoId <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const noiDung = String(req.body?.noi_dung ?? "").trim().slice(0, 1000);
    if (!noiDung) {
      return res.status(400).json({ ok: false, error: "Nội dung bình luận không được để trống." });
    }
    const bodyUserId = Number(req.body?.nguoi_dung_id);
    if (!Number.isFinite(bodyUserId) || bodyUserId <= 0) {
      return res.status(401).json({ ok: false, error: "Cần đăng nhập để bình luận (thiếu nguoi_dung_id)." });
    }

    const pool = await sql.connect(sqlConfig);
    const exists = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT 1 AS ok FROM dbo.video WHERE video_id = @Vid");
    if (!exists.recordset?.length) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    }

    const userOk = await pool
      .request()
      .input("Uid", sql.Int, Math.trunc(bodyUserId))
      .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
    if (!userOk.recordset?.length) {
      return res.status(400).json({ ok: false, error: "Người dùng không tồn tại." });
    }

    const inserted = await pool
      .request()
      .input("VideoId", sql.Int, Math.trunc(videoId))
      .input("NguoiDungId", sql.Int, Math.trunc(bodyUserId))
      .input("NoiDung", sql.NVarChar(1000), noiDung)
      .query(
        "INSERT INTO dbo.binh_luan (video_id, nguoi_dung_id, noi_dung, ngay_tao) " +
          "OUTPUT INSERTED.binh_luan_id AS Id, INSERTED.video_id AS VideoId, INSERTED.nguoi_dung_id AS NguoiDungId, " +
          "INSERTED.noi_dung AS NoiDung, INSERTED.ngay_tao AS NgayTao " +
          "VALUES (@VideoId, @NguoiDungId, @NoiDung, GETDATE())"
      );

    const row = inserted.recordset?.[0];
    const name = await pool
      .request()
      .input("Uid", sql.Int, Math.trunc(bodyUserId))
      .query("SELECT ten_dang_nhap AS TenDangNhap FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
    const ten = name.recordset?.[0]?.TenDangNhap ?? null;

    res.json({
      ok: true,
      comment: row ? { ...row, TenDangNhap: ten } : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Like / Unlike video
// GET  /api/videos/:id/likes?nguoi_dung_id=...
// POST /api/videos/:id/likes/toggle  { nguoi_dung_id: number }
app.get("/api/videos/:id/likes", async (req, res) => {
  try {
    const videoId = Number(req.params.id);
    const userId = Number(req.query?.nguoi_dung_id);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }

    const pool = await sql.connect(sqlConfig);

    const cnt = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT COUNT(*) AS n FROM dbo.luot_thich WHERE video_id = @Vid");

    let liked = false;
    if (Number.isFinite(userId) && userId > 0) {
      const r = await pool
        .request()
        .input("Vid", sql.Int, Math.trunc(videoId))
        .input("Uid", sql.Int, Math.trunc(userId))
        .query(
          "SELECT 1 AS ok FROM dbo.luot_thich WHERE video_id = @Vid AND nguoi_dung_id = @Uid"
        );
      liked = !!r.recordset?.length;
    }

    res.json({
      ok: true,
      count: Number(cnt.recordset?.[0]?.n ?? 0),
      liked,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/videos/:id/likes/toggle", async (req, res) => {
  try {
    const videoId = Number(req.params.id);
    const userId = Number(req.body?.nguoi_dung_id);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, error: "Cần đăng nhập để thích video." });
    }

    const pool = await sql.connect(sqlConfig);

    const vExists = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT 1 AS ok FROM dbo.video WHERE video_id = @Vid");
    if (!vExists.recordset?.length) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    }

    const uExists = await pool
      .request()
      .input("Uid", sql.Int, Math.trunc(userId))
      .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
    if (!uExists.recordset?.length) {
      return res.status(400).json({ ok: false, error: "Người dùng không tồn tại." });
    }

    const existing = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .input("Uid", sql.Int, Math.trunc(userId))
      .query("SELECT 1 AS ok FROM dbo.luot_thich WHERE video_id = @Vid AND nguoi_dung_id = @Uid");

    let liked;
    if (existing.recordset?.length) {
      await pool
        .request()
        .input("Vid", sql.Int, Math.trunc(videoId))
        .input("Uid", sql.Int, Math.trunc(userId))
        .query("DELETE FROM dbo.luot_thich WHERE video_id = @Vid AND nguoi_dung_id = @Uid");
      liked = false;
    } else {
      await pool
        .request()
        .input("Vid", sql.Int, Math.trunc(videoId))
        .input("Uid", sql.Int, Math.trunc(userId))
        .query("INSERT INTO dbo.luot_thich (video_id, nguoi_dung_id) VALUES (@Vid, @Uid)");
      liked = true;
    }

    const cnt = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT COUNT(*) AS n FROM dbo.luot_thich WHERE video_id = @Vid");

    res.json({ ok: true, liked, count: Number(cnt.recordset?.[0]?.n ?? 0) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * Statistics endpoint: Returns aggregated stats for user's videos
 */
app.get("/api/stats/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    console.log("[stats] Loading stats for userId:", userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      console.warn("[stats] Invalid userId:", req.params.userId);
      return res.status(400).json({ ok: false, error: "ID người dùng không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);
    
    // Get real-time total stats from dbo.video for better accuracy than the history table
    const totalResult = await pool
      .request()
      .input("Uid", sql.Int, userId)
      .query(
        "SELECT " +
          "ISNULL(SUM(v.luot_xem), 0) AS totalViews, " +
          "ISNULL((SELECT COUNT(*) FROM dbo.luot_thich lt " +
          "  INNER JOIN dbo.video v2 ON lt.video_id = v2.video_id " +
          "  WHERE v2.nguoi_dung_id = @Uid), 0) AS totalLikes, " +
          "ISNULL((SELECT COUNT(*) FROM dbo.binh_luan bl " +
          "  INNER JOIN dbo.video v3 ON bl.video_id = v3.video_id " +
          "  WHERE v3.nguoi_dung_id = @Uid), 0) AS totalComments " +
          "FROM dbo.video v " +
          "WHERE v.nguoi_dung_id = @Uid"
      );
    
    const row = totalResult.recordset?.[0] || {};
    const totalStats = {
      totalViews: Number(row.totalViews ?? 0),
      totalLikes: Number(row.totalLikes ?? 0),
      totalComments: Number(row.totalComments ?? 0)
    };
    
    // Get daily stats (last 60 days) - Using Recursive CTE instead of spt_values for better compatibility
    const dailyResult = await pool
      .request()
      .input("Uid", sql.Int, userId)
      .input("Days", sql.Int, 60)
      .query(
        "WITH date_range AS ( " +
          "SELECT CAST(DATEADD(DAY, -(@Days-1), GETDATE()) AS DATE) AS date " +
          "UNION ALL " +
          "SELECT DATEADD(DAY, 1, date) " +
          "FROM date_range " +
          "WHERE date < CAST(GETDATE() AS DATE) " +
        ") " +
        "SELECT " +
          "d.date, " +
          "ISNULL(SUM(v.luot_xem), 0) AS views, " +
          "ISNULL((SELECT COUNT(*) FROM dbo.luot_thich lt " +
          "  INNER JOIN dbo.video v2 ON lt.video_id = v2.video_id " +
          "  WHERE v2.nguoi_dung_id = @Uid AND CAST(lt.ngay_tao AS DATE) = d.date), 0) AS likes, " +
          "ISNULL((SELECT COUNT(*) FROM dbo.binh_luan bl " +
          "  INNER JOIN dbo.video v3 ON bl.video_id = v3.video_id " +
          "  WHERE v3.nguoi_dung_id = @Uid AND CAST(bl.ngay_tao AS DATE) = d.date), 0) AS comments " +
          "FROM date_range d " +
          "LEFT JOIN dbo.video v ON d.date = CAST(v.ngay_tao AS DATE) AND v.nguoi_dung_id = @Uid " +
          "GROUP BY d.date " +
          "ORDER BY d.date ASC " +
        "OPTION (MAXRECURSION 366)"
      );
    
    const dailyStats = (dailyResult.recordset || []).map(r => ({
      date: r.date,
      views: Number(r.views ?? 0),
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0)
    }));
    
    console.log("[stats] Successfully loaded stats for userId:", userId, { dailyCount: dailyStats.length });
    res.json({ ok: true, totalStats, dailyStats });
  } catch (err) {
    console.error("[stats] CRITICAL ERROR for userId:", userId, err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Quick diagnostics: confirms which DB settings server is using (no password leaked)
app.get("/api/diag", (_req, res) => {
  res.json({
    ok: true,
    apiHints: {
      videoColumns: ["/api/video-columns", "/api/db/video-columns"],
    },
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    db: {
      server: sqlConfig.server,
      port: sqlConfig.port ?? null,
      database: sqlConfig.database,
      user: sqlConfig.user,
      passwordProvided: Boolean(sqlConfig.password && String(sqlConfig.password).length),
      encrypt: Boolean(sqlConfig?.options?.encrypt),
      instanceName: sqlConfig?.options?.instanceName ?? null,
    },
  });
});

// Xem cột thật của dbo.nguoi_dung (để viết INSERT đúng trong SSMS khi seed tự động thất bại)
async function nguoiDungColumnsHandler(_req, res) {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT
        c.name AS column_name,
        TYPE_NAME(c.user_type_id) AS data_type,
        c.is_nullable,
        c.is_identity
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_dung')
      ORDER BY c.column_id
    `);
    res.json({ ok: true, columns: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
app.get("/api/db/nguoi-dung-columns", nguoiDungColumnsHandler);
app.get("/api/nguoi-dung-columns", nguoiDungColumnsHandler);

async function videoColumnsHandler(_req, res) {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT c.name AS column_name, TYPE_NAME(c.user_type_id) AS data_type, c.is_nullable
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.video')
      ORDER BY c.column_id
    `);
    res.json({ ok: true, columns: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
app.get("/api/db/video-columns", videoColumnsHandler);
app.get("/api/video-columns", videoColumnsHandler);

app.post("/api/videos", upload.single("video"), async (req, res) => {
  try {
    const { title, moTa: description } = readUploadMeta(req);
    // eslint-disable-next-line no-console
    console.log("[upload]", {
      descLen: description.length,
      titleLen: title.length,
      metaField: Boolean(getMultipartField(req.body, ["meta"])),
    });
    const rawDuration = Number(getMultipartField(req.body, ["thoi_luong", "Thoi_luong"]));
    const clientDuration =
      Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.trunc(rawDuration) : 0;
    if (!req.file) return res.status(400).json({ ok: false, error: "Thiếu file video." });

    const relativeUrl = `/uploads/${req.file.filename}`; // đường dẫn file thật trên server
    const absoluteFilePath = path.join(uploadsDir, req.file.filename);
    const probedDuration = await probeVideoDurationSeconds(absoluteFilePath);
    const durationSeconds = probedDuration > 0 ? probedDuration : clientDuration;

    const pool = await sql.connect(sqlConfig);

    // fk_video_nguoi_dung: nguoi_dung_id phải tồn tại trong dbo.nguoi_dung
    const firstUser = await pool.request().query(
      "SELECT TOP (1) nguoi_dung_id FROM dbo.nguoi_dung ORDER BY nguoi_dung_id"
    );
    const row0 = firstUser.recordset?.[0];
    const rawFallback = row0?.nguoi_dung_id ?? row0?.NGUOI_DUNG_ID ?? row0?.id;
    const fallbackId = rawFallback != null ? Number(rawFallback) : NaN;
    if (!Number.isFinite(fallbackId)) {
      return res.status(500).json({
        ok: false,
        error:
          "Chưa có người dùng trong dbo.nguoi_dung. Thêm ít nhất 1 dòng vào bảng nguoi_dung trước khi đăng video.",
      });
    }

    const bodyNguoiDungId = Number(
      getMultipartField(req.body, ["nguoi_dung_id", "Nguoi_dung_id", "nguoiDungId"])
    );
    const wantId = Number.isFinite(bodyNguoiDungId) && bodyNguoiDungId > 0
      ? bodyNguoiDungId
      : Number(process.env.DEFAULT_NGUOI_DUNG_ID);
    let ownerId = fallbackId;
    if (Number.isFinite(wantId) && wantId > 0) {
      const exists = await pool
        .request()
        .input("CheckId", sql.Int, wantId)
        .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @CheckId");
      if (exists.recordset?.length) ownerId = wantId;
    }

    const danhMucIdRaw = getMultipartField(req.body, ["danh_muc_id", "categoryId"]);
    const danhMucId = (Number.isFinite(Number(danhMucIdRaw)) && Number(danhMucIdRaw) > 0) ? Number(danhMucIdRaw) : null;

    const insert = await pool
      .request()
      .input("NguoiDungId", sql.Int, Math.trunc(ownerId))
      .input("Title", sql.NVarChar(255), title)
      .input("Description", sql.NVarChar(sql.MAX), description)
      .input("Duration", sql.Int, durationSeconds)
      .input("Path", sql.NVarChar(500), relativeUrl)
      .input("DanhMucId", sql.Int, danhMucId)
      .query(
        "DECLARE @T TABLE (Id INT, Title NVARCHAR(255), Description NVARCHAR(MAX), RelativeUrl NVARCHAR(500), UploadedAt DATETIME); " +
        "INSERT INTO dbo.video (nguoi_dung_id, tieu_de, mo_ta, duong_dan_video, duong_dan_anh_bia, thoi_luong, luot_xem, ngay_tao, ngay_cap_nhat, danh_muc_id, tag_id) " +
          "OUTPUT INSERTED.video_id AS Id, INSERTED.tieu_de AS Title, INSERTED.mo_ta AS Description, INSERTED.duong_dan_video AS RelativeUrl, INSERTED.ngay_tao AS UploadedAt INTO @T " +
          "VALUES (@NguoiDungId, @Title, NULLIF(@Description, N''), @Path, @Path, @Duration, CAST(0 AS BIGINT), GETDATE(), GETDATE(), @DanhMucId, NULL); " +
        "SELECT * FROM @T;"
      );

    const newId = Number(insert.recordset?.[0]?.Id);
    if (Number.isFinite(newId) && newId > 0 && description.length > 0) {
      await pool
        .request()
        .input("Id", sql.Int, Math.trunc(newId))
        .input("Description", sql.NVarChar(sql.MAX), description)
        .query("UPDATE dbo.video SET mo_ta = @Description WHERE video_id = @Id");
      const verify = await pool
        .request()
        .input("Id", sql.Int, Math.trunc(newId))
        .query("SELECT mo_ta FROM dbo.video WHERE video_id = @Id");
      const saved = (verify.recordset?.[0]?.mo_ta ?? verify.recordset?.[0]?.MO_TA);
      const stillEmpty = saved == null || String(saved).trim() === "";
      if (stillEmpty) {
        await pool
          .request()
          .input("Id", sql.Int, Math.trunc(newId))
          .input("Description", sql.NVarChar(sql.MAX), description)
          .query("UPDATE dbo.video SET mo_ta = @Description WHERE video_id = @Id");
        console.warn("[upload] mo_ta was empty after first UPDATE; retried (check trigger on dbo.video).", {
          video_id: newId,
        });
      }
    }

    let videoOut = insert.recordset?.[0];
    if (Number.isFinite(newId) && newId > 0) {
      const refreshed = await pool
        .request()
        .input("Id", sql.Int, Math.trunc(newId))
        .query(
          "SELECT video_id AS Id, tieu_de AS Title, mo_ta AS Description, " +
            "duong_dan_video AS RelativeUrl, ngay_tao AS UploadedAt FROM dbo.video WHERE video_id = @Id"
        );
      if (refreshed.recordset?.[0]) videoOut = videoFromRow(refreshed.recordset[0]);
    } else if (videoOut) {
      videoOut = videoFromRow(videoOut);
    }

    res.json({ ok: true, video: videoOut });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Ensure API errors always respond with JSON (helps the client parse errors reliably)
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
  next(err);
});

// Static + trang chủ đặt SAU các route /api để không bị che bởi file tĩnh
app.use(express.static(staticDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(staticDir, "INDEX.HTML"));
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

/** Nếu dbo.nguoi_dung trống, INSERT video sẽ lỗi FK — thử thêm 1 user demo (vài kiểu cột phổ biến). */
async function ensureDemoNguoiDung() {
  try {
    const pool = await sql.connect(sqlConfig);
    const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.nguoi_dung`);
    const n = Number(cnt.recordset?.[0]?.n ?? 0);
    if (Number.isFinite(n) && n > 0) return;

    const attempts = [
      // VIDEO1: mat_khau_hash + ngay_tao + ngay_cap_nhat (bắt buộc)
      `INSERT INTO dbo.nguoi_dung (ten_dang_nhap, email, mat_khau_hash, anh_dai_dien, ngay_tao, ngay_cap_nhat) VALUES (N'demo_upload', N'demo@local.test', N'demo_sha256_placeholder', NULL, GETDATE(), GETDATE())`,
      `INSERT INTO dbo.nguoi_dung (ten_dang_nhap, mat_khau, ho_ten, email) VALUES (N'demo_upload', N'1', N'Demo', N'demo@local.test')`,
      `INSERT INTO dbo.nguoi_dung (tai_khoan, mat_khau, ho_ten) VALUES (N'demo_upload', N'1', N'Demo')`,
    ];

    for (const q of attempts) {
      try {
        await pool.request().query(q);
        // eslint-disable-next-line no-console
        console.log("[seed] Đã thêm user demo vào dbo.nguoi_dung (upload video sẽ hết lỗi FK).");
        return;
      } catch {
        /* thử câu khác */
      }
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[seed] Không tự thêm được user — mở SSMS, chạy script trong file database.sql (sửa tên cột theo Design dbo.nguoi_dung)."
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[seed]", e?.message || e);
  }
}

if (process.argv.includes("--selftest-upload")) {
  try {
    const a = readUploadMeta({
      body: { meta: '{"title":"Tiêu đề A","mo_ta":"Mô tả B"}' },
      query: {},
    });
    if (a.title !== "Tiêu đề A" || a.moTa !== "Mô tả B") {
      // eslint-disable-next-line no-console
      console.error("selftest fail meta", a);
      process.exit(1);
    }
    const b = readUploadMeta({ body: { mo_ta: "trực tiếp" }, query: {} });
    if (b.moTa !== "trực tiếp") {
      // eslint-disable-next-line no-console
      console.error("selftest fail body mo_ta", b);
      process.exit(1);
    }
    const c = readUploadMeta({
      body: {},
      query: { mo_ta: encodeURIComponent("query-string") },
    });
    if (c.moTa !== "query-string") {
      // eslint-disable-next-line no-console
      console.error("selftest fail query", c);
      process.exit(1);
    }
    const vr = videoFromRow({
      description: "từ SQL alias",
      video_id: 99,
      tieu_de: "T",
      duong_dan_video: "/u",
      luot_xem: 1,
      ngay_tao: new Date("2026-01-01"),
    });
    if (vr.Description !== "từ SQL alias" || vr.Id !== 99) {
      // eslint-disable-next-line no-console
      console.error("selftest fail videoFromRow", vr);
      process.exit(1);
    }
    const vr2 = videoFromRow({ MoTa: "camel", video_id: 1, tieu_de: "x" });
    if (vr2.Description !== "camel") {
      // eslint-disable-next-line no-console
      console.error("selftest fail videoFromRow moTa", vr2);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log("selftest-upload: OK");
    process.exit(0);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("selftest-upload:", e);
    process.exit(1);
  }
}
// --- Start Server ---
(async () => {
  await ensureDemoNguoiDung();
  await backfillVideoDurations();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running at http://localhost:${port}`);
  });
})();

