# Đăng video + lưu SQL Server

## 1) Cài đặt

Mở terminal trong thư mục project và chạy:

```bash
npm i
```

## 2) Cấu hình SQL Server

File cấu hình là `.env`.

Mặc định project kết nối **local SQL Server qua port 1433**:

- `DB_SERVER=127.0.0.1`
- `DB_PORT=1433`
- `DB_DATABASE=master` (bạn có thể đổi sang database riêng)
- `DB_USER=sa`
- `DB_PASSWORD=` (**bắt buộc điền đúng mật khẩu nếu SQL Server yêu cầu**)

Nếu bạn không dùng `sa`, đổi `DB_USER`/`DB_PASSWORD` theo user của bạn.

## 3) Chạy project

```bash
npm run dev
```

Mở trình duyệt tới `http://localhost:3000` (không mở file HTML trực tiếp / không dùng Live Server),
vì frontend gọi API tương đối như `/api/videos`.

## 5) Chạy online (GitHub Pages + backend + SQL)

GitHub Pages **không chạy được** `server.js` (Express + SQL), nên muốn chạy online thật bạn cần:

- **Deploy backend Node (`server.js`)** lên một host (Render/Railway/VPS/Azure App Service…)
- **Dùng SQL Server online** (khuyến nghị: Azure SQL Database)
- **Cấu hình frontend**: mở `config.js` và set:
  - `window.API_BASE = "https://<domain-backend>"` (không có `/` ở cuối)

### Biến môi trường backend cần có

- `PORT` (host thường tự cấp)
- `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`
- `FRONTEND_ORIGIN` (để CORS cho GitHub Pages), ví dụ:
  - `FRONTEND_ORIGIN=https://kiepthan281204.github.io`
  - (có thể thêm nhiều origin, phân tách bằng dấu phẩy)

### Lưu ý quan trọng

- File video sẽ được lưu trên máy chủ backend (thư mục `uploads/`). Nếu host “ephemeral disk” (mất dữ liệu khi restart),
  bạn cần chuyển sang object storage (S3/R2/Azure Blob) để lưu file bền vững.

## 4) Bảng SQL

Server sẽ tự tạo bảng nếu chưa có:

- `dbo.Video (Id, Title, FileName, RelativeUrl, UploadedAt)`

Bạn cũng có thể chạy script `database.sql` để tạo bảng thủ công.
