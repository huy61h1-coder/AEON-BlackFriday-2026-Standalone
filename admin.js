document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin.css?v=20261110-outlook-persistent-connection-v85'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-order-email.css?v=20261110-outlook-persistent-connection-v85'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-layout-controls.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-import.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-quick-products.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-quote-files.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-sheet-sync.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-order-pdf.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-accounts.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'product-variants.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-brands.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'scroll-actions.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-refinement.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-responsive.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-theme-sync.css?v=20261106-promo-fields'}));
document.body.append(Object.assign(document.createElement('script'), {src: 'scroll-actions.js'}));

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const money = value => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
let tab = 'dashboard';
const ADMIN_PERMISSION_LABELS = {
  products: 'Danh mục & logo',
  interface: 'Nội dung, giao diện & banner',
  quotes: 'File báo giá',
  brands: 'Thương hiệu',
  customers: 'Khách hàng & đơn hàng'
};
let adminSession = {authenticated:false, user:null};
let refreshOutlookMailStatus = null;

function hasAdminPermission(permission) {
  const user = adminSession?.user;
  return Boolean(user && (user.isOwner || Array.isArray(user.permissions) && user.permissions.includes(permission)));
}

function isOwnerAccount() {
  return Boolean(adminSession?.user?.isOwner);
}

function canOpenInterface() {
  return hasAdminPermission('interface') || hasAdminPermission('quotes') || hasAdminPermission('brands');
}

function canOpenTab(name) {
  if (name === 'dashboard' || name === 'products') return hasAdminPermission('products');
  if (name === 'interface') return canOpenInterface();
  if (name === 'customers') return hasAdminPermission('customers');
  if (name === 'accounts') return isOwnerAccount();
  return false;
}

function applyAdminNavigation() {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach(button => {
    const allowed = canOpenTab(button.dataset.tab);
    button.hidden = !allowed;
    button.classList.toggle('active', allowed && button.dataset.tab === tab);
  });
  if (!canOpenTab(tab)) tab = tabs.find(button => !button.hidden)?.dataset.tab || 'dashboard';
  tabs.forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
}

async function hydrateAdminState() {
  if (!hasAdminPermission('customers')) {
    localStorage.removeItem('aeon-customers');
    localStorage.removeItem('aeon-orders');
  }
  // The deployed UI is only the fallback. Always hydrate a current-revision
  // saved UI from the server so admin settings survive reloads and re-entry.
  // aeonStore.pull still rejects legacy UI revisions that could restore the
  // retired storefront.
  return aeonStore.pull();
}

function safeAdminThemeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function mixAdminThemeColor(first, second, amount = .5) {
  const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
  const from = safeAdminThemeColor(first, '#000000').slice(1);
  const to = safeAdminThemeColor(second, '#ffffff').slice(1);
  const parts = [0, 2, 4].map(index => Math.round(
    Number.parseInt(from.slice(index, index + 2), 16) * (1 - ratio)
    + Number.parseInt(to.slice(index, index + 2), 16) * ratio
  ).toString(16).padStart(2, '0'));
  return `#${parts.join('')}`;
}

function applyAdminTheme(nextLayout = aeonStore.layout()) {
  const layout = {...AEON_DEFAULT_LAYOUT, ...nextLayout};
  const accent = safeAdminThemeColor(layout.accentColor, AEON_DEFAULT_LAYOUT.accentColor);
  const accentDark = safeAdminThemeColor(layout.accentDarkColor, AEON_DEFAULT_LAYOUT.accentDarkColor);
  const page = safeAdminThemeColor(layout.pageBackgroundColor, AEON_DEFAULT_LAYOUT.pageBackgroundColor);
  const section = safeAdminThemeColor(layout.sectionBackgroundColor, AEON_DEFAULT_LAYOUT.sectionBackgroundColor);
  const text = safeAdminThemeColor(layout.textColor, AEON_DEFAULT_LAYOUT.textColor);
  const pageLuminance = (() => {
    const channels = [0, 2, 4].map(index => Number.parseInt(page.slice(1).slice(index, index + 2), 16) / 255)
      .map(component => component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  })();
  const darkTheme = pageLuminance < .22;
  const surface = darkTheme ? mixAdminThemeColor(page, section, .52) : mixAdminThemeColor(page, '#ffffff', .78);
  const mutedSurface = darkTheme ? mixAdminThemeColor(surface, '#ffffff', .07) : mixAdminThemeColor(section, '#ffffff', .56);
  const mutedText = darkTheme ? mixAdminThemeColor(text, surface, .38) : mixAdminThemeColor(text, page, .43);
  const line = darkTheme ? mixAdminThemeColor(text, surface, .20) : mixAdminThemeColor(section, text, .15);
  const accentSoft = darkTheme ? mixAdminThemeColor(accent, surface, .78) : mixAdminThemeColor(accent, '#ffffff', .9);
  const accentBorder = darkTheme ? mixAdminThemeColor(accent, surface, .43) : mixAdminThemeColor(accent, '#ffffff', .68);
  const root = document.documentElement;
  root.dataset.adminTheme = darkTheme ? 'dark' : 'light';
  root.style.colorScheme = darkTheme ? 'dark' : 'light';
  root.style.setProperty('--red', accent);
  root.style.setProperty('--wine', accentDark);
  root.style.setProperty('--cream', page);
  root.style.setProperty('--paper', section);
  root.style.setProperty('--ink', text);
  root.style.setProperty('--muted', mutedText);
  root.style.setProperty('--line', line);
  root.style.setProperty('--admin-dark-theme', darkTheme ? '1' : '0');
  root.style.setProperty('--admin-sidebar-deep', mixAdminThemeColor(accentDark, '#000000', .38));
  root.style.setProperty('--admin-page-tint', mixAdminThemeColor(page, section, .56));
  root.style.setProperty('--admin-surface', surface);
  root.style.setProperty('--admin-surface-muted', mutedSurface);
  root.style.setProperty('--admin-line', line);
  root.style.setProperty('--admin-accent-soft', accentSoft);
  root.style.setProperty('--admin-accent-border', accentBorder);
}

function normaliseImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return `/${url.replace(/^\.?\//, '')}`;
}

function normaliseProductImages(value, primaryImage = '') {
  const rawImages = (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(/[\r\n,]+/));
  const images = rawImages.map(normaliseImageUrl).filter(Boolean);
  const legacyImage = normaliseImageUrl(primaryImage);
  if (!images.length && legacyImage) images.push(legacyImage);
  else if (legacyImage && !images.includes(legacyImage)) images.push(legacyImage);
  return [...new Set(images)].slice(0, 12);
}

function normaliseGiftImageList(value) {
  const rawImages = (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(/[\r\n,]+/));
  return [...new Set(rawImages.map(normaliseImageUrl).filter(Boolean))].slice(0, 2);
}

function newProductVariantId() {
  return `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validAdminProductVariants(value) {
  return Array.isArray(value) ? value.filter(variant => String(variant?.name || '').trim()) : [];
}

function productInsertPositionOptions(items, selectedPosition = items.length) {
  if (!items.length) return '<option value="0" selected>1 — Vị trí đầu tiên</option>';
  return Array.from({length: items.length + 1}, (_, index) => {
    const label = index === 0
      ? '1 — Đầu danh sách'
      : index === items.length
        ? `${index + 1} — Cuối danh sách`
        : `${index + 1} — Sau “${items[index - 1].name || 'Sản phẩm chưa đặt tên'}”`;
    return `<option value="${index}"${index === selectedPosition ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function productVariantRowMarkup(variant = {}) {
  const id = String(variant.id || newProductVariantId());
  return `<div class="product-variant-row" data-variant-id="${escapeHtml(id)}">
    <label>Tên lựa chọn<input data-variant-name required value="${escapeHtml(variant.name || '')}" placeholder="Ví dụ: Hộp 4 bánh"></label>
    <label>Giá bán (VNĐ)<input data-variant-price type="number" min="0" inputmode="numeric" required value="${variant.price ?? ''}" placeholder="750000"></label>
    <label>Mã SKU<input data-variant-sku value="${escapeHtml(variant.sku || '')}" placeholder="AM-2026-04"></label>
    <label>Ảnh phân loại (URL)<input data-variant-image value="${escapeHtml(variant.image || '')}" placeholder="Để trống dùng ảnh chung"></label>
    <button type="button" class="remove-product-variant" data-remove-variant aria-label="Xóa lựa chọn này">×</button>
  </div>`;
}

function productVariantsFromEditor(list) {
  const rows = [...list.querySelectorAll('[data-variant-id]')];
  if (rows.length > 20) throw new Error('Mỗi sản phẩm tối đa 20 lựa chọn.');
  const names = new Set();
  const skus = new Set();
  return rows.map(row => {
    const name = String(row.querySelector('[data-variant-name]').value || '').trim().slice(0, 120);
    const price = Number(row.querySelector('[data-variant-price]').value);
    const sku = String(row.querySelector('[data-variant-sku]').value || '').trim().slice(0, 100);
    const image = normaliseImageUrl(row.querySelector('[data-variant-image]')?.value || '');
    if (!name || !Number.isFinite(price) || price < 0) throw new Error('Mỗi lựa chọn cần có tên và giá bán hợp lệ.');
    const nameKey = name.toLocaleLowerCase('vi-VN');
    const skuKey = sku.toLocaleLowerCase('vi-VN');
    if (names.has(nameKey)) throw new Error('Tên các lựa chọn không được trùng nhau.');
    if (sku && skus.has(skuKey)) throw new Error('Mã SKU của các lựa chọn không được trùng nhau.');
    names.add(nameKey);
    if (sku) skus.add(skuKey);
    return {id: row.dataset.variantId || newProductVariantId(), name, price: Math.round(price), sku, image};
  });
}

function bindProductVariantEditor(form) {
  const list = form.querySelector('[data-variant-rows]');
  const addButton = form.querySelector('[data-add-variant]');
  const priceInput = form.elements.price;
  const hint = form.querySelector('[data-variant-price-hint]');
  const originalPrice = priceInput.value;

  const syncPrice = () => {
    const rows = [...list.querySelectorAll('[data-variant-id]')];
    const prices = rows.map(row => Number(row.querySelector('[data-variant-price]').value));
    const hasVariants = rows.length > 0;
    priceInput.readOnly = hasVariants;
    priceInput.classList.toggle('derived-price', hasVariants);
    if (!hasVariants) {
      priceInput.value = originalPrice;
      hint.textContent = 'Dùng giá chung khi sản phẩm không có lựa chọn.';
      return;
    }
    const validPrices = prices.filter(price => Number.isFinite(price) && price >= 0);
    priceInput.value = validPrices.length === prices.length ? Math.min(...validPrices) : '';
    hint.textContent = `Giá từ được lấy tự động theo ${rows.length} lựa chọn.`;
  };

  const bindRow = row => {
    row.querySelector('[data-remove-variant]').onclick = () => {
      row.remove();
      syncPrice();
    };
    row.querySelectorAll('input').forEach(input => input.addEventListener('input', syncPrice));
  };
  list.querySelectorAll('[data-variant-id]').forEach(bindRow);
  addButton.onclick = () => {
    if (list.querySelectorAll('[data-variant-id]').length >= 20) {
      toastAdmin('Mỗi sản phẩm tối đa 20 lựa chọn.');
      return;
    }
    list.insertAdjacentHTML('beforeend', productVariantRowMarkup());
    const row = list.lastElementChild;
    bindRow(row);
    syncPrice();
    row.querySelector('[data-variant-name]').focus();
  };
  syncPrice();
  return () => productVariantsFromEditor(list);
}

function setPreview(target, value, emptyText = 'Chưa chọn ảnh banner') {
  const preview = typeof target === 'string' ? $(target) : target;
  if (!preview) return;

  const url = normaliseImageUrl(value);
  preview.replaceChildren();
  if (!url) {
    preview.classList.add('is-empty');
    preview.textContent = emptyText;
    return;
  }

  preview.classList.remove('is-empty');
  const image = new Image();
  image.alt = 'Xem trước ảnh đã chọn';
  image.src = url;
  image.addEventListener('error', () => {
    preview.classList.add('is-empty');
    preview.textContent = 'Không tải được ảnh. Hãy kiểm tra lại đường dẫn.';
  }, {once: true});
  preview.append(image);
}

function setBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

const officialImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

function officialImageMimeType(file) {
  const declaredType = String(file?.type || '').toLowerCase();
  if (officialImageMimeTypes.has(declaredType)) return declaredType;
  const filename = String(file?.name || '').toLowerCase();
  if (/\.svg$/.test(filename)) return 'image/svg+xml';
  if (/\.png$/.test(filename)) return 'image/png';
  if (/\.jpe?g$/.test(filename)) return 'image/jpeg';
  if (/\.webp$/.test(filename)) return 'image/webp';
  if (/\.gif$/.test(filename)) return 'image/gif';
  return '';
}

function readOfficialImageAsDataUrl(file, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('Không thể đọc tệp ảnh.'));
      resolve('data:' + mimeType + ';base64,' + result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}

async function uploadOfficialImage(file) {
  if (!file) return null;
  const mimeType = officialImageMimeType(file);
  if (!mimeType) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG, WEBP, GIF hoặc SVG.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');

  const dataUrl = await readOfficialImageAsDataUrl(file, mimeType);
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể tải ảnh lên.');
  return normaliseImageUrl(result.url);
}

function normaliseQuoteFileUrl(value, kind) {
  const url = normaliseImageUrl(value);
  if (!url) return '';
  let pathname = '';
  try {
    pathname = new URL(url, location.origin).pathname.toLowerCase();
  } catch {
    throw new Error('Đường dẫn tệp báo giá không hợp lệ.');
  }
  const matches = kind === 'pdf' ? pathname.endsWith('.pdf') : /\.(xlsx|xls)$/.test(pathname);
  if (!matches) throw new Error(kind === 'pdf' ? 'Tệp PDF phải có đuôi .pdf.' : 'Tệp Excel phải có đuôi .xlsx hoặc .xls.');
  return url;
}

function quoteFileKind(file) {
  const filename = String(file?.name || '').toLowerCase();
  if (filename.endsWith('.pdf')) return 'pdf';
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return 'excel';
  return '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp báo giá.'));
    reader.readAsDataURL(file);
  });
}

async function uploadQuoteFile(file, expectedKind) {
  if (!file) throw new Error(expectedKind === 'pdf' ? 'Hãy chọn tệp PDF trước.' : 'Hãy chọn tệp Excel trước.');
  const kind = quoteFileKind(file);
  if (kind !== expectedKind) throw new Error(expectedKind === 'pdf' ? 'Chỉ chấp nhận tệp PDF (.pdf).' : 'Chỉ chấp nhận tệp Excel (.xlsx, .xls).');
  if (file.size > 20 * 1024 * 1024) throw new Error('Tệp báo giá phải nhỏ hơn hoặc bằng 20 MB.');

  const response = await fetch('/api/upload-quote', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl: await readFileAsDataUrl(file)})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể tải tệp báo giá lên.');
  return normaliseQuoteFileUrl(result.url, expectedKind);
}

async function saveQuoteFiles(patch = {}) {
  const latestUi = (await remoteState())['aeon-ui'] || {};
  // Keep a quote-only account from unintentionally writing default interface
  // fields that are absent from an older saved configuration.
  const combined = {...latestUi, ...patch};
  const nextUi = {
    ...combined,
    quoteExcelUrl: normaliseQuoteFileUrl(combined.quoteExcelUrl, 'excel'),
    quotePdfUrl: normaliseQuoteFileUrl(combined.quotePdfUrl, 'pdf')
  };
  await saveShared('aeon-ui', nextUi);

  const confirmed = {...AEON_DEFAULT_UI, ...((await remoteState())['aeon-ui'] || {})};
  if (confirmed.quoteExcelUrl !== nextUi.quoteExcelUrl || confirmed.quotePdfUrl !== nextUi.quotePdfUrl) {
    throw new Error('Tệp báo giá chưa được lưu vào cấu hình. Vui lòng thử lại.');
  }
  return confirmed;
}

function setQuoteFileStatus(target, value, label) {
  const element = typeof target === 'string' ? $(target) : target;
  if (!element) return;
  element.replaceChildren();
  if (!value) {
    element.textContent = `Chưa có tệp ${label}.`;
    element.classList.add('is-empty');
    return;
  }
  element.classList.remove('is-empty');
  const link = document.createElement('a');
  link.href = value;
  link.download = '';
  link.textContent = `Tải thử tệp ${label} đang dùng ↗`;
  element.append(link);
}

async function saveShared(key, value) {
  const saved = await aeonStore.set(key, value);
  if (saved) return value;

  // Restore the last confirmed shared state when the server cannot accept a save.
  await aeonStore.pull();
  throw new Error('Không thể lưu vào máy chủ. Vui lòng kiểm tra kết nối rồi thử lại.');
}

async function remoteState() {
  const response = await fetch('/api/state', {cache: 'no-store'});
  if (!response.ok) throw new Error('Không thể kiểm tra dữ liệu đã lưu trên máy chủ.');
  return response.json();
}

