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

-- ========== BẢNG / VIEW THẬT: TÍNH NĂNG TRENDING TỰ ĐỘNG BẰNG SQL ==========
-- 1. Nếu trước đây lỡ tạo table, ta DROP đi để chuyển thành VIEW
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.video_xu_huong') AND type in (N'U'))
BEGIN
  DROP TABLE dbo.video_xu_huong;
END
GO

-- 2. Xoá VIEW cũ nếu đã có
IF EXISTS (SELECT * FROM sys.views WHERE object_id = OBJECT_ID(N'dbo.video_xu_huong'))
BEGIN
  DROP VIEW dbo.video_xu_huong;
END
GO

-- 3. Tạo thuật toán tự động tính toán trực tiếp điểm xu hướng
CREATE VIEW dbo.video_xu_huong AS
SELECT 
    v.video_id,
    v.tieu_de,
    v.mo_ta,
    v.duong_dan_video,
    v.ngay_tao,
    ISNULL(v.luot_xem, 0) AS luot_xem,
    ISNULL(lc.cnt, 0) AS so_like,
    ISNULL(cc.cnt, 0) AS so_binh_luan,
    -- Điểm xu hướng: 1 lượt xem = 1 điểm, 1 thích = 5 điểm, 1 bình luận = 10 điểm
    (ISNULL(v.luot_xem, 0) * 1 + ISNULL(lc.cnt, 0) * 5 + ISNULL(cc.cnt, 0) * 10) AS diem_xu_huong
FROM dbo.video v
LEFT JOIN (SELECT video_id, COUNT(*) AS cnt FROM dbo.luot_thich GROUP BY video_id) lc 
  ON lc.video_id = v.video_id
LEFT JOIN (SELECT video_id, COUNT(*) AS cnt FROM dbo.binh_luan GROUP BY video_id) cc 
  ON cc.video_id = v.video_id
WHERE (ISNULL(v.luot_xem, 0) * 1 + ISNULL(lc.cnt, 0) * 5 + ISNULL(cc.cnt, 0) * 10) >= 50;
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

-- ========== DANH MỤC & THE TAG ==========
-- Bảng Danh Mục
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.danh_muc') AND type in (N'U'))
BEGIN
  CREATE TABLE dbo.danh_muc (
    danh_muc_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ten_danh_muc NVARCHAR(255) NOT NULL
  );
END
GO

-- Bảng Thẻ Tag
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.the_tag') AND type in (N'U'))
BEGIN
  CREATE TABLE dbo.the_tag (
    tag_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    danh_muc_id INT NULL,
    ten_tag NVARCHAR(255) NOT NULL,
    CONSTRAINT FK_the_tag_danh_muc FOREIGN KEY (danh_muc_id) REFERENCES dbo.danh_muc(danh_muc_id)
  );
END
GO

