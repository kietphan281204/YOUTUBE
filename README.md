<<<<<<< HEAD
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

Mở trình duyệt tới `http://localhost:3000`.

## 4) Bảng SQL

Server sẽ tự tạo bảng nếu chưa có:

- `dbo.Video (Id, Title, FileName, RelativeUrl, UploadedAt)`

Bạn cũng có thể chạy script `database.sql` để tạo bảng thủ công.

=======
# youtubee
>>>>>>> 87407895e1210c588c5859bf2cbf0a53bdf43ae1
