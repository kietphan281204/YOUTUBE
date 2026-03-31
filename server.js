const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sql = require("mssql");
const crypto = require("crypto");

require("dotenv").config();

const { sqlConfig } = require("./sql.config");

const app = express();

// CORS: GitHub Pages → ngrok cần preflight; không giới hạn allowedHeaders quá hẹp
// (trình duyệt có thể gửi thêm header → nếu thiếu sẽ báo Failed to fetch).
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
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
  return {
    nguoi_dung_id: row?.nguoi_dung_id,
    ten_dang_nhap: row?.ten_dang_nhap,
    email: row?.email,
  };
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const tenDangNhap = String(req.body?.ten_dang_nhap || "").trim().slice(0, 255);
    const email = String(req.body?.email || "").trim().slice(0, 255);
    const password = String(req.body?.password || "");

    if (!tenDangNhap || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Thiếu dữ liệu. Cần ten_dang_nhap, email, password.",
      });
    }

    const pool = await sql.connect(sqlConfig);
    const inserted = await pool
      .request()
      .input("TenDangNhap", sql.NVarChar(255), tenDangNhap)
      .input("Email", sql.NVarChar(255), email)
      .input("MatKhauHash", sql.NVarChar(255), hashPassword(password))
      .query(
        "INSERT INTO dbo.nguoi_dung (ten_dang_nhap, email, mat_khau_hash, anh_dai_dien, ngay_tao, ngay_cap_nhat) " +
          "OUTPUT INSERTED.nguoi_dung_id, INSERTED.ten_dang_nhap, INSERTED.email " +
          "VALUES (@TenDangNhap, @Email, @MatKhauHash, NULL, GETDATE(), GETDATE())"
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
        "SELECT TOP (1) nguoi_dung_id, ten_dang_nhap, email, mat_khau_hash " +
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

app.get("/api/videos", async (_req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .query(
        // DB VIDEO1 — bảng dbo.video
        "SELECT TOP (100) video_id AS Id, tieu_de AS Title, duong_dan_video AS RelativeUrl, ngay_tao AS UploadedAt FROM dbo.video ORDER BY video_id DESC"
      );
    res.json({ ok: true, videos: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("Id", sql.Int, Math.trunc(id))
      .query(
        "SELECT video_id AS Id, tieu_de AS Title, duong_dan_video AS RelativeUrl, luot_xem AS LuotXem, ngay_tao AS UploadedAt " +
          "FROM dbo.video WHERE video_id = @Id"
      );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    res.json({ ok: true, video: row });
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

// Quick diagnostics: confirms which DB settings server is using (no password leaked)
app.get("/api/diag", (_req, res) => {
  res.json({
    ok: true,
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

app.post("/api/videos", upload.single("video"), async (req, res) => {
  try {
    // tieu_de thường NOT NULL trong dbo.video — luôn gửi chuỗi (có thể rỗng).
    const title =
      typeof req.body?.title === "string"
        ? req.body.title.trim().slice(0, 255)
        : req.body?.title != null
          ? String(req.body.title).trim().slice(0, 255)
          : "";
    if (!req.file) return res.status(400).json({ ok: false, error: "Thiếu file video." });

    const relativeUrl = `/uploads/${req.file.filename}`; // đường dẫn file thật trên server

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

    const bodyNguoiDungId = Number(req.body?.nguoi_dung_id);
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

    const insert = await pool
      .request()
      .input("NguoiDungId", sql.Int, Math.trunc(ownerId))
      .input("Title", sql.NVarChar(255), title)
      .input("Path", sql.NVarChar(500), relativeUrl)
      .query(
        // Khớp Design VIDEO1.dbo.video: mo_ta/danh_muc_id/tag_id nullable; luot_xem bigint NOT NULL
        "INSERT INTO dbo.video (nguoi_dung_id, tieu_de, mo_ta, duong_dan_video, duong_dan_anh_bia, thoi_luong, luot_xem, ngay_tao, ngay_cap_nhat, danh_muc_id, tag_id) " +
          "OUTPUT INSERTED.video_id AS Id, INSERTED.tieu_de AS Title, INSERTED.duong_dan_video AS RelativeUrl, INSERTED.ngay_tao AS UploadedAt " +
          "VALUES (@NguoiDungId, @Title, NULL, @Path, @Path, 0, CAST(0 AS BIGINT), GETDATE(), GETDATE(), NULL, NULL)"
      );

    res.json({ ok: true, video: insert.recordset[0] });
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

(async () => {
  await ensureDemoNguoiDung();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running at http://localhost:${port}`);
  });
})();