-- Insert Dữ Liệu
IF NOT EXISTS (SELECT 1 FROM dbo.danh_muc)
BEGIN
  -- Insert Danh Muc
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Giải trí'); -- 1
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Âm nhạc & sáng tạo'); -- 2
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Gaming'); -- 3
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Giáo dục & kiến thức'); -- 4
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Làm đẹp & thời trang'); -- 5
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Ẩm thực'); -- 6
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Du lịch & trải nghiệm'); -- 7
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Lifestyle (đời sống)'); -- 8
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Thể thao & sức khỏe'); -- 9
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Review & kiếm tiền'); -- 10
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'DIY & sáng tạo'); -- 11
  INSERT INTO dbo.danh_muc (ten_danh_muc) VALUES (N'Tin tức & xã hội'); -- 12

  DECLARE @Cat1 INT, @Cat2 INT, @Cat3 INT, @Cat4 INT, @Cat5 INT, @Cat6 INT;
  DECLARE @Cat7 INT, @Cat8 INT, @Cat9 INT, @Cat10 INT, @Cat11 INT, @Cat12 INT;

  SELECT @Cat1 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Giải trí';
  SELECT @Cat2 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Âm nhạc & sáng tạo';
  SELECT @Cat3 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Gaming';
  SELECT @Cat4 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Giáo dục & kiến thức';
  SELECT @Cat5 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Làm đẹp & thời trang';
  SELECT @Cat6 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Ẩm thực';
  SELECT @Cat7 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Du lịch & trải nghiệm';
  SELECT @Cat8 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Lifestyle (đời sống)';
  SELECT @Cat9 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Thể thao & sức khỏe';
  SELECT @Cat10 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Review & kiếm tiền';
  SELECT @Cat11 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'DIY & sáng tạo';
  SELECT @Cat12 = danh_muc_id FROM dbo.danh_muc WHERE ten_danh_muc = N'Tin tức & xã hội';

  -- 1. Giải trí
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat1, N'#haihuoc'), (@Cat1, N'#meme'), (@Cat1, N'#funny'), (@Cat1, N'#trend'), (@Cat1, N'#viral'), 
  (@Cat1, N'#storytime'), (@Cat1, N'#drama'), (@Cat1, N'#parody'), (@Cat1, N'#reaction'), (@Cat1, N'#troll'), 
  (@Cat1, N'#prank'), (@Cat1, N'#shortfilm'), (@Cat1, N'#giaitri'), (@Cat1, N'#cliphai'), (@Cat1, N'#noidunghay');

  -- 2. Âm nhạc & sáng tạo
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat2, N'#amnhac'), (@Cat2, N'#music'), (@Cat2, N'#cover'), (@Cat2, N'#remix'), (@Cat2, N'#dance'), 
  (@Cat2, N'#nhay'), (@Cat2, N'#lipsync'), (@Cat2, N'#trendmusic'), (@Cat2, N'#beat'), (@Cat2, N'#sangtac'), 
  (@Cat2, N'#dj'), (@Cat2, N'#karaoke'), (@Cat2, N'#lofi'), (@Cat2, N'#nhachay'), (@Cat2, N'#mv');

  -- 3. Gaming
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat3, N'#gaming'), (@Cat3, N'#game'), (@Cat3, N'#gameplay'), (@Cat3, N'#stream'), (@Cat3, N'#livestream'), 
  (@Cat3, N'#highlight'), (@Cat3, N'#funnygame'), (@Cat3, N'#reviewgame'), (@Cat3, N'#mobilegame'), (@Cat3, N'#pcgame'), 
  (@Cat3, N'#freefire'), (@Cat3, N'#pubg'), (@Cat3, N'#lienquan'), (@Cat3, N'#minecraft'), (@Cat3, N'#fifa');

  -- 4. Giáo dục & kiến thức
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat4, N'#giaoduc'), (@Cat4, N'#hoctap'), (@Cat4, N'#learning'), (@Cat4, N'#tienganh'), (@Cat4, N'#hoctienganh'), 
  (@Cat4, N'#kienthuc'), (@Cat4, N'#khoahoc'), (@Cat4, N'#congnghe'), (@Cat4, N'#fact'), (@Cat4, N'#lifehack'), 
  (@Cat4, N'#tips'), (@Cat4, N'#study'), (@Cat4, N'#studytips'), (@Cat4, N'#education'), (@Cat4, N'#dayhoc');

  -- 5. Làm đẹp & thời trang
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat5, N'#lamdep'), (@Cat5, N'#beauty'), (@Cat5, N'#makeup'), (@Cat5, N'#skincare'), (@Cat5, N'#thoitrang'), 
  (@Cat5, N'#fashion'), (@Cat5, N'#outfit'), (@Cat5, N'#ootd'), (@Cat5, N'#reviewmypham'), (@Cat5, N'#trangdiem'), 
  (@Cat5, N'#duongda'), (@Cat5, N'#style'), (@Cat5, N'#makeuptutorial'), (@Cat5, N'#fashionstyle');

  -- 6. Ẩm thực
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat6, N'#amthuc'), (@Cat6, N'#food'), (@Cat6, N'#anuong'), (@Cat6, N'#reviewdoan'), (@Cat6, N'#monngon'), 
  (@Cat6, N'#nauan'), (@Cat6, N'#cooking'), (@Cat6, N'#streetfood'), (@Cat6, N'#mukbang'), (@Cat6, N'#foodreview'), 
  (@Cat6, N'#anvat'), (@Cat6, N'#doanvietnam'), (@Cat6, N'#delicious'), (@Cat6, N'#foodvlog');

  -- 7. Du lịch & trải nghiệm
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat7, N'#dulich'), (@Cat7, N'#travel'), (@Cat7, N'#vlogdulich'), (@Cat7, N'#khampha'), (@Cat7, N'#checkin'), 
  (@Cat7, N'#reviewdulich'), (@Cat7, N'#phuot'), (@Cat7, N'#travelvlog'), (@Cat7, N'#diadiemdep'), (@Cat7, N'#vanhoa'), 
  (@Cat7, N'#trai_nghiem'), (@Cat7, N'#explore'), (@Cat7, N'#trip');

  -- 8. Lifestyle (đời sống)
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat8, N'#lifestyle'), (@Cat8, N'#cuocsong'), (@Cat8, N'#vlog'), (@Cat8, N'#dailyvlog'), (@Cat8, N'#routine'), 
  (@Cat8, N'#selfcare'), (@Cat8, N'#songtichcuc'), (@Cat8, N'#minimalism'), (@Cat8, N'#habits'), (@Cat8, N'#motngay'), 
  (@Cat8, N'#tam_su'), (@Cat8, N'#life'), (@Cat8, N'#dayinmylife');

  -- 9. Thể thao & sức khỏe
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat9, N'#thethao'), (@Cat9, N'#fitness'), (@Cat9, N'#gym'), (@Cat9, N'#workout'), (@Cat9, N'#yoga'), 
  (@Cat9, N'#health'), (@Cat9, N'#suckhoe'), (@Cat9, N'#giamcan'), (@Cat9, N'#tangcan'), (@Cat9, N'#cardio'), 
  (@Cat9, N'#tapluyen'), (@Cat9, N'#bodybuilding'), (@Cat9, N'#fit'), (@Cat9, N'#healthy');

  -- 10. Review & kiếm tiền
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat10, N'#review'), (@Cat10, N'#unboxing'), (@Cat10, N'#danhgia'), (@Cat10, N'#kiem_tien'), (@Cat10, N'#makemoney'), 
  (@Cat10, N'#kinhdoanh'), (@Cat10, N'#onlinebusiness'), (@Cat10, N'#affiliate'), (@Cat10, N'#banhang'), (@Cat10, N'#dropshipping'), 
  (@Cat10, N'#startup'), (@Cat10, N'#marketing');

  -- 11. DIY & sáng tạo
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat11, N'#diy'), (@Cat11, N'#handmade'), (@Cat11, N'#thucong'), (@Cat11, N'#sangtao'), (@Cat11, N'#decor'), 
  (@Cat11, N'#trangtri'), (@Cat11, N'#craft'), (@Cat11, N'#hack'), (@Cat11, N'#meovat'), (@Cat11, N'#y_tuong'), 
  (@Cat11, N'#creative'), (@Cat11, N'#design'), (@Cat11, N'#lamdo');

  -- 12. Tin tức & xã hội
  INSERT INTO dbo.the_tag (danh_muc_id, ten_tag) VALUES 
  (@Cat12, N'#tintuc'), (@Cat12, N'#news'), (@Cat12, N'#drama'), (@Cat12, N'#xahoi'), (@Cat12, N'#trend'), 
  (@Cat12, N'#sukien'), (@Cat12, N'#viral'), (@Cat12, N'#hot'), (@Cat12, N'#capnhat'), (@Cat12, N'#tinnhanh'), 
  (@Cat12, N'#thoisu'), (@Cat12, N'#phantich'), (@Cat12, N'#tinnong');
