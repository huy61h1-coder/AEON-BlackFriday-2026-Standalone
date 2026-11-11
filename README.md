# AEON Black Friday 2026

Ứng dụng danh mục, báo giá và đặt hàng dành cho AEON Black Friday 2026. Khi deploy lên Vibe Host, phiên bản mới lấy danh mục sản phẩm và cài đặt giao diện từ phiên bản đang chạy trước khi nhận truy cập.

## Chức năng

- Danh mục sản phẩm, thương hiệu, biến thể và giỏ hàng.
- Giao diện responsive cho desktop và mobile.
- Tùy chỉnh logo, màu sắc, kích thước và nội dung trang chủ.
- Nhập sản phẩm từ Excel/PDF và tải file báo giá Excel/PDF.
- Quản lý khách hàng, đơn hàng và xuất Excel tổng hợp.
- Tạo PDF A4 riêng cho từng đơn hàng.
- Kết nối Outlook bằng Microsoft OAuth để quản trị viên xác nhận đơn và gửi email chi tiết cho khách.
- Đồng bộ đơn hàng sang Google Sheet qua Apps Script.
- Tài khoản quản trị chính có thể tạo tài khoản con, tạm khóa và cấp quyền theo từng chức năng.

## Khởi chạy

Yêu cầu Node.js 20 trở lên.

```bash
npm install
$env:ADMIN_USERNAME='admin'
$env:ADMIN_PASSWORD='thay-mat-khau-manh'
npm start
```

Mở website tại `http://127.0.0.1:8080/` và trang quản trị tại
`http://127.0.0.1:8080/admin.html`.

Để truy cập từ thiết bị khác cùng mạng, dùng địa chỉ IP LAN của máy chạy ứng
dụng, ví dụ `http://192.168.1.64:8080/`.

## Triển khai có quản trị

Chạy ứng dụng bằng Node.js (`npm install`, sau đó `npm start`). Khi một bản Vibe Host mới không có tệp dữ liệu của bản trước, máy chủ lấy danh mục và cài đặt công khai từ `https://blackfriday.tinhgon.xyz/api/state`, ghi vào tệp runtime mới, rồi mới mở cổng phục vụ. Danh mục đã thêm, sửa hoặc xóa trên bản đang chạy được giữ nguyên, không phụ thuộc số lượng sản phẩm. Nếu website cũ không truy cập được, bản mới dừng khởi động thay vì hiện danh mục mẫu trong mã nguồn. Có thể đổi URL nguồn bằng `AEON_BOOTSTRAP_PUBLIC_URL`; không cần tạo database.

Cơ chế này giữ **danh mục, banner, logo và cài đặt giao diện công khai** qua lần thay bản khi Vibe Host còn phục vụ phiên bản cũ trong lúc bản mới khởi động. Dữ liệu riêng như khách hàng, đơn hàng, tài khoản phụ, file tải trực tiếp lên máy chủ và phiên Outlook cần ổ lưu trữ bền vững nếu muốn giữ qua mọi lần deploy. Nếu Vibe Host thay bản cũ trước khi bản mới đọc được URL, bản mới sẽ dừng và có thể rollback; không tự thay danh mục bằng dữ liệu cũ.

Nếu có volume bền vững, đặt `AEON_DATA_DIR` ngoài thư mục release để giữ toàn bộ tệp runtime. Nếu đang dùng Supabase, ứng dụng vẫn hỗ trợ đồng bộ qua bảng `aeon_state`. Đặt `ADMIN_USERNAME`, `ADMIN_PASSWORD` và `AEON_LOCK_STOREFRONT=true` trên máy chủ. `netlify.toml` chỉ phát hành file tĩnh và hàm nhập Excel nên không cung cấp đầy đủ API quản trị.

Với yêu cầu **không dùng database cho danh mục**, giữ `AEON_STATE_STORAGE=local` (mặc định). Có thể cấu hình `SUPABASE_URL` và `SUPABASE_SECRET_KEY` riêng cho `AEON_OUTLOOK_STORAGE=supabase`; việc này không tự chuyển danh mục sang Supabase. Chỉ đặt `AEON_STATE_STORAGE=supabase` nếu muốn dùng bảng `aeon_state` để lưu danh mục.
## Cấu hình

Máy chủ hỗ trợ các biến môi trường:

