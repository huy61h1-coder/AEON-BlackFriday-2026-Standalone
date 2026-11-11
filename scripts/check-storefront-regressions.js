const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  ['index.html', 'background: #fff !important;', 'Nền khung ảnh sản phẩm phải luôn màu trắng.'],
  ['server.js', 'background:#fff!important', 'Server phải khóa nền ảnh sản phẩm màu trắng.'],
  ['app.js', 'class="regular-price"', 'Giá thường gạch ngang phải được render.'],
  ['app.js', 'product-discount-badge', 'Phần trăm giảm giá phải được render ở thẻ sản phẩm.'],
  ['storefront-product-ux.css', '.regular-price', 'Thiếu định dạng giá thường.'],
  ['storefront-product-ux.css', '.product-discount-badge', 'Thiếu định dạng phần trăm giảm giá.'],
  ['data.js', 'inferAeonBrandFromProductName', 'Thiếu chức năng tự nhận diện thương hiệu.'],
  ['data.js', 'hydrateProductCommerceFields', 'Thiếu lớp khôi phục giá và thương hiệu từ danh mục cũ.'],
  ['data.js', "'giaKhuyenMai', 'giaKM'", 'Thiếu nhận diện các cột giá khuyến mãi khi nhập dữ liệu.'],
  ['product-import.js', 'nhan hieu', 'File nhập sản phẩm phải nhận diện cột Nhãn hiệu.'],
  ['server.js', 'aeon-product-tombstones', 'Thiếu khóa chống khôi phục sản phẩm đã xóa.']
  ,['app.js', "document.body.classList.toggle('admin-preview', authenticated)", 'Trang công khai không được bật lại giao diện quản trị cũ.']
  ,['app.js', "grid.classList.remove('storefront-admin-grid')", 'Lưới sản phẩm công khai không được quay lại bố cục quản trị.']
  ,['storefront-public-lock.css', 'body:not(.admin-preview) .storefront-product-admin-actions', 'Thiếu lớp khóa nút sửa/xóa trên trang công khai.']
  ,['netlify.toml', 'Netlify-CDN-Cache-Control = "no-store"', 'Netlify phải tắt cache HTML để không trộn giao diện cũ và mới.']
  ,['index.html', 'app.js?v=20261111-preserve-live-catalog-v89', 'App công khai phải dùng fingerprint giao diện mới.']
  ,['index.html', 'id="public-storefront-critical-lock"', 'HTML phải có khóa giao diện công khai nội tuyến để chống tài nguyên cache cũ.']
  ,['admin.js', "assetPanel(panel, {logo: true, hero: false});", 'Logo phải được quản lý riêng cùng danh mục sản phẩm.']
  ,['admin.js', "await saveShared('aeon-layout', {...layout, ...values});", 'Lưu giao diện phải chỉ ghi khóa bố cục, không ghi danh mục sản phẩm.']
  ,['data.js', "heroDisplayMode: 'image-only'", 'Fallback giao diện không được quay lại bố cục hero cũ.']
  ,['data.js', "pageBackgroundColor: '#080808'", 'Fallback giao diện phải giữ nền BlackFriday.']
  ,['data.js', "productColumns: 5", 'Fallback giao diện phải giữ bố cục 5 cột mới.']
];

const failures = checks.filter(([file, marker]) => !read(file).includes(marker));
if (failures.length) {
  failures.forEach(([, , message]) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Storefront regression locks: OK');