function sameImage(left, right) {
  return normaliseImageUrl(left) === normaliseImageUrl(right);
}

async function verifyProductImage(productId, expectedImage) {
  if (!expectedImage) return;
  const state = await remoteState();
  const product = (state['aeon-products'] || []).find(item => item.id === productId);
  if (!product || !sameImage(product.image, expectedImage)) {
    throw new Error('Ảnh đã tải lên nhưng chưa được gắn vào sản phẩm. Vui lòng thử lại.');
  }
}

async function saveHeroImage(value) {
  const heroImage = normaliseImageUrl(value);
  const latestUi = (await remoteState())['aeon-ui'] || {};
  // A new value is generated on every save so social crawlers re-fetch the
  // preview even when an external service replaces the image at the same URL.
  const heroPreviewVersion = `hero-${Date.now().toString(36)}`;
  await saveShared('aeon-ui', {...aeonStore.ui(), ...latestUi, heroImage, heroPreviewVersion});
  const confirmed = await remoteState();
  if (!sameImage(confirmed['aeon-ui']?.heroImage, heroImage)) {
    throw new Error('Ảnh banner chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return heroImage;
}

async function saveGiftRibbonBackground(value) {
  const rawImage = String(value ?? '').trim();
  const image = normaliseImageUrl(rawImage);
  if (rawImage && !image) throw new Error('Hãy nhập đường dẫn ảnh HTTP/HTTPS hợp lệ hoặc tải ảnh lên.');
  const latestUi = (await remoteState())['aeon-ui'] || {};
  await saveShared('aeon-ui', {...aeonStore.ui(), ...latestUi, giftRibbonBackgroundImage:image});
  const confirmedUi = (await remoteState())['aeon-ui'] || {};
  if (!sameImage(confirmedUi.giftRibbonBackgroundImage, image)) {
    throw new Error('Ảnh nền dải hàng tặng chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return image;
}
function cleanLogoText(value, fallback = '', limit = 40, preserveLines = false) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n');
  const cleaned = preserveLines
    ? source
        .split('\n')
        .slice(0, 2)
        .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : source.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, limit) || fallback;
}

function normaliseLogoMode(value) {
  return ['text', 'image', 'image-subtitle'].includes(String(value || '')) ? String(value) : AEON_DEFAULT_UI.logoMode;
}

function normaliseHeroDisplayMode(value) {
  return String(value || '').trim() === 'image-only' ? 'image-only' : 'content-image';
}

async function saveLogoSettings(patch = {}) {
  const latestUi = (await remoteState())['aeon-ui'] || {};

  const combined = {...aeonStore.ui(), ...latestUi, ...patch};
  const nextUi = {
    ...combined,
    logoText: cleanLogoText(combined.logoText, AEON_DEFAULT_UI.logoText, 32),
    logoSubtitle: cleanLogoText(combined.logoSubtitle, '', 80, true),
    logoMode: normaliseLogoMode(combined.logoMode),
    logoImage: normaliseImageUrl(combined.logoImage),
    faviconImage: normaliseImageUrl(combined.faviconImage)
  };
  await saveShared('aeon-ui', nextUi);

  const confirmed = {...AEON_DEFAULT_UI, ...((await remoteState())['aeon-ui'] || {})};
  const isSaved = confirmed.logoText === nextUi.logoText
    && confirmed.logoSubtitle === nextUi.logoSubtitle
    && confirmed.logoMode === nextUi.logoMode
    && sameImage(confirmed.logoImage, nextUi.logoImage);
  if (!isSaved) throw new Error('Thiết lập logo chưa được lưu trên máy chủ. Vui lòng thử lại.');

  renderAeonBrandLogos(confirmed);
  return confirmed;
}

function isAuthed() {
  return Boolean(adminSession?.authenticated);
}

function showLogin(message = '') {
  const login = $('#loginView');
  const app = $('#adminApp');
  adminSession = {authenticated:false, user:null};
  aeonStore.setAdminSession(false);
  app.hidden = true;
  app.style.display = 'none';
  login.hidden = false;
  login.style.display = '';
  document.body.classList.remove('admin-auth-pending', 'admin-authenticated');
  document.body.classList.add('admin-auth-checked', 'admin-auth-guest');
  if (message) $('#loginError').textContent = message;
}

function showApp() {
  const login = $('#loginView');
  const app = $('#adminApp');
  const requestedTab = location.hash.replace(/^#/, '');
  if (requestedTab && canOpenTab(requestedTab)) tab = requestedTab;
  applyAdminNavigation();
  applyAdminTheme(aeonStore.layout());
  renderAeonBrandLogos(aeonStore.ui());
  login.hidden = true;
  login.style.display = 'none';
  app.hidden = false;
  app.style.display = 'block';
  document.body.classList.remove('admin-auth-pending', 'admin-auth-guest');
  document.body.classList.add('admin-auth-checked', 'admin-authenticated');
  history.replaceState(null, '', `admin.html#${tab}`);
  render();
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  const error = $('#loginError');
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username')).trim();
  const password = String(form.get('password'));
  error.textContent = '';
  setBusy(submit, true, 'Đang đăng nhập...', 'Đăng nhập →');
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Không thể đăng nhập.');
    adminSession = {authenticated:true, user:result.user || null};
    aeonStore.setAdminSession(true);
    const stateLoaded = await hydrateAdminState();
    showApp();
    if (!stateLoaded) toastAdmin('Không tải được cài đặt đã lưu từ máy chủ. Hãy kiểm tra kết nối và tải lại trước khi chỉnh sửa.');
  } catch (loginError) {
    adminSession = {authenticated:false, user:null};
    aeonStore.setAdminSession(false);
    error.textContent = loginError.message || 'Tài khoản hoặc mật khẩu chưa đúng.';
  } finally {
    setBusy(submit, false, 'Đang đăng nhập...', 'Đăng nhập →');
  }
});

$('#logout').onclick = async () => {
  await fetch('/api/admin/logout', {method:'POST'}).catch(() => null);
  adminSession = {authenticated:false, user:null};
  aeonStore.setAdminSession(false);
  location.reload();
};

document.querySelectorAll('[data-tab]').forEach(button => {
  button.onclick = () => {
    if (!canOpenTab(button.dataset.tab)) return;
    tab = button.dataset.tab;
    applyAdminNavigation();
    history.replaceState(null, '', `admin.html#${tab}`);
    render();
  };
});

function render() {
  if (!isAuthed()) return;
  const labels = {
    dashboard: 'Tổng quan',
    products: 'Danh mục & logo',
    interface: 'Giao diện',
    customers: 'Khách hàng',
    accounts: 'Tài khoản & phân quyền'
  };
  if (!canOpenTab(tab)) {
    applyAdminNavigation();
    return render();
  }
  applyAdminNavigation();
  $('#adminTitle').textContent = labels[tab];
  const panel = $('#adminPanel');
  if (tab === 'dashboard') return dashboard(panel);
  if (tab === 'products') {
    productPanel(panel);
    assetPanel(panel, {logo: true, hero: false});
    return;
  }
  if (tab === 'interface') {
    panel.innerHTML = '';
    if (hasAdminPermission('interface')) interfacePanel(panel);
    if (hasAdminPermission('brands')) brandSettingsPanel(panel);
    if (hasAdminPermission('interface') || hasAdminPermission('quotes')) {
      assetPanel(panel, {logo: false, hero: true});
      if (!hasAdminPermission('interface')) panel.querySelectorAll('.asset-editor:not(.quote-file-editor)').forEach(section => section.remove());
      if (!hasAdminPermission('quotes')) panel.querySelector('.quote-file-editor')?.remove();
    }
    if (hasAdminPermission('interface')) layoutPanel(panel);
    return;
  }
  if (tab === 'customers') return customersPanel(panel);
  if (tab === 'accounts') return accountPanel(panel);
  panel.innerHTML = '<section class="admin-card"><p class="empty-admin">Mục quản trị không hợp lệ.</p></section>';
}

function quickProductRow(product, isNew = false, positionProducts = []) {
  const id = product.id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const variants = validAdminProductVariants(product.variants);
  const variantPrices = variants.map(variant => Number(variant.price)).filter(price => Number.isFinite(price) && price >= 0);
  const price = variantPrices.length ? Math.min(...variantPrices) : (product.price ?? '');
  return `<article class="quick-product-row" data-quick-id="${escapeHtml(id)}" data-quick-new="${isNew}">
    <header><div><span class="quick-product-kicker">${isNew ? 'SẢN PHẨM MỚI' : 'CẬP NHẬT NHANH'}</span><strong>${escapeHtml(product.name || 'Sản phẩm mới')}</strong>${variants.length ? `<small>${variants.length} lựa chọn · chỉnh sửa đầy đủ để cập nhật</small>` : ''}</div><div class="quick-row-actions">${isNew ? '<button class="quick-remove" type="button" data-quick-remove aria-label="Bỏ sản phẩm mới">×</button>' : `<button class="quick-detail" type="button" data-quick-detail="${escapeHtml(id)}">Chỉnh sửa đầy đủ</button>`}</div></header>
    <div class="quick-product-fields">
      <label>Tên sản phẩm<input data-quick-name value="${escapeHtml(product.name || '')}" required></label>
      <label>Thương hiệu<input data-quick-brand value="${escapeHtml(normaliseAeonBrand(product.brand))}" placeholder="Nhập tên thương hiệu"></label>
      <label>${variants.length ? 'Giá từ (VNĐ)' : 'Giá bán (VNĐ)'}<input data-quick-price type="number" min="0" inputmode="numeric" value="${price}" required${variants.length ? ' readonly' : ''}></label>
      <label>Nhãn hiển thị<input data-quick-label value="${escapeHtml(product.label || '')}" placeholder="Ví dụ: Bán chạy"></label>
      ${isNew ? `<label>Vị trí trong danh sách<select data-quick-position>${productInsertPositionOptions(positionProducts)}</select></label>` : ''}
      <label class="wide">Mô tả ngắn<textarea data-quick-description rows="2" required placeholder="Mô tả hiển thị trên thẻ sản phẩm">${escapeHtml(product.description || '')}</textarea></label>
    </div>
  </article>`;
}

function quickProductValues(list) {
  return [...list.querySelectorAll('[data-quick-id]')].map(row => ({
    id: row.dataset.quickId,
    isNew: row.dataset.quickNew === 'true',
    name: row.querySelector('[data-quick-name]').value,
    brand: row.querySelector('[data-quick-brand]').value,
    price: row.querySelector('[data-quick-price]').value,
    label: row.querySelector('[data-quick-label]').value,
    description: row.querySelector('[data-quick-description]').value,
    insertPosition: row.querySelector('[data-quick-position]')?.value ?? ''
  }));
}

async function saveQuickProducts(rows) {
  const state = await remoteState();
  const products = Array.isArray(state['aeon-products']) ? [...state['aeon-products']] : [];
  const savedIds = [];
  let added = 0;

  rows.forEach((row, index) => {
    const name = cleanTextImport(row.name, 160);
    const description = cleanTextImport(row.description, 500);
    const price = Number(row.price);
    if (!name || !description || !Number.isFinite(price) || price < 0) {
      throw new Error('Mỗi sản phẩm cần có tên, mô tả và giá bán hợp lệ.');
    }
    const position = products.findIndex(product => product.id === row.id);
    if (!row.isNew && position < 0) throw new Error(`Sản phẩm “${name}” đã thay đổi ở phiên khác. Hãy tải lại trang trước khi lưu.`);
    const existing = position >= 0 ? products[position] : null;
    const id = existing?.id || `sp-${Date.now()}-${index}`;
    const existingVariants = validAdminProductVariants(existing?.variants);
    const variantPrices = existingVariants.map(variant => Number(variant.price)).filter(value => Number.isFinite(value) && value >= 0);
    const product = {
      ...existing,
      id,
      name,
      price: variantPrices.length ? Math.min(...variantPrices) : Math.round(price),
      brand: normaliseAeonBrand(row.brand) || inferAeonBrandFromProductName(name),
      label: cleanTextImport(row.label, 100),
      description,
      image: normaliseImageUrl(existing?.image || ''),
      bg: existing?.bg || '#e9c38b',
      box: existing?.box || '#8f1834'
    };
    if (position >= 0) products[position] = product;
    else {
      const requestedPosition = Number(row.insertPosition);
      const insertAt = Number.isInteger(requestedPosition)
        ? Math.max(0, Math.min(requestedPosition, products.length))
        : products.length;
      products.splice(insertAt, 0, product);
      added += 1;
    }
    savedIds.push(id);
  });

  await saveShared('aeon-products', products);
  const confirmed = await remoteState();
  const persisted = Array.isArray(confirmed['aeon-products']) ? confirmed['aeon-products'] : [];
  if (!savedIds.every(id => persisted.some(product => product.id === id))) {
    throw new Error('Một số thay đổi chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return {saved: savedIds.length, added};
}

function openProductDetailFromDashboard(id) {
  openProductEditor(id, {
    mount: '#dashboardProductEditor',
    onSaved: () => dashboard($('#adminPanel')),
    onDeleted: () => dashboard($('#adminPanel'))
  });
  $('#dashboardProductEditor').scrollIntoView({behavior: 'smooth', block: 'start'});
}

function dashboard(panel) {
  const customers = aeonStore.customers();
  const orders = aeonStore.orders();
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const products = aeonStore.products();
  const shortcuts = [
    {tab:'products', label:'Danh mục & logo', detail:'Thêm, sửa, sắp xếp sản phẩm và quản lý logo độc lập'},
    hasAdminPermission('interface') && {tab:'interface', label:'Điều chỉnh giao diện', detail:'Banner, nội dung và bố cục trang chủ'},
    hasAdminPermission('customers') && {tab:'customers', label:'Xem khách hàng', detail:'Đơn hàng, PDF và dữ liệu đã đồng bộ'}
  ].filter(Boolean);
  panel.innerHTML = `
    <div class="stats">
      <article><span>Đơn hàng</span><strong>${orders.length}</strong></article>
      <article><span>Khách hàng</span><strong>${customers.length}</strong></article>
      <article><span>Doanh thu mẫu</span><strong>${money(revenue)}</strong></article>
      <article><span>Sản phẩm</span><strong>${products.length}</strong></article>
    </div>
    <section class="admin-card dashboard-shortcuts" aria-labelledby="dashboardShortcutsTitle">
      <div><p class="eyebrow">THAO TÁC NHANH</p><h2 id="dashboardShortcutsTitle">Bắt đầu công việc</h2><p>Chọn khu vực cần quản lý. Tổng quan chỉ hiển thị số liệu, không hiển thị danh sách sản phẩm.</p></div>
      <div class="dashboard-shortcut-list">${shortcuts.map(item => `<button type="button" data-dashboard-tab="${item.tab}"><strong>${item.label}</strong><small>${item.detail}</small><span>→</span></button>`).join('')}</div>
    </section>
    <section class="admin-card recent-orders-card">
      <h2>Đơn hàng gần đây</h2>
      ${orders.length ? `<div class="admin-table">${orders.slice(0, 5).map(order => {
        const customer = customers.find(item => item.id === order.customerId) || {};
        return `<div class="table-row"><b>${order.code}</b><span>${escapeHtml(customer.name || '—')}</span><span>${order.createdAt}</span><strong>${money(order.total)}</strong></div>`;
      }).join('')}</div>` : '<p class="empty-admin">Chưa có đơn hàng nào. Đơn từ website sẽ xuất hiện tại đây.</p>'}
    </section>`;
  panel.querySelectorAll('[data-dashboard-tab]').forEach(button => {
    button.onclick = () => {
      tab = button.dataset.dashboardTab;
      applyAdminNavigation();
      history.replaceState(null, '', `admin.html#${tab}`);
      render();
    };
  });
}

const importFileLimit = 15 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không thể đọc tệp đã chọn.'));
    reader.readAsDataURL(file);
  });
}

async function analyseProductImport(file) {
  if (!file) throw new Error('Hãy chọn tệp Excel, PDF hoặc ảnh trước.');
  if (file.size > importFileLimit) throw new Error('Tệp phải nhỏ hơn hoặc bằng 15 MB.');
  if (!/\.(xlsx|xls|csv|pdf|png|jpe?g|webp|gif)$/i.test(file.name)) {
    throw new Error('Chỉ hỗ trợ Excel (.xlsx, .xls, .csv), PDF hoặc ảnh PNG/JPG/WEBP/GIF.');
  }
  const response = await fetch('/api/import-products', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl: await readFileAsDataUrl(file)})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể phân tích tệp này.');
  return result;
}

function importedDescription(value) {
  return cleanTextImport(value) || 'Thông tin sản phẩm sẽ được cập nhật.';
}

