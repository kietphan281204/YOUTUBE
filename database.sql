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
