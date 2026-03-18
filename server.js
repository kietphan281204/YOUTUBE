const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sql = require("mssql");

require("dotenv").config();

const { sqlConfig } = require("./sql.config");

const app = express();

// CORS: for simplicity, allow all origins (suitable for this demo setup with ngrok).
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"],
  })
);
app.use(express.json());

// Serve the current "Đăng Video" page as-is
// (the HTML/CSS/JS live at the project root now)
const staticDir = __dirname;
app.use(express.static(staticDir));

// Because the file is named `INDEX.HTML` (uppercase),
// explicitly serve it at the root route.
app.get("/", (_req, res) => {
  res.sendFile(path.join(staticDir, "INDEX.HTML"));
});

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
    if (!file.mimetype?.startsWith("video/")) return cb(new Error("File không phải video."));
    cb(null, true);
  },
});

app.get("/api/videos", async (_req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .query(
        // Lấy dữ liệu từ bảng cũ dbo.video trong DB VIDEO
        "SELECT TOP (100) video_id AS Id, tieu_de AS Title, duong_dan_video AS RelativeUrl, ngay_tao AS UploadedAt FROM dbo.video ORDER BY video_id DESC"
      );
    res.json({ ok: true, videos: result.recordset || [] });
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

app.post("/api/videos", upload.single("video"), async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 255) : null;
    if (!req.file) return res.status(400).json({ ok: false, error: "Thiếu file video." });

    const relativeUrl = `/uploads/${req.file.filename}`; // đường dẫn file thật trên server

    const pool = await sql.connect(sqlConfig);
    // NOTE: Bảng dbo.video của bạn có nhiều cột NOT NULL (nguoi_dung_id, luot_xem, thoi_luong, ngay_tao, ngay_cap_nhat, ...).
    // Ở đây tạm thời gán mặc định:
    // - nguoi_dung_id = 1
    // - luot_xem = 0
    // - thoi_luong = 0
    // - duong_dan_anh = NULL
    // - ngay_tao, ngay_cap_nhat = GETDATE()
    const insert = await pool
      .request()
      .input("Title", sql.NVarChar(255), title)
      .input("Path", sql.NVarChar(500), relativeUrl)
      .query(
        // Chèn vào bảng dbo.video với giá trị mặc định cho các cột bắt buộc khác.
       "INSERT INTO dbo.video (nguoi_dung_id, tieu_de, duong_dan_video, duong_dan_anh_bia, thoi_luong, luot_xem, ngay_tao, ngay_cap_nhat) " +
  "OUTPUT INSERTED.video_id AS Id, INSERTED.tieu_de AS Title, INSERTED.duong_dan_video AS RelativeUrl, INSERTED.ngay_tao AS UploadedAt " +
  "VALUES (1, @Title, @Path, @Path, 0, 0, GETDATE(), GETDATE())"
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

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${port}`);
});

