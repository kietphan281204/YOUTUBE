-- VIDEO1 — seed user tối thiểu cho dbo.nguoi_dung (tránh lỗi FK khi đăng video)
-- Nếu [seed] trong terminal báo "Không tự thêm được user", làm theo BƯỚC A rồi BƯỚC B.

USE VIDEO1;
GO

-- ========== BƯỚC A: Xem tên cột thật (chạy trước, đọc kết quả) ==========
SELECT
  c.name AS column_name,
  TYPE_NAME(c.user_type_id) AS data_type,
  c.is_nullable,
  c.is_identity
FROM sys.columns c
WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_dung')
ORDER BY c.column_id;
GO

-- Hoặc mở trình duyệt khi server đang chạy (sau khi đã Ctrl+C rồi npm.cmd run dev lại):
--   http://localhost:8080/api/nguoi-dung-columns
-- hoặc: http://localhost:8080/api/db/nguoi-dung-columns

-- ========== BƯỚC B: INSERT — sửa tên cột trong ngoặc () cho khớp BƯỚC A ==========
-- Ví dụ: nếu bảng có tai_khoan thay vì ten_dang_nhap, đổi trong INSERT.
-- Chỉ điền các cột NOT NULL (trừ identity); cột cho phép NULL có thể bỏ.

-- Schema VIDEO1 thật: ten_dang_nhap, email, mat_khau_hash, anh_dai_dien (nullable), ngay_tao, ngay_cap_nhat
IF NOT EXISTS (SELECT 1 FROM dbo.nguoi_dung)
BEGIN
  INSERT INTO dbo.nguoi_dung (ten_dang_nhap, email, mat_khau_hash, anh_dai_dien, ngay_tao, ngay_cap_nhat)
  VALUES (N'demo_upload', N'demo@local.test', N'demo_sha256_placeholder', NULL, GETDATE(), GETDATE());
END
GO

-- Bảng bình luận (liên kết video + người dùng). Chạy 1 lần trong SSMS nếu chưa có bảng.
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.binh_luan') AND type in (N'U'))
BEGIN
  CREATE TABLE dbo.binh_luan (
    binh_luan_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    video_id INT NOT NULL,
    nguoi_dung_id INT NOT NULL,
    noi_dung NVARCHAR(1000) NOT NULL,
    ngay_tao DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_binh_luan_video FOREIGN KEY (video_id) REFERENCES dbo.video(video_id),
    CONSTRAINT FK_binh_luan_nguoi_dung FOREIGN KEY (nguoi_dung_id) REFERENCES dbo.nguoi_dung(nguoi_dung_id)
  );
END
GO

-- Bảng lượt thích video
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.luot_thich') AND type in (N'U'))
BEGIN
  CREATE TABLE dbo.luot_thich (
    luot_thich_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    video_id INT NOT NULL,
    nguoi_dung_id INT NOT NULL,
    ngay_tao DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_luot_thich UNIQUE (video_id, nguoi_dung_id),
    CONSTRAINT FK_luot_thich_video FOREIGN KEY (video_id) REFERENCES dbo.video(video_id),
    CONSTRAINT FK_luot_thich_nguoi_dung FOREIGN KEY (nguoi_dung_id) REFERENCES dbo.nguoi_dung(nguoi_dung_id)
  );
END
GO

-- Thêm luot_xem vào dbo.nguoi_xem (đếm số lần xem theo người xem)
IF COL_LENGTH('dbo.nguoi_xem', 'luot_xem') IS NULL
BEGIN
  ALTER TABLE dbo.nguoi_xem
  ADD luot_xem INT NOT NULL CONSTRAINT DF_nguoi_xem_luot_xem DEFAULT (0);
END
GO

-- ========== Tuỳ chọn: bảng snapshot "video xu hướng" ==========
-- API GET /api/videos/trending hiện **tính trực tiếp** từ video + luot_thich + binh_luan (không bắt buộc bảng này).
-- Bạn có thể dùng bảng này để: báo cáo, job đồng bộ định kỳ, hoặc hiển thị nhanh sau khi MERGE.
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.video_xu_huong') AND type in (N'U'))
BEGIN
  CREATE TABLE dbo.video_xu_huong (
    video_id INT NOT NULL PRIMARY KEY,
    so_like INT NOT NULL,
    so_binh_luan INT NOT NULL,
    luot_xem BIGINT NOT NULL,
    ngay_vao DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_video_xu_huong_video FOREIGN KEY (video_id) REFERENCES dbo.video(video_id) ON DELETE CASCADE
  );
END
GO

-- ========== BẢNG THẬT: TÍNH NĂNG LỊCH SỬ ĐĂNG VIDEO CỦA NGƯỜI DÙNG ==========
-- Xoá View cũ nếu bạn đã lỡ tạo trước đó
IF EXISTS (SELECT * FROM sys.views WHERE object_id = OBJECT_ID(N'dbo.lich_su_dang_video'))
BEGIN
  DROP VIEW dbo.lich_su_dang_video;
END
GO

-- 1. Tạo Bảng Thật
IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'dbo.lich_su_dang_video'))
BEGIN
  CREATE TABLE dbo.lich_su_dang_video (
      id INT IDENTITY(1,1) PRIMARY KEY,
      video_id INT,
      nguoi_dung_id INT,
      tieu_de NVARCHAR(255),
      mo_ta NVARCHAR(MAX),
      video_url NVARCHAR(MAX),
      luot_xem BIGINT DEFAULT 0,
      thoi_gian_dang DATETIME DEFAULT GETDATE(),
      CONSTRAINT FK_history_video FOREIGN KEY (video_id) REFERENCES dbo.video(video_id) ON DELETE CASCADE
  );
END
GO

-- 2. Chép toàn bộ video cũ đang có sẵn sang bảng lịch sử (để xem lại được ngay)
INSERT INTO dbo.lich_su_dang_video (video_id, nguoi_dung_id, tieu_de, mo_ta, video_url, luot_xem, thoi_gian_dang)
SELECT video_id, nguoi_dung_id, tieu_de, mo_ta, duong_dan_video, luot_xem, ngay_tao
FROM dbo.video
WHERE video_id NOT IN (SELECT video_id FROM dbo.lich_su_dang_video);
GO

-- 3. Tạo Trigger: Mỗi khi ai đó đăng Video mới vào bảng dbo.video, tự động copy 1 dòng vào bảng dbo.lich_su_dang_video
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_ThemLichSuVideo')
BEGIN
  EXEC(N'
  CREATE TRIGGER trg_ThemLichSuVideo
  ON dbo.video
  AFTER INSERT
  AS
  BEGIN
      INSERT INTO dbo.lich_su_dang_video (video_id, nguoi_dung_id, tieu_de, mo_ta, video_url, luot_xem, thoi_gian_dang)
      SELECT video_id, nguoi_dung_id, tieu_de, mo_ta, duong_dan_video, luot_xem, ngay_tao
      FROM INSERTED;
  END
  ');
END
GO