function cleanTextImport(value, limit = 1000) {
  return String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanMultilineImport(value, limit = 1000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function productIdentity(value) {
  return cleanTextImport(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function importedExistingProduct(candidate, products) {
  const systemId = cleanTextImport(candidate.id, 100);
  if (systemId) {
    const byId = products.find(product => cleanTextImport(product.id, 100) === systemId);
    if (byId) return byId;
  }
  const sku = productIdentity(candidate.sku);
  const bySku = sku ? products.find(product => productIdentity(product.sku) === sku) : null;
  if (bySku) return bySku;
  const name = productIdentity(candidate.name);
  const brand = productIdentity(candidate.brand);
  return name ? products.find(product => productIdentity(product.name) === name
    && (!brand || !productIdentity(product.brand) || productIdentity(product.brand) === brand)) : null;
}

async function saveImportedProducts(drafts) {
  const state = await remoteState();
  const products = Array.isArray(state['aeon-products']) ? [...state['aeon-products']] : [];
  const savedIds = [];
  let created = 0;
  let updated = 0;

  drafts.forEach((draft, index) => {
    const name = cleanTextImport(draft.name, 160);
    const description = importedDescription(draft.description);
    const requestedId = cleanTextImport(draft.id, 100);
    const sku = cleanTextImport(draft.sku, 100);
    let position = requestedId ? products.findIndex(product => cleanTextImport(product.id, 100) === requestedId) : -1;
    if (position < 0 && sku) position = products.findIndex(product => productIdentity(product.sku) === productIdentity(sku));
    if (position < 0) {
      const identity = productIdentity(name);
      const brandIdentity = productIdentity(draft.brand);
      if (identity) position = products.findIndex(product => productIdentity(product.name) === identity
        && (!brandIdentity || !productIdentity(product.brand) || productIdentity(product.brand) === brandIdentity));
    }
    const existing = position >= 0 ? products[position] : null;
    const existingVariants = validAdminProductVariants(existing?.variants);
    const importedVariants = validAdminProductVariants(draft.variants).map((variant, variantIndex) => ({
      id: cleanTextImport(variant.id, 100) || `variant-${Date.now()}-${index}-${variantIndex}`,
      name: cleanTextImport(variant.name, 120),
      price: Math.round(Number(variant.price)),
      sku: cleanTextImport(variant.sku, 100),
      image: normaliseImageUrl(variant.image || '')
    }));
    const variants = draft.hasVariantColumns ? importedVariants : existingVariants;
    const variantPrices = variants.map(variant => Number(variant.price)).filter(value => Number.isFinite(value) && value >= 0);
    const price = variantPrices.length ? Math.min(...variantPrices) : Number(draft.price);
    const originalPrice = Number(draft.originalPrice) || 0;
    if (!name || !Number.isFinite(price) || price <= 0) {
      throw new Error('Mỗi sản phẩm cần có tên và giá bán, hoặc ít nhất một phân loại có giá lớn hơn 0.');
    }
    const product = {
      ...existing,
      id: existing?.id || requestedId || `sp-import-${Date.now()}-${index}`,
      name,
      price: Math.round(price),
      originalPrice: originalPrice > price ? Math.round(originalPrice) : 0,
      brand: normaliseAeonBrand(draft.brand) || normaliseAeonBrand(existing?.brand) || inferAeonBrandFromProductName(name),
      description,
      sku,
      productGroup: cleanTextImport(draft.productGroup ?? existing?.productGroup, 100),
      label: cleanTextImport(draft.label, 100),
      promotionProductName: cleanTextImport(draft.promotionProductName ?? existing?.promotionProductName, 160),
      promotionProductValue: cleanTextImport(draft.promotionProductValue ?? existing?.promotionProductValue, 120),
      promotionProductImage: normaliseGiftImageList(draft.promotionProductImage ?? existing?.promotionProductImage ?? '').join(', '),
      dealSlotsTotal: Math.max(1, cleanDealSlotCount(draft.dealSlotsTotal ?? existing?.dealSlotsTotal, 20)),
      dealSlotsRemaining: Math.min(Math.max(1, cleanDealSlotCount(draft.dealSlotsTotal ?? existing?.dealSlotsTotal, 20)), cleanDealSlotCount(draft.dealSlotsRemaining ?? existing?.dealSlotsRemaining, 0)),
      weight: cleanMultilineImport(draft.weight, 100),
      ingredients: cleanMultilineImport(draft.ingredients, 300),
      image: normaliseProductImages(draft.images || draft.image || existing?.images || existing?.image || '')[0] || '',
      images: normaliseProductImages(draft.images || draft.image || existing?.images || existing?.image || ''),
      variantLabel: variants.length
        ? cleanTextImport(draft.hasVariantColumns ? draft.variantLabel : existing?.variantLabel, 100) || 'Phân loại'
        : '',
      variants,
      bg: existing?.bg || '#e9c38b',
      box: existing?.box || '#8f1834'
    };
    if (position >= 0) {
      products[position] = product;
      updated += 1;
    } else {
      products.push(product);
      created += 1;
    }
    savedIds.push(product.id);
  });

  const uniqueSavedIds = [...new Set(savedIds)];
  const savedIdSet = new Set(uniqueSavedIds);
  const orderedImportedProducts = uniqueSavedIds
    .map(id => products.find(product => product.id === id))
    .filter(Boolean);
  const remainingProducts = products.filter(product => !savedIdSet.has(product.id));
  await saveShared('aeon-products', [...orderedImportedProducts, ...remainingProducts]);
  const confirmed = await remoteState();
  const persisted = Array.isArray(confirmed['aeon-products']) ? confirmed['aeon-products'] : [];
  if (!savedIds.every(id => persisted.some(product => product.id === id))) {
    throw new Error('Một số sản phẩm chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return {created, updated};
}

function importWarnings(candidate, existing) {
  const warnings = [...(candidate.warnings || [])];
  const variantPrices = validAdminProductVariants(candidate.variants)
    .map(variant => Number(variant.price))
    .filter(price => Number.isFinite(price) && price > 0);
  if ((!Number(candidate.price) || Number(candidate.price) <= 0) && !variantPrices.length) warnings.push('Chưa có giá bán hoặc giá phân loại hợp lệ.');
  if (existing) warnings.push('Trùng ID hoặc mã sản phẩm: nếu chọn nhập, mục hiện có sẽ được cập nhật.');
  return warnings;
}

function bindImportVariantEditor(card) {
  const list = card.querySelector('[data-import-variant-rows]');
  const addButton = card.querySelector('[data-import-add-variant]');
  const priceInput = card.querySelector('[data-import-price]');
  const originalPrice = priceInput.value;

  const syncPrice = () => {
    const rows = [...list.querySelectorAll('[data-variant-id]')];
    const prices = rows.map(row => Number(row.querySelector('[data-variant-price]').value));
    priceInput.readOnly = rows.length > 0;
    priceInput.classList.toggle('derived-price', rows.length > 0);
    if (!rows.length) {
      if (!priceInput.value) priceInput.value = originalPrice;
      return;
    }
    const validPrices = prices.filter(price => Number.isFinite(price) && price >= 0);
    priceInput.value = validPrices.length === prices.length ? Math.min(...validPrices) : '';
  };

  const bindRow = row => {
    row.querySelector('[data-remove-variant]').onclick = () => {
      row.remove();
      syncPrice();
    };
    row.querySelectorAll('input').forEach(input => input.addEventListener('input', syncPrice));
  };
  list.querySelectorAll('[data-variant-id]').forEach(bindRow);
  addButton.onclick = () => {
    if (list.querySelectorAll('[data-variant-id]').length >= 20) {
      toastAdmin('Mỗi sản phẩm tối đa 20 phân loại.');
      return;
    }
    list.insertAdjacentHTML('beforeend', productVariantRowMarkup());
    const row = list.lastElementChild;
    bindRow(row);
    syncPrice();
    row.querySelector('[data-variant-name]').focus();
  };
  syncPrice();
  return () => productVariantsFromEditor(list);
}

function renderImportPreview(target, analysis, products) {
  const candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  const sourceName = analysis.kind === 'excel' ? 'Excel' : analysis.kind === 'pdf' ? 'PDF' : 'Ảnh / OCR';
  const notices = [...(analysis.warnings || [])];
  if (!candidates.length) {
    target.innerHTML = `
      <div class="import-empty" role="status"><strong>Chưa có sản phẩm đủ thông tin để nhập.</strong><p>${escapeHtml(notices.join(' ') || 'Hãy thử tệp rõ nét hơn hoặc kiểm tra bảng giá trong Excel.')}</p>${analysis.textPreview ? `<details><summary>Xem nội dung đã trích xuất</summary><pre>${escapeHtml(analysis.textPreview)}</pre></details>` : ''}</div>`;
    return;
  }

  target.innerHTML = `
    <div class="import-result-head" aria-live="polite">
      <div><span class="import-badge">${sourceName}</span><strong>Đã nhận diện ${candidates.length} sản phẩm nháp</strong><p>Dòng trùng tên/thương hiệu đã gộp; sản phẩm trùng trong danh mục sẽ được cập nhật khi lưu.</p></div>
      <label class="import-select-all"><input type="checkbox" id="selectAllImports" checked> Chọn tất cả hợp lệ (kể cả mục trùng)</label>
    </div>
    ${notices.length ? `<div class="import-notices">${notices.map(notice => `<p>• ${escapeHtml(notice)}</p>`).join('')}</div>` : ''}
    <div class="import-candidates">${candidates.map((candidate, index) => {
      const existing = importedExistingProduct(candidate, products);
      const warnings = importWarnings(candidate, existing);
      const canSelect = Boolean(cleanTextImport(candidate.name));
      const hasValidVariant = validAdminProductVariants(candidate.variants).some(variant => Number(variant.price) > 0);
      const selectByDefault = canSelect && (Number(candidate.price) > 0 || hasValidVariant);
      return `<article class="import-candidate" data-import-index="${index}" data-existing-id="${escapeHtml(existing?.id || '')}">
        <header><label class="import-check"><input type="checkbox" data-import-select ${selectByDefault ? 'checked' : ''} ${canSelect ? '' : 'disabled'}><span>Chọn sản phẩm ${index + 1}</span></label><span class="import-confidence">Độ tin cậy ${Math.max(0, Math.min(100, Number(candidate.confidence) || 0))}%</span></header>
        <div class="import-fields">
          <label>Tên sản phẩm<input data-import-name value="${escapeHtml(candidate.name || '')}" required></label>
          <label>Nhóm hàng<input data-import-product-group value="${escapeHtml(candidate.productGroup || existing?.productGroup || '')}" placeholder="Ví dụ: Điện gia dụng"></label>
          <label>Thương hiệu<input data-import-brand value="${escapeHtml(normaliseAeonBrand(candidate.brand) || normaliseAeonBrand(existing?.brand) || inferAeonBrandFromProductName(candidate.name))}" placeholder="Tự động lấy từ file hoặc tên sản phẩm"></label>
          <label>Giá khuyến mãi (VNĐ)<input data-import-price type="number" min="0" inputmode="numeric" value="${Number(candidate.price) || ''}" required></label>
          <label>Giá thường (VNĐ)<input data-import-original-price type="number" min="0" inputmode="numeric" value="${Number(candidate.originalPrice) || ''}" placeholder="Để trống nếu không giảm giá"></label>
          <label>Tên sản phẩm khuyến mãi<input data-import-promotion-name value="${escapeHtml(candidate.promotionProductName || existing?.promotionProductName || '')}" placeholder="Ví dụ: Nồi lẩu điện"></label>
          <label>Giá trị sản phẩm khuyến mãi<input data-import-promotion-value value="${escapeHtml(candidate.promotionProductValue || existing?.promotionProductValue || '')}" placeholder="Ví dụ: 990.000 ₫"></label>
          <label>Số suất đã đặt trước<input data-import-deal-slots-remaining type="number" min="0" max="9999" step="1" value="${cleanDealSlotCount(candidate.dealSlotsRemaining ?? existing?.dealSlotsRemaining, 0)}"></label>
          <label>Tổng số suất<input data-import-deal-slots-total type="number" min="1" max="9999" step="1" value="${Math.max(1, cleanDealSlotCount(candidate.dealSlotsTotal ?? existing?.dealSlotsTotal, 20))}"></label>
          <label class="wide">Link ảnh sản phẩm khuyến mãi<input data-import-promotion-image value="${escapeHtml(candidate.promotionProductImage || existing?.promotionProductImage || '')}" placeholder="Link ảnh 1, link ảnh 2"><small>Có thể nhập tối đa 2 link ảnh, phân cách bằng dấu phẩy.</small></label>
          <label>Mã sản phẩm<input data-import-sku value="${escapeHtml(candidate.sku || '')}"></label>
          <label class="wide">Mô tả ngắn<textarea data-import-description rows="2">${escapeHtml(candidate.description || '')}</textarea></label>
          <label>Tính năng nổi bật<textarea data-import-ingredients rows="3" placeholder="Mỗi dòng một tính năng">${escapeHtml(candidate.ingredients || '')}</textarea></label>
          <label>Tên nhóm phân loại<input data-import-variant-label value="${escapeHtml(candidate.variantLabel || existing?.variantLabel || '')}" placeholder="Ví dụ: Màu sắc"></label>
          <fieldset class="product-variant-editor import-variant-editor wide"><legend>Giá trị phân loại</legend><p>Mỗi màu sắc, kích thước hoặc hương vị là một dòng riêng.</p><div class="product-variant-rows" data-import-variant-rows>${validAdminProductVariants(candidate.variants).map(productVariantRowMarkup).join('')}</div><button class="secondary-button" type="button" data-import-add-variant>+ Thêm phân loại</button></fieldset>
        </div>
        ${warnings.length ? `<div class="import-row-warnings">${warnings.map(warning => `<p>• ${escapeHtml(warning)}</p>`).join('')}</div>` : ''}
      </article>`;
    }).join('')}</div>
    <div class="import-footer"><p id="importSelectionStatus"></p><button class="button primary" type="button" id="saveImportedProducts">Thêm sản phẩm đã chọn</button></div>
    ${analysis.textPreview ? `<details class="import-source-text"><summary>Xem nội dung đã trích xuất</summary><pre>${escapeHtml(analysis.textPreview)}</pre></details>` : ''}`;

  AEONRichText.bindAll(target);
  const importVariantGetters = new Map();
  target.querySelectorAll('.import-candidate').forEach(card => {
    importVariantGetters.set(card, bindImportVariantEditor(card));
  });
  const checks = [...target.querySelectorAll('[data-import-select]')];
  const selectableNew = checks.filter(check => !check.disabled);
  const updateSelection = () => {
    const selected = checks.filter(check => check.checked).length;
    $('#importSelectionStatus').textContent = selected ? `Sẵn sàng thêm ${selected} sản phẩm đã chọn.` : 'Hãy chọn ít nhất một sản phẩm hợp lệ.';
    $('#saveImportedProducts').disabled = !selected;
    const selectAll = $('#selectAllImports');
    const selectedEligible = selectableNew.filter(check => check.checked).length;
    selectAll.checked = selectableNew.length > 0 && selectedEligible === selectableNew.length;
    selectAll.indeterminate = selectedEligible > 0 && selectedEligible < selectableNew.length;
  };
  checks.forEach(check => { check.onchange = updateSelection; });
  $('#selectAllImports').onchange = event => {
    selectableNew.forEach(check => { check.checked = event.currentTarget.checked; });
    updateSelection();
  };
  updateSelection();

  $('#saveImportedProducts').onclick = async () => {
    const selected = [...target.querySelectorAll('.import-candidate')]
      .filter(card => card.querySelector('[data-import-select]').checked)
      .map(card => {
        const index = Number(card.dataset.importIndex);
        const original = candidates[index] || {};
        const variants = importVariantGetters.get(card)?.() || [];
        const variantLabel = card.querySelector('[data-import-variant-label]').value;
        return {
          ...original,
          name: card.querySelector('[data-import-name]').value,
          productGroup: card.querySelector('[data-import-product-group]').value,
          brand: card.querySelector('[data-import-brand]').value,
          price: card.querySelector('[data-import-price]').value,
          originalPrice: card.querySelector('[data-import-original-price]').value,
          promotionProductName: card.querySelector('[data-import-promotion-name]').value,
          promotionProductValue: card.querySelector('[data-import-promotion-value]').value,
          promotionProductImage: card.querySelector('[data-import-promotion-image]').value,
          dealSlotsRemaining: card.querySelector('[data-import-deal-slots-remaining]').value,
          dealSlotsTotal: card.querySelector('[data-import-deal-slots-total]').value,
          sku: card.querySelector('[data-import-sku]').value,
          description: card.querySelector('[data-import-description]').value,
          ingredients: card.querySelector('[data-import-ingredients]').value,
          variantLabel,
          variants,
          hasVariantColumns: Boolean(original.hasVariantColumns || variants.length || cleanTextImport(variantLabel))
        };
      });
    if (!selected.length) return;
    const button = $('#saveImportedProducts');
    try {
      setBusy(button, true, 'Đang lưu...', 'Thêm sản phẩm đã chọn');
      const saved = await saveImportedProducts(selected);
      productPanel($('#adminPanel'));
      toastAdmin(`Đã thêm ${saved.created} sản phẩm${saved.updated ? ` và cập nhật ${saved.updated} sản phẩm` : ''}.`);
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang lưu...', 'Thêm sản phẩm đã chọn');
    }
  };
}

function productPanel(panel) {
  const products = aeonStore.products();
  panel.innerHTML = `
    <section class="admin-section-intro"><p class="eyebrow">DANH MỤC SẢN PHẨM</p><h2>Danh mục & logo</h2><p>Thêm, sửa, sắp xếp danh sách sản phẩm và quản lý logo. Các thay đổi này độc lập với phần giao diện.</p></section>
    <div class="panel-action admin-toolbar"><p>Chọn một thao tác để bắt đầu.</p><div class="panel-action-buttons"><button class="secondary-button" id="downloadCurrentProducts" type="button">Tải danh mục có ảnh</button><button class="secondary-button" id="downloadProductTemplate" type="button">Tải file mẫu</button><button class="secondary-button" id="importProducts" type="button">Tải lên danh sách</button><button class="button primary" id="newProduct">+ Thêm sản phẩm</button></div></div>
    <section class="admin-card import-products" id="productImportPanel" hidden aria-labelledby="productImportTitle">
      <div class="import-intro"><div><p class="eyebrow">NHẬP DANH MỤC</p><h2 id="productImportTitle">Tải lên danh sách sản phẩm</h2><p>Excel có thể chứa nhiều dòng phân loại cho cùng một sản phẩm. Hệ thống sẽ gom theo ID, mã sản phẩm hoặc tên + thương hiệu để bạn kiểm tra trước khi lưu.</p></div><button class="import-close" type="button" id="closeProductImport" aria-label="Đóng khu vực nhập tệp">×</button></div>
      <form class="import-form" id="productImportForm">
        <label class="import-dropzone" for="importProductFile"><span>Chọn tệp danh mục hoặc báo giá</span><small>Excel, PDF, PNG, JPG, WEBP hoặc GIF · tối đa 15 MB</small><input id="importProductFile" type="file" accept=".xlsx,.xls,.csv,.pdf,image/png,image/jpeg,image/webp,image/gif" required></label>
        <div class="import-actions"><p id="importFileName" aria-live="polite">Chưa chọn tệp.</p><div class="panel-action-buttons"><button class="secondary-button" id="downloadProductTemplateInline" type="button">Tải file mẫu</button><button class="button primary" id="analyseProductFile" type="submit">Phân tích tệp</button></div></div>
      </form>
      <div class="import-results" id="importResults" aria-live="polite"></div>
    </section>
    <section class="admin-card product-list-card">
      ${products.length ? `<div class="admin-table">${products.map(product => `<div class="table-row"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.description)}</small></span><span><b>${escapeHtml(normaliseAeonBrand(product.brand) || 'Chưa chọn thương hiệu')}</b><small>${escapeHtml(product.label || 'Không có nhãn hiển thị')}</small></span><strong>${money(product.price)}</strong><button class="edit-product" data-id="${escapeHtml(product.id)}">Chỉnh sửa</button><button class="danger delete-product-setting" data-delete-product="${escapeHtml(product.id)}" aria-label="Xóa ${escapeHtml(product.name)}">Xóa</button></div>`).join('')}</div>` : '<p class="empty-admin">Chưa có sản phẩm. Hãy thêm sản phẩm đầu tiên.</p>'}
    </section>
    <div id="productEditor"></div>`;
  $('#newProduct').onclick = () => openProductEditor();
  panel.querySelectorAll('[data-delete-product]').forEach(button => {
    button.onclick = async () => {
      const id = button.dataset.deleteProduct;
      const product = aeonStore.products().find(item => String(item.id) === String(id));
      if (!product || !confirm(`Xóa sản phẩm “${product.name}”?`)) return;
      try {
        await aeonStore.deleteProduct(id);
        productPanel($('#adminPanel'));
        toastAdmin(`Đã xóa ${product.name} khỏi danh mục.`);
      } catch (error) {
        toastAdmin(error.message || 'Không thể xóa sản phẩm.');
      }
    };
  });
  $('#downloadCurrentProducts').onclick = () => downloadCurrentProducts($('#downloadCurrentProducts'));
  $('#downloadProductTemplate').onclick = () => downloadProductTemplate($('#downloadProductTemplate'));
  const importPanel = $('#productImportPanel');
  const importResults = $('#importResults');
  $('#importProducts').onclick = () => {
    importPanel.hidden = false;
    $('#importProductFile').focus();
  };
  $('#closeProductImport').onclick = () => { importPanel.hidden = true; };
  $('#downloadProductTemplateInline').onclick = () => downloadProductTemplate($('#downloadProductTemplateInline'));
  $('#importProductFile').onchange = event => {
    const file = event.currentTarget.files[0];
    $('#importFileName').textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : 'Chưa chọn tệp.';
    importResults.replaceChildren();
  };
  $('#productImportForm').onsubmit = async event => {
    event.preventDefault();
    const button = $('#analyseProductFile');
    try {
      setBusy(button, true, 'Đang phân tích...', 'Phân tích tệp');
      const analysis = await analyseProductImport($('#importProductFile').files[0]);
      renderImportPreview(importResults, analysis, aeonStore.products());
    } catch (error) {
      importResults.innerHTML = `<p class="import-error" role="alert">${escapeHtml(error.message)}</p>`;
    } finally {
      setBusy(button, false, 'Đang phân tích...', 'Phân tích tệp');
    }
  };
  document.querySelectorAll('.edit-product').forEach(button => {
    button.onclick = () => openProductEditor(button.dataset.id);
  });
}

async function downloadProductTemplate(button) {
  return downloadProductExcel(button, {
    url: '/api/template/products.xlsx',
    filename: 'mau-nhap-danh-sach-san-pham.xlsx',
    busyText: 'Đang tạo mẫu...',
    idleText: 'Tải file mẫu',
    successText: 'Đã tải file mẫu có hướng dẫn phân loại sản phẩm.',
    errorText: 'Không thể tạo mẫu Excel.'
  });
}

async function downloadCurrentProducts(button) {
  return downloadProductExcel(button, {
    url: '/api/export/products.xlsx',
    filename: 'danh-muc-san-pham.xlsx',
    busyText: 'Đang tạo danh sách...',
    idleText: 'Tải danh mục có ảnh',
    successText: 'Đã tải danh mục có ảnh, tên sản phẩm, giá và dữ liệu cập nhật.',
    errorText: 'Không thể tạo danh sách sản phẩm Excel.'
  });
}

async function downloadProductExcel(button, options) {
  try {
    setBusy(button, true, options.busyText, options.idleText);
    const response = await fetch(options.url, {cache: 'no-store'});
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || options.errorText);
    }
    const file = await response.blob();
    if (!file.size) throw new Error('Tệp Excel chưa có dữ liệu hợp lệ.');
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastAdmin(options.successText);
  } catch (error) {
    toastAdmin(error.message);
  } finally {
    setBusy(button, false, options.busyText, options.idleText);
  }
}

function openProductEditor(id, options = {}) {
  const editorMount = typeof options.mount === 'string' ? $(options.mount) : (options.mount || $('#productEditor'));
  if (!editorMount) return;
  const onSaved = options.onSaved || (() => productPanel($('#adminPanel')));
  const onDeleted = options.onDeleted || onSaved;
  const onCancel = options.onCancel || (() => editorMount.replaceChildren());
  const currentProducts = aeonStore.products();
  const foundProduct = currentProducts.find(product => product.id === id);
  const foundImages = foundProduct ? normaliseProductImages(foundProduct.images, foundProduct.image) : [];
  const existing = foundProduct ? {...foundProduct, image: foundImages[0] || '', images: foundImages} : {
    id: `sp-${Date.now()}`,
    name: '',
    description: '',
    price: '',
    originalPrice: '',
    brand: '',
    label: '',
    dealSlotsRemaining: 0,
    dealSlotsTotal: 20,
    promotionProductName: '',
    promotionProductValue: '',
    promotionProductImage: '',
    image: '',
    images: [],
    details: '',
    weight: '',
    ingredients: '',
    sku: '',
    variantLabel: '',
    variants: [],
    bg: '#e9c38b',
    box: '#8f1834'
  };
  const editorVariants = validAdminProductVariants(existing.variants);

  let getProductVariants = () => [];
  const saveProduct = async form => {
    const data = Object.fromEntries(new FormData(form));
    const requestedPosition = Number(data.insertPosition);
    delete data.insertPosition;
    data.id = existing.id;
    data.variants = getProductVariants();
    data.variantLabel = data.variants.length ? cleanTextImport(data.variantLabel, 100) || 'Phân loại' : '';
    data.price = data.variants.length ? Math.min(...data.variants.map(variant => variant.price)) : Number(data.price);
    data.originalPrice = Number(data.originalPrice) > data.price ? Math.round(Number(data.originalPrice)) : 0;
    data.dealSlotsTotal = Math.max(1, cleanDealSlotCount(data.dealSlotsTotal, cleanDealSlotCount(existing.dealSlotsTotal, 20)));
    data.dealSlotsRemaining = Math.min(data.dealSlotsTotal, cleanDealSlotCount(data.dealSlotsRemaining, cleanDealSlotCount(existing.dealSlotsRemaining, 0)));
    data.promotionProductName = cleanTextImport(data.promotionProductName, 160);
    data.promotionProductValue = cleanTextImport(data.promotionProductValue, 120);
    data.promotionProductImage = normaliseGiftImageList(data.promotionProductImage || '').join(', ');
    data.productGroup = cleanTextImport(data.productGroup, 100);
    if (!Number.isFinite(data.price) || data.price < 0) throw new Error('Giá bán không hợp lệ.');
    data.images = normaliseProductImages([data.image, data.image2, data.image3, data.image4, data.image5, data.images]);
    delete data.image2; delete data.image3; delete data.image4; delete data.image5;
    data.image = data.images[0] || '';
    data.brand = normaliseAeonBrand(data.brand) || inferAeonBrandFromProductName(data.name);
    let all = [...aeonStore.products()];
    try {
      const state = await remoteState();
      if (Array.isArray(state['aeon-products'])) all = state['aeon-products'];
    } catch {
      // saveShared will surface a real connectivity error if the following write cannot succeed.
    }
    const position = all.findIndex(product => product.id === data.id);
    const stored = position < 0 ? null : all[position];
    // A stale admin tab must not erase an image uploaded in another tab.
    if (!data.image && stored?.image) data.image = normaliseImageUrl(stored.image);
    data.images = normaliseProductImages([data.image || stored?.image, data.images]);
    data.image = data.images[0] || '';
    if (position < 0) {
      const insertAt = Number.isInteger(requestedPosition)
        ? Math.max(0, Math.min(requestedPosition, all.length))
        : all.length;
      all.splice(insertAt, 0, data);
    }
    else all[position] = {...stored, ...data};
    await saveShared('aeon-products', all);
    await verifyProductImage(data.id, data.image);
    return data;
  };

  editorMount.innerHTML = `
    <section class="admin-card editor">
      <h2>${id ? 'Chỉnh sửa sản phẩm' : 'Sản phẩm mới'}</h2>
      <p>Chọn ảnh để tải lên hoặc dán đường dẫn ảnh online. Bạn cũng có thể dùng ảnh sản phẩm làm banner.</p>
      <form id="productForm">
        <div class="admin-form-grid">
          <label>Tên sản phẩm<input name="name" required value="${escapeHtml(existing.name)}"></label>
          <label>Nhóm hàng<input name="productGroup" maxlength="100" value="${escapeHtml(existing.productGroup || '')}" placeholder="Ví dụ: Điện gia dụng"></label>
          <label>Thương hiệu<input name="brand" value="${escapeHtml(normaliseAeonBrand(existing.brand))}" placeholder="Nhập tên thương hiệu"><small>Tự động đưa vào bộ lọc thương hiệu sau khi lưu.</small></label>
          ${id ? '' : `<label>Vị trí trong danh sách<select name="insertPosition">${productInsertPositionOptions(currentProducts)}</select><small>Sản phẩm sẽ được chèn đúng vị trí này khi lưu.</small></label>`}
          <label>Giá khuyến mãi (VNĐ)<small data-variant-price-hint></small><input name="price" type="number" min="0" inputmode="numeric" required value="${existing.price ?? ''}" placeholder="Ví dụ: 750000"${editorVariants.length ? ' readonly' : ''}></label>
          <label>Giá thường (VNĐ)<input name="originalPrice" type="number" min="0" inputmode="numeric" value="${existing.originalPrice ?? ''}" placeholder="Ví dụ: 900000"><small>Để trống nếu không giảm giá.</small></label>
          <fieldset class="product-promotion-fields image-path wide"><legend>Suất đã đặt trước</legend><p>Dải hiển thị số suất đã có người đặt trước; màu chuyển từ vàng sang cam, đỏ khi số người đặt tăng.</p><div class="admin-form-grid"><label>Số suất đã đặt trước<input name="dealSlotsRemaining" type="number" min="0" max="9999" step="1" value="${cleanDealSlotCount(existing.dealSlotsRemaining, 0)}"></label><label>Tổng số suất<input name="dealSlotsTotal" type="number" min="1" max="9999" step="1" value="${Math.max(1, cleanDealSlotCount(existing.dealSlotsTotal, 20))}"></label></div></fieldset>
          <fieldset class="product-promotion-fields image-path wide"><legend>Hàng tặng kèm Black Friday</legend><p>Chỉ cần tên và ảnh để hiển thị quà tặng; giá trị quà là tùy chọn. Có thể nhập tối đa 2 link ảnh, phân cách bằng dấu phẩy.</p><div class="admin-form-grid"><label>Tên sản phẩm khuyến mãi<input name="promotionProductName" maxlength="160" value="${escapeHtml(existing.promotionProductName || '')}" placeholder="Ví dụ: Nồi lẩu điện"></label><label>Giá trị sản phẩm khuyến mãi<input name="promotionProductValue" maxlength="120" value="${escapeHtml(existing.promotionProductValue || '')}" placeholder="Ví dụ: 990.000 ₫"></label><label class="wide">Link ảnh sản phẩm khuyến mãi<input name="promotionProductImage" value="${escapeHtml(existing.promotionProductImage || '')}" placeholder="Link ảnh 1, link ảnh 2"></label></div></fieldset>
          <label>Mô tả ngắn<textarea name="description" required rows="2" placeholder="Tóm tắt hiển thị trên thẻ sản phẩm">${escapeHtml(existing.description)}</textarea></label>
          <label>Nhãn hiển thị<input name="label" value="${escapeHtml(existing.label)}"></label>
          <label>Kích thước<textarea name="weight" rows="2" placeholder="Ví dụ: 4 bánh · 720g">${escapeHtml(existing.weight || '')}</textarea></label>
          <label>Tính năng nổi bật<textarea name="ingredients" rows="3" placeholder="Mỗi dòng một tính năng">${escapeHtml(existing.ingredients || '')}</textarea></label>
          <label>Mã sản phẩm<input name="sku" value="${escapeHtml(existing.sku || '')}" placeholder="Ví dụ: AM-2026-01"></label>
          <label class="image-path">Tên nhóm phân loại<input name="variantLabel" value="${escapeHtml(existing.variantLabel || '')}" placeholder="Ví dụ: Màu sắc, Kích thước, Hương vị"><small>Được hiển thị khi sản phẩm có nhiều lựa chọn.</small></label>
          <fieldset class="product-variant-editor image-path"><legend>Phân loại sản phẩm</legend><p>Mỗi màu sắc, kích thước hoặc hương vị có thể có giá và mã SKU riêng.</p><div class="product-variant-rows" data-variant-rows>${editorVariants.map(productVariantRowMarkup).join('')}</div><button class="secondary-button" type="button" data-add-variant>+ Thêm phân loại</button></fieldset>
          <label class="image-path">Ảnh 1 (URL)<input name="image" value="${escapeHtml(existing.image || '')}" placeholder="https://... hoặc /assets/uploads/ten-anh.png"></label>
          <textarea name="images" hidden>${escapeHtml(normaliseProductImages(existing.images, existing.image).slice(1).join('\n'))}</textarea>
          <div class="image-path product-extra-image-fields"><label>Ảnh 2 (URL)<input name="image2" value="${escapeHtml(normaliseProductImages(existing.images, existing.image)[1] || '')}"></label><label>Ảnh 3 (URL)<input name="image3" value="${escapeHtml(normaliseProductImages(existing.images, existing.image)[2] || '')}"></label><label>Ảnh 4 (URL)<input name="image4" value="${escapeHtml(normaliseProductImages(existing.images, existing.image)[3] || '')}"></label><label>Ảnh 5 (URL)<input name="image5" value="${escapeHtml(normaliseProductImages(existing.images, existing.image)[4] || '')}"></label></div>
          <div class="upload-field image-path"><label for="productImageFile">Tải một hoặc nhiều ảnh từ máy</label><input id="productImageFile" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadProductImage" type="button">Tải ảnh lên</button></div>
          <label>Màu nền khi chưa có ảnh<input name="bg" type="color" value="${existing.bg}"></label>
          <label>Màu hộp khi chưa có ảnh<input name="box" type="color" value="${existing.box}"></label>
        </div>
        <div class="asset-preview compact" id="productPreview" aria-live="polite"></div>
        <div class="editor-actions">
          <button type="button" class="secondary-button" id="closeProductEditor">Đóng</button>
          <button type="button" class="secondary-button" id="useProductImageAsHero">Dùng ảnh này làm banner</button>
          <button type="submit" class="button primary">Lưu sản phẩm</button>
          ${id ? '<button type="button" class="danger" id="deleteProduct">Xóa sản phẩm</button>' : ''}
        </div>
      </form>
    </section>`;

  const form = $('#productForm');
  AEONRichText.bindAll(form);
  getProductVariants = bindProductVariantEditor(form);
  $('#closeProductEditor').onclick = onCancel;
  setPreview($('#productPreview'), existing.image, 'Chưa chọn ảnh sản phẩm');
  form.elements.image.addEventListener('input', () => setPreview($('#productPreview'), form.elements.image.value, 'Chưa chọn ảnh sản phẩm'));

  $('#uploadProductImage').onclick = async () => {
    const button = $('#uploadProductImage');
    try {
      setBusy(button, true, 'Đang tải...', 'Tải ảnh lên');
      const files = [...$('#productImageFile').files];
      if (!files.length) throw new Error('Hãy chọn ít nhất một ảnh trước khi tải lên.');
      const urls = await Promise.all(files.map(uploadOfficialImage));
      const merged = normaliseProductImages([form.elements.image.value || urls[0], form.elements.images.value, ...urls]);
      form.elements.image.value = merged[0] || '';
      form.elements.images.value = merged.slice(1).join('\n');
      setPreview($('#productPreview'), form.elements.image.value, 'Chưa chọn ảnh sản phẩm');
      if (form.checkValidity()) {
        await saveProduct(form);
        toastAdmin('Ảnh sản phẩm đã được tải lên và đồng bộ.');
      } else {
        toastAdmin('Ảnh đã tải lên. Hoàn thiện thông tin bắt buộc rồi nhấn Lưu sản phẩm.');
      }
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải...', 'Tải ảnh lên');
    }
  };

  $('#useProductImageAsHero').onclick = async () => {
    try {
      const url = normaliseImageUrl(form.elements.image.value);
      if (!url) throw new Error('Hãy chọn hoặc tải ảnh sản phẩm trước.');
      await saveHeroImage(url);
      toastAdmin('Đã dùng ảnh sản phẩm này làm banner và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  form.onsubmit = async event => {
    event.preventDefault();
    try {
      await saveProduct(form);
      onSaved();
      toastAdmin('Đã lưu sản phẩm và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  if (id) {
    $('#deleteProduct').onclick = async () => {
      if (!confirm('Xóa sản phẩm này?')) return;
      try {
        await aeonStore.deleteProduct(id);
        onDeleted();
        toastAdmin('Đã xóa sản phẩm khỏi hệ thống.');
      } catch (error) {
        toastAdmin(error.message);
      }
    };
  }
}

function giftRibbonBackgroundPanel(panel) {
  const ui = aeonStore.ui();
  const storedImage = normaliseImageUrl(ui.giftRibbonBackgroundImage);
  const configuredImage = storedImage === AEON_RETIRED_GIFT_RIBBON_BACKGROUND ? '' : storedImage;
  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor">
      <p class="eyebrow">HÌNH ẢNH ƯU ĐÃI</p>
      <h2>Nền dải hàng tặng</h2>
      <p>Thay ảnh nền riêng của dải hàng tặng. Nơ, nội dung và ảnh quà trên từng sản phẩm vẫn giữ nguyên.</p>
      <form id="giftRibbonBackgroundForm">
        <label>Đường dẫn ảnh nền<input name="giftRibbonBackgroundImage" value="${escapeHtml(configuredImage)}" placeholder="https://... hoặc /assets/uploads/ten-anh.png"></label>
        <div class="upload-field"><label for="giftRibbonBackgroundFile">Tải ảnh nền từ máy (PNG, JPG, WEBP, GIF hoặc SVG)</label><input id="giftRibbonBackgroundFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadGiftRibbonBackground" type="button">Tải và lưu ảnh nền</button></div>
        <div class="asset-preview" id="giftRibbonBackgroundPreview" aria-live="polite"></div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu ảnh nền dải</button><button class="secondary-button" type="button" id="resetGiftRibbonBackground">Xóa ảnh nền</button></div>
      </form>
    </section>`);
  const form = $('#giftRibbonBackgroundForm');
  const imageInput = form.elements.giftRibbonBackgroundImage;
  const preview = $('#giftRibbonBackgroundPreview');
  const updatePreview = () => setPreview(preview, imageInput.value, 'Chưa chọn ảnh nền dải hàng tặng');
  updatePreview();
  imageInput.addEventListener('input', updatePreview);
  $('#uploadGiftRibbonBackground').onclick = async () => {
    const button = $('#uploadGiftRibbonBackground');
    try {
      setBusy(button, true, 'Đang tải và lưu...', 'Tải và lưu ảnh nền');
      const url = await uploadOfficialImage($('#giftRibbonBackgroundFile').files[0]);
      if (!url) throw new Error('Hãy chọn ảnh nền trước khi tải lên.');
      const saved = await saveGiftRibbonBackground(url);
      imageInput.value = saved;
      updatePreview();
      toastAdmin('Đã lưu ảnh nền dải hàng tặng và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải và lưu...', 'Tải và lưu ảnh nền');
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      const saved = await saveGiftRibbonBackground(imageInput.value);
      imageInput.value = saved;
      updatePreview();
      toastAdmin(saved ? 'Đã lưu ảnh nền dải hàng tặng và đồng bộ website.' : 'Đã xóa ảnh nền. Dải hàng tặng dùng nền đỏ đơn giản.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
  $('#resetGiftRibbonBackground').onclick = async () => {
    try {
      const saved = await saveGiftRibbonBackground('');
      imageInput.value = saved;
      updatePreview();
      toastAdmin('Đã xóa ảnh nền cũ. Dải hàng tặng dùng nền đỏ đơn giản.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}
function interfacePanel(panel) {
  const ui = aeonStore.ui();
  const catalogProducts = aeonStore.products();
  const savedCatalogProductIds = Array.isArray(ui.catalogProductIds)
    ? new Set(ui.catalogProductIds.map(String))
    : null;
  const catalogProductLimit = Math.max(1, Math.min(9999, Math.floor(Number(ui.catalogProductLimit) || catalogProducts.length || 1)));
  const catalogColumns = [3, 4, 5].includes(Number(ui.catalogColumns)) ? Number(ui.catalogColumns) : 5;
  const catalogMoreProductsUrl = (() => {
    try {
      const url = new URL(ui.catalogMoreProductsUrl || 'https://blackfriday.tinhgon.xyz');
      if (url.hostname.toLowerCase() === 'aeonblackfriday.tinhgon.xyz') url.hostname = 'blackfriday.tinhgon.xyz';
      return url.href;
    } catch {
      return 'https://blackfriday.tinhgon.xyz';
    }
  })();
  panel.innerHTML = `
    <section class="admin-card editor">
      <p class="eyebrow">NỘI DUNG TRANG CHỦ</p>
      <h2>Nội dung trang chủ</h2>
      <p class="admin-card-description">Chỉnh nội dung trang chủ và thông tin hotline, hướng dẫn đặt hàng, đường dẫn sản phẩm cùng mã QR dùng trong catalog PDF. Logo và danh mục sản phẩm được quản lý riêng trong mục “Danh mục & logo”.</p>
      <form id="uiForm">
        <div class="admin-form-grid one">
          <label>Hiển thị khu vực hero<select name="heroDisplayMode"><option value="content-image"${normaliseHeroDisplayMode(ui.heroDisplayMode) === 'content-image' ? ' selected' : ''}>Hiển thị nội dung và hình ảnh</option><option value="image-only"${normaliseHeroDisplayMode(ui.heroDisplayMode) === 'image-only' ? ' selected' : ''}>Chỉ hiển thị hình ảnh</option></select><small>Ảnh banner phủ toàn bộ chiều cao hero và chừa lề theo giao diện.</small></label>
          <label>Nhãn chiến dịch<input name="eyebrow" required value="${escapeHtml(ui.eyebrow)}"></label>
          <label>Ngày/thời gian chạy khuyến mãi<input name="campaignSchedule" maxlength="80" value="${escapeHtml(ui.campaignSchedule || '')}" placeholder="Ví dụ: 25/11 – 01/12/2026"></label>
          <label>Tiêu đề hero<textarea name="title" required rows="2">${escapeHtml(ui.title)}</textarea></label>
          <label>Giới thiệu hero<textarea name="intro" required rows="3">${escapeHtml(ui.intro)}</textarea></label>
          <label>Tiêu đề khu vực ưu đãi<input name="promotionTitle" maxlength="80" required value="${escapeHtml(ui.promotionTitle)}"></label>
          <div class="promotion-richtext-field"><span>Nội dung ưu đãi mùa trăng</span>${window.AEONPromotionRichText?.editorMarkup({name:'promotionText', value:ui.promotionText, limit:6000}) || `<textarea name="promotionText" maxlength="6000" required rows="5">${escapeHtml(ui.promotionText)}</textarea>`}</div>
          <p class="eyebrow">THÔNG TIN LIÊN HỆ TRONG CATALOG</p>
          <label>Hotline<input name="catalogHotline" maxlength="50" value="${escapeHtml(ui.catalogHotline ?? '0327 747 337')}" placeholder="Ví dụ: 0327 747 337"></label>
          <label>Nội dung cạnh mã QR<input name="catalogOrderPrompt" maxlength="120" required value="${escapeHtml(ui.catalogOrderPrompt || 'Quét mã đặt hàng & xem thêm sản phẩm')}"></label>
          <label>Đường dẫn xem thêm sản phẩm<input name="catalogMoreProductsUrl" type="url" maxlength="500" required value="${escapeHtml(catalogMoreProductsUrl)}" placeholder="https://..."></label>
          <label>Đường dẫn poster bìa catalog<input name="catalogBannerImage" required value="${escapeHtml(ui.catalogBannerImage || '/assets/catalog/black-friday-catalog-banner.jpg')}" placeholder="https://... hoặc /assets/uploads/poster.png"><small>Ảnh ngang dùng làm poster mở đầu catalog.</small></label>
          <div class="upload-field"><label for="catalogBannerImageFile">Tải poster bìa PNG/JPG từ máy</label><input id="catalogBannerImageFile" type="file" accept="image/png,image/jpeg"><button class="secondary-button" id="uploadCatalogBannerImage" type="button">Tải và lưu poster bìa</button></div>
          <div class="asset-preview" id="catalogBannerImagePreview" aria-live="polite"></div>
          <label>Đường dẫn ảnh mã QR<input name="catalogOrderQrImage" required value="${escapeHtml(ui.catalogOrderQrImage || '/assets/catalog/order-qr.png')}" placeholder="https://... hoặc /assets/uploads/ma-qr.png"><small>QR luôn hiển thị trên poster bìa và khu vực liên hệ cuối.</small></label>
          <div class="upload-field"><label for="catalogOrderQrFile">Tải ảnh mã QR PNG/JPG từ máy</label><input id="catalogOrderQrFile" type="file" accept="image/png,image/jpeg"><button class="secondary-button" id="uploadCatalogOrderQr" type="button">Tải và lưu mã QR</button></div>
          <div class="asset-preview" id="catalogOrderQrPreview" aria-live="polite"></div>
        </div>
        <fieldset class="catalog-pdf-settings">
          <legend>THIẾT LẬP CATALOG PDF</legend>
          <p>Poster bìa và QR luôn hiển thị. Poster trang cuối đã bỏ; sức chứa mỗi trang được tính theo số cột. Danh sách sản phẩm giữ thứ tự Excel.</p>
          <div class="catalog-pdf-options">
            <label>Số cột sản phẩm<select name="catalogColumns"><option value="3"${catalogColumns === 3 ? ' selected' : ''}>3 cột</option><option value="4"${catalogColumns === 4 ? ' selected' : ''}>4 cột</option><option value="5"${catalogColumns === 5 ? ' selected' : ''}>5 cột</option></select></label>
            <label>Số sản phẩm tối đa<input name="catalogProductLimit" type="number" min="1" max="9999" step="1" value="${catalogProductLimit}"><small>Catalog lấy tối đa số sản phẩm đã chọn, theo thứ tự Excel.</small></label>
          </div>
          <div class="catalog-product-picker-head"><strong>Sản phẩm đưa vào catalog</strong><span id="catalogProductSelectionCount" aria-live="polite"></span></div>
          <div class="catalog-product-picker-tools"><input type="search" id="catalogProductSearch" placeholder="Tìm tên hoặc thương hiệu..." aria-label="Tìm sản phẩm trong danh sách catalog"><button type="button" class="secondary-button" id="selectAllCatalogProducts">Chọn tất cả</button><button type="button" class="secondary-button" id="clearCatalogProducts">Bỏ chọn tất cả</button></div>
          <div class="catalog-product-picker" id="catalogProductPicker">
            ${catalogProducts.length ? catalogProducts.map(product => {
              const productId = String(product.id ?? '');
              const checked = savedCatalogProductIds ? savedCatalogProductIds.has(productId) : true;
              return `<label class="catalog-product-option"><input type="checkbox" data-catalog-product value="${escapeHtml(productId)}"${checked ? ' checked' : ''}><span><b>${escapeHtml(product.name || 'Sản phẩm chưa có tên')}</b><small>${escapeHtml(normaliseAeonBrand(product.brand) || 'Chưa chọn thương hiệu')} · ${escapeHtml(product.sku || product.id || '')}</small></span></label>`;
            }).join('') : '<p class="catalog-product-empty">Chưa có sản phẩm. Hãy tải danh sách sản phẩm lên trước.</p>'}
          </div>
        </fieldset>
        <button class="button primary" type="submit">Lưu giao diện</button>
      </form>
    </section>`;
  window.AEONPromotionRichText?.bindAll(panel);
  const form = $('#uiForm');
  const catalogBannerInput = form.elements.catalogBannerImage;
  const qrInput = form.elements.catalogOrderQrImage;
  const catalogProductLimitInput = form.elements.catalogProductLimit;
  const catalogColumnsInput = form.elements.catalogColumns;
  const catalogProductChecks = [...panel.querySelectorAll('[data-catalog-product]')];
  setPreview($('#catalogBannerImagePreview'), catalogBannerInput.value, 'Chưa chọn poster bìa catalog');
  setPreview($('#catalogOrderQrPreview'), qrInput.value, 'Chưa chọn mã QR đặt hàng');
  const updateCatalogProductCount = () => {
    const selectedCount = catalogProductChecks.filter(input => input.checked).length;
    const maxCount = Math.max(1, Math.floor(Number(catalogProductLimitInput.value) || catalogProducts.length || 1));
    const exportedCount = Math.min(selectedCount, maxCount);
    const notExportedCount = Math.max(0, selectedCount - exportedCount);
    const columns = Number(catalogColumnsInput.value);
    const capacity = {3:{cover:6,later:9},4:{cover:12,later:16},5:{cover:20,later:25}}[columns] || {cover:20,later:25};
    const productPages = exportedCount <= capacity.cover ? 1 : 1 + Math.ceil((exportedCount - capacity.cover) / capacity.later);
    const coverRemaining = Math.max(0, capacity.cover - Math.min(exportedCount, capacity.cover));
    $('#catalogProductSelectionCount').textContent = `${selectedCount} đã chọn · xuất ${exportedCount} sản phẩm / ${productPages} trang sản phẩm · còn ${notExportedCount} sản phẩm ngoài giới hạn · trang bìa còn ${coverRemaining} chỗ (tối đa ${capacity.cover}); trang sau tối đa ${capacity.later}`;
  };
  catalogProductChecks.forEach(input => input.addEventListener('change', updateCatalogProductCount));
  catalogProductLimitInput.addEventListener('input', updateCatalogProductCount);
  catalogColumnsInput.addEventListener('change', updateCatalogProductCount);
  $('#catalogProductSearch').addEventListener('input', event => {
    const query = String(event.currentTarget.value || '').trim().toLocaleLowerCase('vi');
    panel.querySelectorAll('.catalog-product-option').forEach(option => {
      option.hidden = Boolean(query) && !option.textContent.toLocaleLowerCase('vi').includes(query);
    });
  });
  $('#selectAllCatalogProducts').onclick = () => { catalogProductChecks.forEach(input => { input.checked = true; }); updateCatalogProductCount(); };
  $('#clearCatalogProducts').onclick = () => { catalogProductChecks.forEach(input => { input.checked = false; }); updateCatalogProductCount(); };
  updateCatalogProductCount();
  catalogBannerInput.addEventListener('input', () => setPreview($('#catalogBannerImagePreview'), catalogBannerInput.value, 'Chưa chọn poster bìa catalog'));
  qrInput.addEventListener('input', () => setPreview($('#catalogOrderQrPreview'), qrInput.value, 'Chưa chọn mã QR đặt hàng'));
  $('#uploadCatalogBannerImage').onclick = async () => {
    const button = $('#uploadCatalogBannerImage');
    const file = $('#catalogBannerImageFile').files[0];
    try {
      if (!file) throw new Error('Hãy chọn poster bìa PNG hoặc JPG trước.');
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Poster bìa cần là PNG hoặc JPG để xuất PDF rõ nét.');
      setBusy(button, true, 'Đang tải poster...', 'Tải và lưu poster bìa');
      catalogBannerInput.value = await uploadOfficialImage(file);
      setPreview($('#catalogBannerImagePreview'), catalogBannerInput.value, 'Chưa chọn poster bìa catalog');
      form.requestSubmit();
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải poster...', 'Tải và lưu poster bìa');
    }
  };
  $('#uploadCatalogOrderQr').onclick = async () => {
    const button = $('#uploadCatalogOrderQr');
    const file = $('#catalogOrderQrFile').files[0];
    try {
      if (!file) throw new Error('Hãy chọn ảnh mã QR PNG hoặc JPG trước.');
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Mã QR cần là ảnh PNG hoặc JPG để xuất PDF rõ nét.');
      setBusy(button, true, 'Đang tải ảnh QR...', 'Tải và lưu mã QR');
      qrInput.value = await uploadOfficialImage(file);
      setPreview($('#catalogOrderQrPreview'), qrInput.value, 'Chưa chọn mã QR đặt hàng');
      form.requestSubmit();
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải ảnh QR...', 'Tải và lưu mã QR');
    }
  };
  $('#uiForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const latestUi = (await remoteState())['aeon-ui'] || {};
      const catalogHotline = String(values.catalogHotline || '').trim().slice(0, 50);
      const catalogOrderPrompt = String(values.catalogOrderPrompt || '').trim().slice(0, 120);
      const rawCatalogBannerImage = String(values.catalogBannerImage || '').trim();
      const catalogBannerImage = normaliseImageUrl(rawCatalogBannerImage);
      if (!catalogBannerImage) throw new Error('Hãy nhập đường dẫn poster bìa hợp lệ hoặc tải ảnh PNG/JPG lên.');
      const rawCatalogQrImage = String(values.catalogOrderQrImage || '').trim();
      const catalogOrderQrImage = normaliseImageUrl(rawCatalogQrImage);
      if (!catalogOrderQrImage) throw new Error('Hãy nhập đường dẫn ảnh mã QR hợp lệ hoặc tải ảnh PNG/JPG lên.');
      const selectedCatalogProductIds = catalogProductChecks.filter(input => input.checked).map(input => input.value);
      if (catalogProducts.length && !selectedCatalogProductIds.length) throw new Error('Hãy chọn ít nhất một sản phẩm để xuất catalog.');
      const catalogProductIds = catalogProducts.length && selectedCatalogProductIds.length < catalogProducts.length
        ? selectedCatalogProductIds
        : null;
      const catalogProductLimit = Number(values.catalogProductLimit);
      if (!Number.isInteger(catalogProductLimit) || catalogProductLimit < 1 || catalogProductLimit > 9999) throw new Error('Số sản phẩm tối đa cần nằm trong khoảng 1 đến 9.999.');
      const catalogColumns = Number(values.catalogColumns);
      if (![3, 4, 5].includes(catalogColumns)) throw new Error('Catalog chỉ hỗ trợ bố cục 3, 4 hoặc 5 cột.');
      let catalogMoreProductsUrl = '';
      try {
        const link = new URL(String(values.catalogMoreProductsUrl || '').trim());
        if (!['http:', 'https:'].includes(link.protocol)) throw new Error('invalid protocol');
        catalogMoreProductsUrl = link.href;
      } catch {
        throw new Error('Hãy nhập đường dẫn xem thêm sản phẩm bắt đầu bằng http:// hoặc https://.');
      }
      const nextUi = {
        ...aeonStore.ui(),
        ...latestUi,
        ...values,
        heroDisplayMode: normaliseHeroDisplayMode(values.heroDisplayMode),
        catalogHotline,
        catalogOrderPrompt,
        catalogMoreProductsUrl,
        catalogBannerImage,
        catalogOrderQrImage,
        catalogClosingImage: '',
        catalogProductIds,
        catalogProductLimit,
        catalogColumns,
        catalogShowCoverPoster: true,
        catalogShowClosingPoster: false,
        catalogShowQr: true,
        promotionText: window.AEONPromotionRichText?.clean(values.promotionText, 6000) || String(values.promotionText || '').replace(/\r\n?/g, '\n').trim().slice(0, 6000)
      };
      await saveShared('aeon-ui', nextUi);
      const confirmedUi = (await remoteState())['aeon-ui'] || {};
      const fieldsToConfirm = [...new Set([
        ...Object.keys(values),
        'catalogBannerImage', 'catalogOrderQrImage', 'catalogClosingImage',
        'catalogProductIds', 'catalogProductLimit', 'catalogColumns',
        'catalogShowCoverPoster', 'catalogShowClosingPoster', 'catalogShowQr'
      ])];
      const missedField = fieldsToConfirm.find(key => JSON.stringify(confirmedUi[key]) !== JSON.stringify(nextUi[key]));
      if (missedField) {
        await aeonStore.pull();
        throw new Error('Máy chủ chưa xác nhận đủ cài đặt giao diện. Hãy tải lại mục Giao diện và thử lưu lại.');
      }
      localStorage.setItem('aeon-ui', JSON.stringify(confirmedUi));
      renderAeonBrandLogos(confirmedUi);
      window.dispatchEvent(new Event('aeon-store-sync'));
      toastAdmin('Đã lưu nội dung giao diện và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
  giftRibbonBackgroundPanel(panel);
}

function brandGroupEditorMarkup(group = {}) {
  const brands = (Array.isArray(group.brands) ? group.brands : []).map(brand => brand?.name || brand).filter(Boolean);
  return `<article class="brand-settings-group" data-brand-group data-brand-group-id="${escapeHtml(group.id || '')}">
    <header><label>Tên nhóm thương hiệu<input data-brand-group-name maxlength="100" required value="${escapeHtml(group.name || '')}" placeholder="Ví dụ: Thương hiệu nội địa"></label><button class="danger" type="button" data-remove-brand-group>Xóa nhóm</button></header>
    <label>Danh sách thương hiệu<textarea data-brand-list rows="6" maxlength="12000" placeholder="Mỗi thương hiệu một dòng">${escapeHtml(brands.join('\n'))}</textarea><small>Nhập mỗi thương hiệu trên một dòng. Thương hiệu đang được sản phẩm sử dụng sẽ không bị mất.</small></label>
  </article>`;
}

function brandGroupsFromEditor(form) {
  const rows = [...form.querySelectorAll('[data-brand-group]')];
  if (!rows.length) throw new Error('Cần có ít nhất một nhóm thương hiệu.');
  if (rows.length > 20) throw new Error('Chỉ được tạo tối đa 20 nhóm thương hiệu.');
  const names = new Set();
  const groups = rows.map((row, index) => {
    const name = String(row.querySelector('[data-brand-group-name]').value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) throw new Error('Mỗi nhóm cần có tên.');
    const brands = String(row.querySelector('[data-brand-list]').value || '')
      .split(/\r?\n/)
      .map(value => value.replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(Boolean)
      .map(brandName => {
        const key = aeonBrandKey(brandName);
        if (names.has(key)) throw new Error(`Thương hiệu "${brandName}" đang bị trùng.`);
        names.add(key);
        return {name: brandName};
      });
    return {
      id: row.dataset.brandGroupId || `brand-group-${Date.now()}-${index + 1}`,
      name,
      brands
    };
  });
  if (names.size > 200) throw new Error('Chỉ được lưu tối đa 200 thương hiệu.');
  return cleanAeonBrandGroups(groups);
}

function brandSettingsPanel(panel) {
  const brands = [...new Set(aeonStore.products()
    .map(product => normaliseAeonBrand(product?.brand))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'vi'));
  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor brand-settings">
      <p class="eyebrow">DANH MỤC THƯƠNG HIỆU</p>
      <h2>Thương hiệu tự động</h2>
      <p>Danh sách này được tạo trực tiếp từ trường <b>Thương hiệu</b> của sản phẩm. Khi thêm, sửa hoặc import sản phẩm, bộ lọc trang chủ sẽ tự cập nhật.</p>
      ${brands.length ? `<div class="brand-auto-list">${brands.map(brand => `<span>${escapeHtml(brand)}</span>`).join('')}</div>` : '<p class="empty-admin">Chưa có thương hiệu. Hãy thêm thương hiệu vào sản phẩm hoặc file Excel.</p>'}
    </section>`);
}

function assetPanel(panel, options = {}) {
  const showLogo = options.logo !== false;
  const showHero = options.hero !== false;
  const ui = aeonStore.ui();
  const sourceImages = [];
  aeonStore.products().forEach(product => {
    const image = normaliseImageUrl(product.image);
    if (image && !sourceImages.some(item => item.image === image)) sourceImages.push({image, name: product.name || 'Ảnh sản phẩm'});
  });

  if (showLogo) panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor logo-asset-editor">
      <p class="eyebrow">NHẬN DIỆN THƯƠNG HIỆU</p>
      <h2>Logo cửa hàng</h2>
      <p>Logo được quản lý riêng với giao diện. Thay đổi theme, màu sắc hoặc bố cục sẽ không làm thay đổi logo này.</p>
      <form id="logoAssetForm">
        <label>Tên logo<input name="logoText" maxlength="32" required value="${escapeHtml(ui.logoText)}" placeholder="Ví dụ: AEON"></label>
        <label>Dòng phụ logo<textarea name="logoSubtitle" maxlength="80" rows="2" placeholder="Ví dụ: BÌNH DƯƠNG&#10;NEW CITY">${escapeHtml(ui.logoSubtitle || '')}</textarea><small>Có thể nhấn Enter để xuống dòng.</small></label>
        <label>Kiểu hiển thị logo<select name="logoMode"><option value="text"${ui.logoMode === 'text' ? ' selected' : ''}>Logo chữ</option><option value="image"${ui.logoMode === 'image' ? ' selected' : ''}>Chỉ dùng ảnh logo</option><option value="image-subtitle"${ui.logoMode === 'image-subtitle' ? ' selected' : ''}>Ảnh logo và dòng phụ</option></select></label>
        <label>Đường dẫn ảnh logo<input name="logoImage" value="${escapeHtml(ui.logoImage || '')}" placeholder="https://... hoặc /assets/uploads/logo.png"></label>
        <label>Icon website (favicon)<input name="faviconImage" value="${escapeHtml(ui.faviconImage || '')}" placeholder="https://... hoặc /assets/uploads/favicon.png"><small>Icon hiển thị cạnh tên website trên trình duyệt.</small></label>
        <div class="upload-field"><label for="logoImageFile">Tải ảnh logo từ máy (PNG, JPG, WEBP, GIF hoặc SVG)</label><input id="logoImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadLogoImage" type="button">Tải và dùng logo</button></div>
        <div class="asset-preview logo-preview" id="logoPreview" aria-live="polite"></div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu ảnh logo</button><button class="danger" type="button" id="clearLogoImage">Bỏ ảnh logo</button></div>
      </form>
    </section>`);

  if (showLogo) {
  const logoForm = $('#logoAssetForm');
  setPreview($('#logoPreview'), ui.logoImage, 'Chưa chọn ảnh logo');
  logoForm.elements.logoImage.addEventListener('input', () => setPreview($('#logoPreview'), logoForm.elements.logoImage.value, 'Chưa chọn ảnh logo'));

  $('#uploadLogoImage').onclick = async () => {
    const button = $('#uploadLogoImage');
    try {
      setBusy(button, true, 'Đang tải và lưu...', 'Tải và dùng logo');
      const url = await uploadOfficialImage($('#logoImageFile').files[0]);
      if (!url) throw new Error('Hãy chọn ảnh logo trước khi tải lên.');
      logoForm.elements.logoImage.value = url;
      const currentMode = normaliseLogoMode(logoForm.elements.logoMode.value);
      const saved = await saveLogoSettings({logoText: logoForm.elements.logoText.value, logoSubtitle: logoForm.elements.logoSubtitle.value, logoImage: url, logoMode: currentMode === 'text' ? 'image' : currentMode});
      logoForm.elements.logoImage.value = saved.logoImage;
      setPreview($('#logoPreview'), saved.logoImage, 'Chưa chọn ảnh logo');
      toastAdmin('Đã lưu ảnh logo và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải và lưu...', 'Tải và dùng logo');
    }
  };

  logoForm.onsubmit = async event => {
    event.preventDefault();
    try {
      const image = normaliseImageUrl(logoForm.elements.logoImage.value);
      const currentMode = normaliseLogoMode(logoForm.elements.logoMode.value);
      const saved = await saveLogoSettings({logoText: logoForm.elements.logoText.value, logoSubtitle: logoForm.elements.logoSubtitle.value, logoImage: image, faviconImage: logoForm.elements.faviconImage.value, logoMode: image && currentMode === 'text' ? 'image' : currentMode});
      logoForm.elements.logoImage.value = saved.logoImage;
      setPreview($('#logoPreview'), saved.logoImage, 'Chưa chọn ảnh logo');
      toastAdmin('Đã lưu ảnh logo và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearLogoImage').onclick = async () => {
    try {
      await saveLogoSettings({logoText: logoForm.elements.logoText.value, logoSubtitle: logoForm.elements.logoSubtitle.value, logoImage: ''});
      logoForm.elements.logoImage.value = '';
      setPreview($('#logoPreview'), '', 'Chưa chọn ảnh logo');
      toastAdmin('Đã bỏ ảnh logo. Website sẽ dùng logo chữ.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
  }

  if (!showHero) return;

  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor">
      <p class="eyebrow">HÌNH ẢNH CHÍNH THỨC</p>
      <h2>Ảnh banner đầu trang</h2>
      <p>Ảnh chỉ được báo thành công sau khi đã lưu vào máy chủ. Chọn ảnh từ máy, dán đường dẫn online, hoặc dùng lại ảnh sản phẩm.</p>
      <form id="assetForm">
        <label>Đường dẫn ảnh banner<input name="heroImage" value="${escapeHtml(ui.heroImage || '')}" placeholder="https://... hoặc /assets/uploads/ten-banner.png"></label>
        <div class="upload-field"><label for="heroImageFile">Tải ảnh banner từ máy (PNG, JPG, WEBP, GIF hoặc SVG)</label><input id="heroImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadHeroImage" type="button">Tải và lưu banner</button></div>
        ${sourceImages.length ? `<label class="saved-image-picker">Dùng ảnh đã tải lên trong sản phẩm<select id="savedHeroImage"><option value="">Chọn ảnh sản phẩm…</option>${sourceImages.map(item => `<option value="${escapeHtml(item.image)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><button class="secondary-button" id="useSavedHeroImage" type="button">Dùng ảnh đã chọn làm banner</button>` : ''}
        <div class="asset-preview" id="heroPreview" aria-live="polite"></div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu ảnh banner</button><button class="danger" type="button" id="clearHeroImage">Bỏ ảnh</button></div>
      </form>
    </section>`);

  const form = $('#assetForm');
  setPreview($('#heroPreview'), ui.heroImage);
  form.elements.heroImage.addEventListener('input', () => setPreview($('#heroPreview'), form.elements.heroImage.value));

  $('#uploadHeroImage').onclick = async () => {
    const button = $('#uploadHeroImage');
    try {
      setBusy(button, true, 'Đang tải và lưu...', 'Tải và lưu banner');
      const url = await uploadOfficialImage($('#heroImageFile').files[0]);
      if (!url) throw new Error('Hãy chọn ảnh trước khi tải lên.');
      form.elements.heroImage.value = url;
      await saveHeroImage(url);
      setPreview($('#heroPreview'), url);
      toastAdmin('Đã lưu ảnh banner và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải và lưu...', 'Tải và lưu banner');
    }
  };

  const useSaved = $('#useSavedHeroImage');
  if (useSaved) {
    useSaved.onclick = async () => {
      try {
        const url = normaliseImageUrl($('#savedHeroImage').value);
        if (!url) throw new Error('Hãy chọn một ảnh sản phẩm trước.');
        form.elements.heroImage.value = url;
        await saveHeroImage(url);
        setPreview($('#heroPreview'), url);
        toastAdmin('Đã dùng ảnh sản phẩm làm banner và đồng bộ website.');
      } catch (error) {
        toastAdmin(error.message);
      }
    };
  }

  form.onsubmit = async event => {
    event.preventDefault();
    try {
      const url = await saveHeroImage(form.elements.heroImage.value);
      form.elements.heroImage.value = url;
      setPreview($('#heroPreview'), url);
      toastAdmin('Đã lưu ảnh banner và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearHeroImage').onclick = async () => {
    try {
      await saveHeroImage('');
      form.elements.heroImage.value = '';
      setPreview($('#heroPreview'), '');
      toastAdmin('Đã bỏ ảnh banner.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor quote-file-editor">
      <p class="eyebrow">FILE BÁO GIÁ</p>
      <h2>Excel và PDF tải xuống</h2>
      <p>Tải lên tối đa một tệp Excel và một tệp PDF. Nút báo giá trên trang chủ sẽ cho khách chọn định dạng đang có.</p>
      <form id="quoteAssetForm">
        <div class="quote-file-grid">
          <section class="quote-file-card">
            <h3>File Excel</h3>
            <label>Đường dẫn tệp Excel<input name="quoteExcelUrl" value="${escapeHtml(ui.quoteExcelUrl || '')}" placeholder="/assets/uploads/quotes/bao-gia.xlsx"></label>
            <div class="upload-field"><label for="quoteExcelFile">Chọn tệp Excel (.xlsx hoặc .xls, tối đa 20 MB)</label><input id="quoteExcelFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"><button class="secondary-button" id="uploadQuoteExcel" type="button">Tải Excel lên</button></div>
            <p class="quote-file-status" id="quoteExcelStatus" aria-live="polite"></p>
            <button class="danger quote-clear-file" id="clearQuoteExcel" type="button">Bỏ file Excel</button>
          </section>
          <section class="quote-file-card">
            <h3>File PDF</h3>
            <label>Đường dẫn tệp PDF<input name="quotePdfUrl" value="${escapeHtml(ui.quotePdfUrl || '')}" placeholder="/assets/uploads/quotes/bao-gia.pdf"></label>
            <div class="upload-field"><label for="quotePdfFile">Chọn tệp PDF (.pdf, tối đa 20 MB)</label><input id="quotePdfFile" type="file" accept=".pdf,application/pdf"><button class="secondary-button" id="uploadQuotePdf" type="button">Tải PDF lên</button></div>
            <p class="quote-file-status" id="quotePdfStatus" aria-live="polite"></p>
            <button class="danger quote-clear-file" id="clearQuotePdf" type="button">Bỏ file PDF</button>
          </section>
        </div>
        <button class="button primary" type="submit">Lưu đường dẫn file báo giá</button>
      </form>
    </section>`);

  const quoteForm = $('#quoteAssetForm');
  const syncQuoteForm = saved => {
    quoteForm.elements.quoteExcelUrl.value = saved.quoteExcelUrl || '';
    quoteForm.elements.quotePdfUrl.value = saved.quotePdfUrl || '';
    setQuoteFileStatus($('#quoteExcelStatus'), saved.quoteExcelUrl, 'Excel');
    setQuoteFileStatus($('#quotePdfStatus'), saved.quotePdfUrl, 'PDF');
  };
  syncQuoteForm(ui);

  $('#uploadQuoteExcel').onclick = async () => {
    const button = $('#uploadQuoteExcel');
    try {
      setBusy(button, true, 'Đang tải Excel...', 'Tải Excel lên');
      const url = await uploadQuoteFile($('#quoteExcelFile').files[0], 'excel');
      const saved = await saveQuoteFiles({quoteExcelUrl: url});
      syncQuoteForm(saved);
      toastAdmin('Đã tải và lưu file báo giá Excel.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải Excel...', 'Tải Excel lên');
    }
  };

  $('#uploadQuotePdf').onclick = async () => {
    const button = $('#uploadQuotePdf');
    try {
      setBusy(button, true, 'Đang tải PDF...', 'Tải PDF lên');
      const url = await uploadQuoteFile($('#quotePdfFile').files[0], 'pdf');
      const saved = await saveQuoteFiles({quotePdfUrl: url});
      syncQuoteForm(saved);
      toastAdmin('Đã tải và lưu file báo giá PDF.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải PDF...', 'Tải PDF lên');
    }
  };

  quoteForm.onsubmit = async event => {
    event.preventDefault();
    try {
      const saved = await saveQuoteFiles({
        quoteExcelUrl: quoteForm.elements.quoteExcelUrl.value,
        quotePdfUrl: quoteForm.elements.quotePdfUrl.value
      });
      syncQuoteForm(saved);
      toastAdmin('Đã lưu các file báo giá và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearQuoteExcel').onclick = async () => {
    try {
      syncQuoteForm(await saveQuoteFiles({quoteExcelUrl: ''}));
      toastAdmin('Đã bỏ file báo giá Excel.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearQuotePdf').onclick = async () => {
    try {
      syncQuoteForm(await saveQuoteFiles({quotePdfUrl: ''}));
      toastAdmin('Đã bỏ file báo giá PDF.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

function formatLayoutBannerRatio(value) {
  const ratio = Number(value) || AEON_DEFAULT_LAYOUT.bannerAspectRatio;
  return `${ratio.toFixed(2).replace(/\.?0+$/, '')}:1`;
}

function layoutFontFamilyOptions(value) {
  const fontFamilies = {
    'aeon-default': 'Mặc định AEON',
    'be-vietnam-pro': 'Be Vietnam Pro',
    'playfair-display': 'Playfair Display',
    arial: 'Arial',
    georgia: 'Georgia'
  };
  const selected = Object.hasOwn(fontFamilies, String(value || '').trim()) ? String(value).trim() : AEON_DEFAULT_LAYOUT.fontFamily;
  return Object.entries(fontFamilies)
    .map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function layoutPanel(panel) {
  const layout = aeonStore.layout();
  const alignOptions = (value, stretch = false) => `
    <option value="left" ${value === 'left' ? 'selected' : ''}>Căn trái</option>
    <option value="center" ${value === 'center' ? 'selected' : ''}>Căn giữa</option>
    <option value="right" ${value === 'right' ? 'selected' : ''}>Căn phải</option>
    ${stretch ? `<option value="stretch" ${value === 'stretch' ? 'selected' : ''}>Toàn chiều rộng</option>` : ''}`;
  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor layout-editor">
      <p class="eyebrow">MÀU SẮC, BỐ CỤC & CHỮ</p>
      <h2>Điều chỉnh giao diện</h2>
      <p>Đổi màu chủ đạo, màu nền và kích thước từng khu vực. Các thay đổi cũng có thể chỉnh nhanh ngay trên màn hình chính khi đang đăng nhập.</p>
      <form id="layoutForm">
        <div class="admin-form-grid">
          <label>Màu chủ đạo<input name="accentColor" type="color" value="${layout.accentColor}"></label>
          <label>Màu chủ đạo đậm<input name="accentDarkColor" type="color" value="${layout.accentDarkColor}"></label>
          <label>Màu nền trang<input name="pageBackgroundColor" type="color" value="${layout.pageBackgroundColor}"></label>
          <label>Màu nền khu vực nội dung<input name="sectionBackgroundColor" type="color" value="${layout.sectionBackgroundColor}"></label>
          <label>Màu chữ chính<input name="textColor" type="color" value="${layout.textColor}"></label>
          <label>Font chữ giao diện<select name="fontFamily">${layoutFontFamilyOptions(layout.fontFamily)}</select></label>
          <label>Cỡ tiêu đề hero <output data-output="heroTitleSize">${layout.heroTitleSize}px</output><input class="layout-range" type="range" name="heroTitleSize" min="10" max="90" step="1" value="${layout.heroTitleSize}"></label>
          <label>Cỡ mô tả hero <output data-output="heroIntroSize">${layout.heroIntroSize}px</output><input class="layout-range" type="range" name="heroIntroSize" min="12" max="22" step="1" value="${layout.heroIntroSize}"></label>
          <label>Tỷ lệ banner desktop (chỉ đổi chiều ngang) <output data-output="bannerAspectRatio">${formatLayoutBannerRatio(layout.bannerAspectRatio)}</output><input class="layout-range" type="range" name="bannerAspectRatio" min="1.5" max="4" step="any" value="${layout.bannerAspectRatio}" data-output-format="ratio"></label>
          <label>Vị trí nút hero<select name="heroButtonAlign">${alignOptions(layout.heroButtonAlign)}</select></label>
          <label>Cỡ tên sản phẩm <output data-output="productTitleSize">${layout.productTitleSize}px</output><input class="layout-range" type="range" name="productTitleSize" min="12" max="24" step="1" value="${layout.productTitleSize}"></label>
          <label>Chiều cao thanh đầu trang <output data-output="headerHeight">${layout.headerHeight}px</output><input class="layout-range" type="range" name="headerHeight" min="10" max="112" step="1" value="${layout.headerHeight}"></label>
          <label>Chiều cao hero <output data-output="heroHeight">${layout.heroHeight ? `${layout.heroHeight}px` : 'Tự động'}</output><input class="layout-range" type="range" name="heroHeight" min="0" max="700" step="10" value="${layout.heroHeight}" data-auto-label="Tự động"></label>
          <label>Khoảng cách đầu/cuối các khu vực <output data-output="sectionSpacing">${layout.sectionSpacing ? `${layout.sectionSpacing}px` : 'Tự động'}</output><input class="layout-range" type="range" name="sectionSpacing" min="0" max="170" step="5" value="${layout.sectionSpacing}" data-auto-label="Tự động"></label>
          <label>Chiều cao ảnh sản phẩm <output data-output="productImageHeight">${layout.productImageHeight ? `${layout.productImageHeight}px` : 'Tự động'}</output><input class="layout-range" type="range" name="productImageHeight" min="0" max="480" step="10" value="${layout.productImageHeight}" data-auto-label="Tự động"></label>
          <label>Số cột sản phẩm trên desktop<select name="productColumns"><option value="0"${Number(layout.productColumns) === 0 ? ' selected' : ''}>Tự động</option><option value="1"${Number(layout.productColumns) === 1 ? ' selected' : ''}>1 cột</option><option value="2"${Number(layout.productColumns) === 2 ? ' selected' : ''}>2 cột</option><option value="3"${Number(layout.productColumns) === 3 ? ' selected' : ''}>3 cột</option><option value="4"${Number(layout.productColumns) === 4 ? ' selected' : ''}>4 cột</option><option value="5"${Number(layout.productColumns) === 5 ? ' selected' : ''}>5 cột</option><option value="6"${Number(layout.productColumns) === 6 ? ' selected' : ''}>6 cột</option></select></label>
          <label>Số cột sản phẩm trên mobile<select name="productColumnsMobile"><option value="0"${Number(layout.productColumnsMobile) === 0 ? ' selected' : ''}>Tự động</option><option value="1"${Number(layout.productColumnsMobile) === 1 ? ' selected' : ''}>1 cột</option><option value="2"${Number(layout.productColumnsMobile) === 2 ? ' selected' : ''}>2 cột</option></select></label>
          <label>Cỡ logo <output data-output="logoSize">${layout.logoSize}px</output><input class="layout-range" type="range" name="logoSize" min="18" max="48" step="1" value="${layout.logoSize}"></label>
          <label>Vị trí nút “Xem chi tiết”<select name="productButtonAlign">${alignOptions(layout.productButtonAlign)}</select></label>
          <label>Vị trí nút đặt hàng<select name="checkoutButtonAlign">${alignOptions(layout.checkoutButtonAlign, true)}</select></label>
        </div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu bố cục</button><button class="danger" type="button" id="resetLayout">Khôi phục mặc định</button></div>
      </form>
    </section>`);
  document.querySelectorAll('.layout-range').forEach(input => {
    input.oninput = () => {
      document.querySelector(`[data-output="${input.name}"]`).textContent = input.dataset.outputFormat === 'ratio'
        ? formatLayoutBannerRatio(input.value)
        : (Number(input.value) === 0 && input.dataset.autoLabel ? input.dataset.autoLabel : `${input.value}px`);
    };
  });
  $('#layoutForm').onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    ['heroTitleSize', 'heroIntroSize', 'bannerAspectRatio', 'productTitleSize', 'headerHeight', 'heroHeight', 'sectionSpacing', 'productImageHeight', 'productColumns', 'productColumnsMobile', 'logoSize'].forEach(key => {
      values[key] = Number(values[key]);
    });
    try {
      await saveShared('aeon-layout', {...layout, ...values});
      applyAdminTheme({...layout, ...values});
      toastAdmin('Đã lưu màu sắc, bố cục và kích thước giao diện.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
  $('#resetLayout').onclick = async () => {
    try {
      await saveShared('aeon-layout', AEON_DEFAULT_LAYOUT);
      applyAdminTheme(AEON_DEFAULT_LAYOUT);
      render();
      toastAdmin('Đã khôi phục bố cục mặc định.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

async function downloadCustomerExcel(button) {
  try {
    setBusy(button, true, 'Đang tạo Excel...', 'Xuất Excel');
    const response = await fetch('/api/export/customers.xlsx', {cache: 'no-store'});
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Không thể tạo tệp Excel.');
    }
    const file = await response.blob();
    if (!file.size) throw new Error('Tệp Excel chưa có dữ liệu hợp lệ.');
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'danh-sach-khach-hang.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastAdmin('Đã tải tệp Excel gồm khách hàng và đơn hàng.');
  } catch (error) {
    toastAdmin(error.message);
  } finally {
    setBusy(button, false, 'Đang tạo Excel...', 'Xuất Excel');
  }
}

function accountPermissionCheckboxes(selected = []) {
  const granted = new Set(selected);
  return Object.entries(ADMIN_PERMISSION_LABELS).map(([id, label]) => `
    <label class="account-permission-option"><input type="checkbox" name="permissions" value="${id}"${granted.has(id) ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('');
}

function accountPermissionSummary(permissions = []) {
  const labels = permissions.map(permission => ADMIN_PERMISSION_LABELS[permission]).filter(Boolean);
  return labels.length ? labels.join(' · ') : 'Chưa được cấp quyền';
}

async function accountPanel(panel, editingId = '') {
  panel.innerHTML = '<section class="admin-card"><p class="empty-admin">Đang tải danh sách tài khoản…</p></section>';
  try {
    const response = await fetch('/api/admin/accounts', {cache:'no-store'});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Không thể tải danh sách tài khoản.');
    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    const editing = accounts.find(account => account.id === editingId && !account.isOwner) || null;
    const accountRows = accounts.map(account => {
      const status = account.active ? 'Đang hoạt động' : 'Đã tạm khóa';
      return `<article class="account-row ${account.active ? '' : 'is-disabled'}">
        <div class="account-row-main"><div class="account-row-title"><h3>${escapeHtml(account.displayName || account.username)}</h3>${account.isOwner ? '<span class="account-owner-badge">QUẢN TRỊ CHÍNH</span>' : `<span class="account-status ${account.active ? 'is-active' : ''}">${status}</span>`}</div>
          <p><b>@${escapeHtml(account.username)}</b> · ${escapeHtml(accountPermissionSummary(account.permissions))}</p></div>
        ${account.isOwner ? '<small>Toàn quyền quản trị</small>' : `<div class="account-row-actions"><button class="secondary-button" type="button" data-edit-admin-account="${escapeHtml(account.id)}">Chỉnh sửa</button><button class="danger" type="button" data-toggle-admin-account="${escapeHtml(account.id)}">${account.active ? 'Tạm khóa' : 'Kích hoạt'}</button></div>`}
      </article>`;
    }).join('');

    panel.innerHTML = `
      <section class="admin-card account-editor">
        <p class="eyebrow">TÀI KHOẢN NỘI BỘ</p>
        <h2>${editing ? 'Cập nhật tài khoản con' : 'Tạo tài khoản con'}</h2>
        <p>Tài khoản con chỉ thấy và sử dụng những nhóm chức năng bạn cấp quyền. Tài khoản quản trị chính luôn có toàn quyền.</p>
        <form id="adminAccountForm">
          <div class="admin-form-grid">
            <label>Tên hiển thị<input name="displayName" maxlength="80" required value="${escapeHtml(editing?.displayName || '')}" placeholder="Ví dụ: Nhân viên kinh doanh"></label>
            <label>Tên đăng nhập<input name="username" maxlength="40" ${editing ? 'readonly' : 'required'} value="${escapeHtml(editing?.username || '')}" placeholder="vi-du: sales.aeon" autocomplete="username"><small>3–40 ký tự: chữ thường, số, ., _ hoặc -.</small></label>
            <label class="account-password-field">${editing ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu'}<input name="password" type="password" minlength="8" maxlength="128" ${editing ? '' : 'required'} autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"></label>
            ${editing ? `<label class="account-active-option"><input name="active" type="checkbox"${editing.active ? ' checked' : ''}> <span>Cho phép tài khoản này đăng nhập</span></label>` : ''}
          </div>
          <fieldset class="account-permissions"><legend>Quyền sử dụng chức năng</legend><div class="account-permission-grid">${accountPermissionCheckboxes(editing?.permissions || [])}</div></fieldset>
          <div class="editor-actions"><button class="button primary" type="submit">${editing ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>${editing ? '<button class="secondary-button" id="cancelAccountEdit" type="button">Hủy chỉnh sửa</button>' : ''}</div>
        </form>
      </section>
      <section class="admin-card account-directory"><div class="panel-action"><div><p class="eyebrow">DANH SÁCH QUẢN TRỊ</p><h2>Tài khoản & quyền hiện có</h2></div><span class="account-count">${accounts.length} tài khoản</span></div><div class="account-list">${accountRows || '<p class="empty-admin">Chưa có tài khoản.</p>'}</div></section>`;

    const form = $('#adminAccountForm');
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const values = new FormData(form);
      const permissions = values.getAll('permissions');
      if (!permissions.length) {
        toastAdmin('Hãy chọn ít nhất một quyền sử dụng.');
        return;
      }
      const payload = {
        action: editing ? 'update' : 'create',
        displayName: String(values.get('displayName') || ''),
        permissions,
        password: String(values.get('password') || '')
      };
      if (editing) {
        payload.id = editing.id;
        payload.active = values.get('active') === 'on';
      } else {
        payload.username = String(values.get('username') || '');
      }
      try {
        setBusy(submit, true, editing ? 'Đang lưu…' : 'Đang tạo…', editing ? 'Lưu thay đổi' : 'Tạo tài khoản');
        const saveResponse = await fetch('/api/admin/accounts', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });
        const saved = await saveResponse.json().catch(() => ({}));
        if (!saveResponse.ok) throw new Error(saved.error || 'Không thể lưu tài khoản.');
        await accountPanel(panel);
        toastAdmin(editing ? 'Đã cập nhật tài khoản và quyền sử dụng.' : 'Đã tạo tài khoản con. Hãy gửi tên đăng nhập và mật khẩu cho người dùng qua kênh riêng.');
      } catch (error) {
        toastAdmin(error.message);
      } finally {
        setBusy(submit, false, editing ? 'Đang lưu…' : 'Đang tạo…', editing ? 'Lưu thay đổi' : 'Tạo tài khoản');
      }
    };

    $('#cancelAccountEdit')?.addEventListener('click', () => accountPanel(panel));
    panel.querySelectorAll('[data-edit-admin-account]').forEach(button => {
      button.onclick = () => accountPanel(panel, button.dataset.editAdminAccount);
    });
    panel.querySelectorAll('[data-toggle-admin-account]').forEach(button => {
      button.onclick = async () => {
        const account = accounts.find(item => item.id === button.dataset.toggleAdminAccount);
        if (!account) return;
        try {
          setBusy(button, true, 'Đang lưu…', account.active ? 'Tạm khóa' : 'Kích hoạt');
          const saveResponse = await fetch('/api/admin/accounts', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
              action:'update', id:account.id, displayName:account.displayName,
              permissions:account.permissions, active:!account.active
            })
          });
          const saved = await saveResponse.json().catch(() => ({}));
          if (!saveResponse.ok) throw new Error(saved.error || 'Không thể cập nhật tài khoản.');
          await accountPanel(panel);
          toastAdmin(account.active ? 'Đã tạm khóa tài khoản con.' : 'Đã kích hoạt lại tài khoản con.');
        } catch (error) {
          toastAdmin(error.message);
        } finally {
          setBusy(button, false, 'Đang lưu…', account.active ? 'Tạm khóa' : 'Kích hoạt');
        }
      };
    });
  } catch (error) {
    panel.innerHTML = `<section class="admin-card"><p class="empty-admin">${escapeHtml(error.message || 'Không thể tải danh sách tài khoản.')}</p></section>`;
  }
}

function customersPanel(panel) {
  const customers = aeonStore.customers();
  const orders = aeonStore.orders();
  const syncedOrders = orders.filter(order => order.googleSheetSync?.status === 'synced').length;
  const failedOrders = orders.filter(order => order.googleSheetSync?.status === 'failed').length;
  const pendingOrders = orders.filter(order => order.googleSheetSync?.status === 'pending').length;
  panel.innerHTML = `<section class="admin-card customer-data-card"><h2>Thông tin khách hàng</h2>${customers.length ? `<div class="customer-list">${customers.map(customer => {
    const customerOrders = orders.filter(order => String(order.customerId) === String(customer.id));
    const total = customerOrders.reduce((sum, order) => sum + order.total, 0);
    const orderMarkup = customerOrders.length ? customerOrders.map(order => {
      const itemCount = (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + Math.max(1, Number(item.qty ?? item.quantity) || 1), 0);
      const productNames = (Array.isArray(order.items) ? order.items : []).slice(0, 2).map(item => escapeHtml(item.name || 'Sản phẩm')).join(' · ');
      const moreProducts = Math.max(0, (Array.isArray(order.items) ? order.items.length : 0) - 2);
      const syncStatus = order.googleSheetSync?.status || 'pending';
      const syncLabel = syncStatus === 'synced' ? 'Đã đồng bộ' : syncStatus === 'failed' ? 'Lỗi đồng bộ' : 'Đang chờ';
      const emailStatus = order.emailConfirmation?.status || 'pending';
      const emailLabels = {pending:'Chưa xác nhận', sending:'Đang gửi email…', sent:'Đã gửi email xác nhận', failed:'Gửi email thất bại', uncertain:'Chưa rõ email đã gửi'};
      const emailActionLabel = emailStatus === 'sent' ? 'Gửi lại email' : emailStatus === 'failed' ? 'Thử gửi lại' : emailStatus === 'uncertain' ? 'Kiểm tra / gửi lại' : emailStatus === 'sending' ? 'Đang gửi…' : 'Xác nhận & gửi email';
      return `<div class="customer-order-card">
        <div class="customer-order-main">
          <div class="customer-order-code"><span>MÃ ĐƠN HÀNG</span><b>${escapeHtml(order.code)}</b><small>${escapeHtml(order.createdAt || '')}</small></div>
          <div class="customer-order-products"><span>${itemCount} sản phẩm</span><p>${productNames || 'Chưa có thông tin sản phẩm'}${moreProducts ? ` · +${moreProducts} sản phẩm khác` : ''}</p></div>
          <div class="customer-order-total"><span>TỔNG THANH TOÁN</span><strong>${money(order.total)}</strong><small class="order-sync-status ${escapeHtml(syncStatus)}">${syncLabel}</small></div>
        </div>
        <div class="customer-order-actions">
          <span class="order-email-status ${escapeHtml(emailStatus)}">${escapeHtml(emailLabels[emailStatus] || 'Chưa xác nhận')}${order.emailConfirmation?.recipient ? ` · ${escapeHtml(order.emailConfirmation.recipient)}` : ''}</span>
          ${customer.email ? `<button type="button" class="order-confirm-email-button" data-confirm-order-email="${escapeHtml(order.code)}" data-email-status="${escapeHtml(emailStatus)}" disabled>${emailActionLabel}</button>` : '<span class="order-email-missing">Thiếu email khách hàng</span>'}
          <a class="order-pdf-button" href="/api/orders/${encodeURIComponent(order.code)}.pdf" download="don-hang-${escapeHtml(order.code)}.pdf" title="Tải PDF đơn hàng ${escapeHtml(order.code)}"><span>PDF</span>Tải đơn hàng <b>↓</b></a>
        </div>
      </div>`;
    }).join('') : '<p class="customer-no-order">Khách hàng này chưa có đơn hàng.</p>';
    return `<article class="customer-record">
      <header class="customer-record-header">
        <div><span class="customer-label">KHÁCH HÀNG</span><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.phone)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ''}</p><p>${escapeHtml(customer.address)}</p>${customer.message ? `<blockquote>“${escapeHtml(customer.message)}”</blockquote>` : ''}</div>
        <div class="customer-record-total"><b>${customerOrders.length} đơn hàng</b><strong>${money(total)}</strong><small>Ghi nhận ${escapeHtml(customer.createdAt || '')}</small></div>
      </header>
      <div class="customer-order-list">${orderMarkup}</div>
    </article>`;
  }).join('')}</div>` : '<p class="empty-admin">Chưa có thông tin khách hàng. Thông tin sẽ được lưu sau khi khách gửi form đặt hàng.</p>'}</section>`;
  const card = panel.querySelector('.admin-card');
  const heading = card.querySelector('h2');
  const action = document.createElement('div');
  action.className = 'panel-action';
  action.innerHTML = '<div><h2>Thông tin khách hàng</h2><p>Xuất Excel tổng hợp hoặc tải PDF đẹp riêng cho từng đơn hàng bên dưới.</p></div><button class="secondary-button" id="downloadCustomerExcel" type="button">Xuất Excel</button>';
  heading.replaceWith(action);
  action.querySelector('#downloadCustomerExcel').onclick = () => downloadCustomerExcel(action.querySelector('#downloadCustomerExcel'));
  panel.insertAdjacentHTML('afterbegin', `
    <section class="admin-card outlook-mail-settings" id="outlookMailSettings" aria-labelledby="outlookMailTitle">
      <div class="panel-action"><div><p class="eyebrow">EMAIL XÁC NHẬN ĐƠN</p><h2 id="outlookMailTitle">Kết nối hộp thư Outlook</h2><p id="outlookMailDescription">Sau khi kết nối, quản trị viên có thể xác nhận đơn và gửi email xác nhận cho khách.</p></div><span class="outlook-mail-state" id="outlookMailState">Đang kiểm tra kết nối…</span></div>
      <div class="outlook-mail-actions"><button class="secondary-button" id="connectOutlookMailbox" type="button">Kết nối Outlook</button><button class="danger-button" id="disconnectOutlookMailbox" type="button" hidden>Ngắt kết nối</button></div>
      <p class="outlook-mail-help" id="outlookMailHelp">Thông tin đăng nhập được kết nối bằng Microsoft OAuth và lưu mã hóa trên máy chủ.</p>
    </section>`);
  bindOutlookMailSettings(panel);
  panel.querySelectorAll('[data-confirm-order-email]').forEach(button => {
    button.onclick = async () => {
      const status = button.dataset.emailStatus || 'pending';
      const resend = ['sent', 'uncertain'].includes(status);
      if (resend && !confirm(status === 'uncertain'
        ? 'Chưa rõ Outlook đã gửi email hay chưa. Hãy kiểm tra Sent Items; gửi lại có thể khiến khách nhận thư trùng. Bạn vẫn muốn gửi lại?'
        : 'Email xác nhận đã được gửi trước đó. Bạn muốn gửi thêm một bản nữa?')) return;
      button.disabled = true;
      button.textContent = 'Đang xử lý…';
      try {
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(button.dataset.confirmOrderEmail)}/confirm-email`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({resend})
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Không thể xác nhận đơn và gửi email.');
        await aeonStore.pull();
        render();
        toastAdmin(`Đã xác nhận đơn ${result.orderCode} và gửi email cho ${result.recipient}.`);
      } catch (error) {
        await aeonStore.pull();
        render();
        toastAdmin(error.message || 'Không thể xác nhận đơn và gửi email.');
      }
    };
  });
  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card sheet-sync-card">
      <div class="panel-action"><div><p class="eyebrow">GOOGLE SHEET</p><h2>Đồng bộ đơn đặt hàng</h2><p>Đơn vẫn được lưu nội bộ trước, sau đó mới gửi bản sao sang Apps Script.</p></div><a class="secondary-button" href="/google-apps-script-order-sync.gs" download>Tải mã Apps Script</a></div>
      <div class="sheet-sync-stats"><span><b>${syncedOrders}</b> Đã đồng bộ</span><span><b>${pendingOrders}</b> Đang chờ</span><span class="${failedOrders ? 'has-error' : ''}"><b>${failedOrders}</b> Lỗi đồng bộ</span></div>
      <p class="sheet-sync-help">Endpoint được cấu hình bằng biến môi trường <code>GOOGLE_SHEET_WEB_APP_URL</code> trên máy chủ. Deployment phải có hàm <code>doPost</code>, chạy dưới tài khoản của bạn và cho phép truy cập <b>Anyone</b>.</p>
    </section>`);
}

function bindOutlookMailSettings(panel) {
  const card = panel.querySelector('#outlookMailSettings');
  if (!card) return;
  const stateLabel = card.querySelector('#outlookMailState');
  const help = card.querySelector('#outlookMailHelp');
  const connect = card.querySelector('#connectOutlookMailbox');
  const disconnect = card.querySelector('#disconnectOutlookMailbox');
  const owner = isOwnerAccount();

  refreshOutlookMailStatus = async () => {
    try {
      const response = await fetch('/api/admin/outlook/status', {cache:'no-store'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Không kiểm tra được kết nối Outlook.');
      if (result.connected) {
        stateLabel.textContent = `Đã kết nối${result.email ? ` · ${result.email}` : ''}`;
        stateLabel.className = 'outlook-mail-state is-connected';
        help.textContent = result.storage === 'supabase'
          ? 'Kết nối được lưu trên máy chủ và duy trì sau khi triển khai lại. Email đã gửi nằm trong Sent Items.'
          : 'Email sẽ được gửi từ hộp thư Outlook đã kết nối và lưu trong Sent Items.';
      } else if (!result.configured) {
        stateLabel.textContent = 'Chưa cấu hình trên máy chủ';
        stateLabel.className = 'outlook-mail-state has-error';
        help.textContent = `Cần cài biến môi trường máy chủ: ${(result.missing || []).join(', ')}. Không nhập client secret vào giao diện web.`;
      } else if (result.connectionError) {
        stateLabel.textContent = 'Cần kiểm tra kết nối';
        stateLabel.className = 'outlook-mail-state has-error';
        help.textContent = result.connectionError;
      } else {
        stateLabel.textContent = 'Chưa kết nối';
        stateLabel.className = 'outlook-mail-state';
        help.textContent = 'Tài khoản quản trị chính chọn Kết nối Outlook và đăng nhập hộp thư muốn dùng để gửi.';
      }
      panel.querySelectorAll('[data-confirm-order-email]').forEach(button => {
        button.disabled = !result.connected || button.dataset.emailStatus === 'sending';
      });
      connect.disabled = !result.configured || !owner;
      disconnect.hidden = !result.connected || !owner;
    } catch (error) {
      stateLabel.textContent = 'Không kiểm tra được';
      stateLabel.className = 'outlook-mail-state has-error';
      help.textContent = error.message || 'Hãy tải lại trang quản trị để kiểm tra kết nối.';
      connect.disabled = true;
      disconnect.hidden = true;
      panel.querySelectorAll('[data-confirm-order-email]').forEach(button => { button.disabled = true; });
    }
  };
  connect.disabled = !owner;
  connect.onclick = () => {
    if (!owner) return;
    const popup = window.open('/api/admin/outlook/connect', 'aeon-outlook-connect', 'popup,width=560,height=760');
    if (!popup) toastAdmin('Trình duyệt đã chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi thử lại.');
  };
  disconnect.onclick = async () => {
    if (!owner || !confirm('Ngắt kết nối Outlook trên website này? Bạn có thể kết nối lại sau.')) return;
    disconnect.disabled = true;
    try {
      const response = await fetch('/api/admin/outlook/disconnect', {method:'POST'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Không thể ngắt kết nối Outlook.');
      await refreshOutlookMailStatus();
      toastAdmin('Đã ngắt kết nối Outlook trên website.');
    } catch (error) {
      toastAdmin(error.message || 'Không thể ngắt kết nối Outlook.');
    } finally {
      disconnect.disabled = false;
    }
  };
  refreshOutlookMailStatus();
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.type !== 'aeon-outlook-oauth') return;
  if (event.data.ok) toastAdmin(event.data.message || 'Đã kết nối Outlook.');
  else toastAdmin(event.data.message || 'Không thể kết nối Outlook.');
  refreshOutlookMailStatus?.();
});

function toastAdmin(message) {
  const notice = document.createElement('p');
  notice.className = 'admin-notice';
  notice.textContent = message;
  $('#adminPanel').prepend(notice);
  setTimeout(() => notice.remove(), 3600);
}

window.addEventListener('aeon-store-sync', () => {
  applyAdminTheme(aeonStore.layout());
  renderAeonBrandLogos(aeonStore.ui());
  if (isAuthed()) render();
});

applyAdminTheme(aeonStore.layout());
renderAeonBrandLogos(aeonStore.ui());
async function initialiseAdminSession() {
  try {
    const response = await fetch('/api/admin/session', {cache:'no-store'});
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.authenticated) {
      adminSession = {authenticated:true, user:result.user || null};
      aeonStore.setAdminSession(true);
      const stateLoaded = await hydrateAdminState();
      showApp();
      if (!stateLoaded) toastAdmin('Không tải được cài đặt đã lưu từ máy chủ. Hãy kiểm tra kết nối và tải lại trước khi chỉnh sửa.');
      return;
    }
    showLogin(result.configured === false ? 'Máy chủ chưa cấu hình ADMIN_USERNAME và ADMIN_PASSWORD.' : '');
  } catch {
    showLogin('Không thể kiểm tra phiên quản trị. Hãy kiểm tra kết nối máy chủ.');
  }
}
initialiseAdminSession();