END
GO

-- ========== VIEW TÌM KIẾM VIDEO ==========
IF OBJECT_ID('dbo.vw_tim_kiem_video', 'V') IS NOT NULL
  DROP VIEW dbo.vw_tim_kiem_video;
GO

CREATE VIEW dbo.vw_tim_kiem_video
AS
SELECT 
    v.video_id AS Id, 
    v.tieu_de AS Title, 
    v.mo_ta AS Description, 
    v.duong_dan_video AS RelativeUrl, 
    v.ngay_tao AS UploadedAt,
    v.danh_muc_id AS CategoryId,
    u.ten_dang_nhap AS UploaderName,
    d.ten_danh_muc AS CategoryName
FROM dbo.video v
LEFT JOIN dbo.nguoi_dung u ON v.nguoi_dung_id = u.nguoi_dung_id
LEFT JOIN dbo.danh_muc d ON v.danh_muc_id = d.danh_muc_id;
GO

-- ========== BẢNG THỐNG KÊ CHI TIẾT THEO NGÀY ==========
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.thong_ke') AND type in (N'U'))
BEGIN
  CREATE TABLE dbo.thong_ke (
    thong_ke_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    nguoi_dung_id INT NOT NULL,
    ngay DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    so_luot_xem INT DEFAULT 0,
    so_luot_thich INT DEFAULT 0,
    so_binh_luan INT DEFAULT 0,
    ngay_cap_nhat DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_thong_ke_nguoi_dung FOREIGN KEY (nguoi_dung_id) REFERENCES dbo.nguoi_dung(nguoi_dung_id),
    CONSTRAINT UQ_thong_ke_ngay UNIQUE (nguoi_dung_id, ngay)
  );
END
GO