- `HOST`: địa chỉ lắng nghe, mặc định `0.0.0.0`.
- `PORT`: cổng chạy ứng dụng, mặc định `8080`.
- `ADMIN_USERNAME`: tài khoản đăng nhập trang quản trị, bắt buộc.
- `ADMIN_PASSWORD`: mật khẩu quản trị, bắt buộc.
- `AEON_BOOTSTRAP_PUBLIC_URL`: URL của `/api/state` trên website đang chạy; mặc định là `https://blackfriday.tinhgon.xyz/api/state`. Dùng khi bản mới chưa có tệp runtime.
- `AEON_ALLOW_SAMPLE_DATA`: chỉ đặt `true` để xem thử dữ liệu mẫu ở máy cá nhân khi không có website đang chạy. Không bật trên Vibe Host.
- `AEON_STATE_STORAGE`: mặc định `local` để giữ danh mục theo bản đang chạy; đặt `supabase` chỉ khi muốn đồng bộ danh mục vào bảng `aeon_state`.
- `AEON_DATA_DIR`: đường dẫn tuyệt đối đến thư mục/volume bền vững, nằm ngoài thư mục release. Giữ nguyên giá trị này qua các lần deploy để bảo toàn danh mục, cài đặt, ảnh và file đã tải lên.
- `AEON_LOCK_STOREFRONT`: đặt `true` trên máy chủ production để dùng giao diện Black Friday làm mặc định cho trường còn thiếu; các giá trị đã lưu vẫn được ưu tiên bất kể phiên bản.
- `SUPABASE_URL` và `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` hoặc `SUPABASE_ANON_KEY`: nếu cấu hình bảng `aeon_state`, ứng dụng đồng bộ danh mục và cài đặt lên Supabase để giữ qua các lần deploy. Khóa secret chỉ đặt trên máy chủ.
- `GOOGLE_SHEET_WEB_APP_URL`: URL Web App của Google Apps Script, bắt buộc
  nếu dùng chức năng đồng bộ đơn hàng.
- `MICROSOFT_CLIENT_ID`: ID ứng dụng Microsoft Entra đăng ký cho web.
- `MICROSOFT_CLIENT_SECRET`: giá trị secret của ứng dụng; chỉ đặt ở môi trường máy chủ.
- `MICROSOFT_TENANT_ID`: tenant Microsoft 365; mặc định `common` để cho phép chọn tài khoản Microsoft.
- `MICROSOFT_REDIRECT_URI`: URL callback đã đăng ký trong Entra, ví dụ
  `https://blackfriday.tinhgon.xyz/api/admin/outlook/callback`.
- `AEON_OUTLOOK_TOKEN_KEY`: khóa ngẫu nhiên dài tối thiểu 32 ký tự để mã hóa token Outlook đã cấp.
- `AEON_OUTLOOK_STORAGE`: đặt `supabase` trên bản deploy để giữ kết nối sau khi khởi động lại; đặt `file` khi chạy local hoặc có ổ đĩa bền vững.
- `SUPABASE_SECRET_KEY`: khóa secret Supabase mới, chỉ đặt trên máy chủ khi `AEON_OUTLOOK_STORAGE=supabase`. Có thể dùng `SUPABASE_SERVICE_ROLE_KEY` cũ nếu dự án chưa tạo khóa mới. Không dùng khóa `anon` và không đưa khóa bí mật vào `supabase-config.js`.

Ví dụ trên PowerShell:

```powershell
$env:ADMIN_USERNAME='ten-quan-tri'
$env:ADMIN_PASSWORD='mat-khau-manh'
$env:AEON_LOCK_STOREFRONT='true'
$env:AEON_DATA_DIR='C:\persistent\aeon-blackfriday'
$env:GOOGLE_SHEET_WEB_APP_URL='https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
# Chỉ cấu hình các giá trị OAuth này ở môi trường máy chủ, không ghi vào mã nguồn.
$env:MICROSOFT_CLIENT_ID='APPLICATION_CLIENT_ID'
$env:MICROSOFT_CLIENT_SECRET='APPLICATION_CLIENT_SECRET_VALUE'
$env:MICROSOFT_TENANT_ID='common'
$env:MICROSOFT_REDIRECT_URI='https://blackfriday.tinhgon.xyz/api/admin/outlook/callback'
$env:AEON_OUTLOOK_TOKEN_KEY='REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'
$env:AEON_OUTLOOK_STORAGE='supabase'
$env:SUPABASE_URL='https://PROJECT_REF.supabase.co'
$env:SUPABASE_SECRET_KEY='sb_secret_KEY_FROM_PROJECT_SETTINGS'
npm start
```

Để bật email Outlook, tạo ứng dụng Microsoft Entra với loại tài khoản phù hợp,
thêm nền tảng **Web** và URI chuyển hướng đúng như `MICROSOFT_REDIRECT_URI`.
Cấp quyền ủy quyền Microsoft Graph `User.Read` và `Mail.Send`; luồng đăng nhập
cũng yêu cầu `offline_access` để gửi tự động sau lần kết nối đầu tiên. Dùng
secret ứng dụng ở biến môi trường máy chủ, không đưa secret vào giao diện web.
Tạo `AEON_OUTLOOK_TOKEN_KEY` ngẫu nhiên (ví dụ `node -e
"console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`)
và giữ nguyên khóa này khi cập nhật để máy chủ tiếp tục giải mã kết nối. Trước
khi kết nối Outlook trên bản deploy, áp dụng migration
`supabase/migrations/20261110000000_private_outlook_credentials.sql` trong
Supabase và đặt `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (hoặc
`SUPABASE_SERVICE_ROLE_KEY` cũ),
`AEON_OUTLOOK_STORAGE=supabase` trong biến môi trường máy chủ. Token được mã hóa
trước khi lưu vào bảng riêng; bảng này không cấp quyền đọc hoặc ghi cho trình
duyệt. Nếu trước đây đã kết nối Outlook trên ổ đĩa bền vững, máy chủ tự chuyển
tệp `.aeon-outlook.json` vào bảng khi đọc lần đầu. Khi dùng `file`, máy chủ vẫn
cần giữ tệp này sau mỗi lần triển khai.

Sau khi cấu hình và triển khai lại, đăng nhập bằng tài khoản quản trị chính,
mở **Khách hàng** rồi chọn **Kết nối Outlook**. Trong từng đơn, **Xác nhận &
gửi email** xác nhận đơn và gửi danh sách sản phẩm, số lượng, giá và tổng tiền
cho địa chỉ email khách hàng. Website ghi trạng thái gửi để tránh gửi trùng;
nếu kết nối bị ngắt giữa lúc gửi, hãy kiểm tra thư mục Sent Items trước khi gửi
lại.

Không ghi các giá trị thật vào mã nguồn hoặc commit tệp `.env`. Sau khi thay
đổi tài khoản/mật khẩu, hãy khởi động lại máy chủ để áp dụng.

## Tài khoản con và phân quyền

Đăng nhập bằng tài khoản khai báo qua `ADMIN_USERNAME` và `ADMIN_PASSWORD`,
sau đó vào **Tài khoản & phân quyền** để tạo tài khoản con. Có thể cấp từng
nhóm quyền: sản phẩm & giá, nội dung/giao diện/banner, file báo giá, thương
hiệu, hoặc khách hàng & đơn hàng. Chỉ tài khoản chính mới có thể tạo, sửa,
tạm khóa tài khoản và phân quyền; mật khẩu tài khoản con được lưu dạng băm.

Tệp `.aeon-store.seed.json` là dữ liệu mẫu cho môi trường local. Bản deploy
không dùng tệp này để thay danh mục đang bán và không tự đổi 73 thành 91 sản phẩm.
Dữ liệu khách hàng, đơn hàng, tài khoản con và tệp tải lên không nằm trong Git.
Để giữ các chỉnh sửa về sau, cần cấu hình `AEON_DATA_DIR` trên volume bền vững
hoặc Supabase trước khi deploy. Với ảnh/file tải lên bằng ứng dụng, cần giữ
`AEON_DATA_DIR`; đường dẫn ảnh ngoài (ví dụ Cloudinary) không phụ thuộc volume.

## Quy trình sử dụng nhanh

1. Mở `/admin.html` và đăng nhập bằng tài khoản đã khai báo trong biến môi trường.
2. Vào **Sản phẩm**, tải file Excel mẫu, điền dữ liệu rồi nhập lại; có thể xem trước và chọn ghi đè hoặc gộp danh mục.
3. Vào **Giao diện** để đổi banner, logo, màu sắc, kích thước và nội dung chương trình.
4. Vào **File báo giá** để tải lên Excel/PDF cho khách tải từ trang chủ.
5. Đơn hàng từ website được lưu vào mục **Khách hàng & đơn hàng**; tại đây có thể xuất Excel tổng hợp hoặc tải PDF cho từng đơn.
