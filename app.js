let products = [];
let cart = JSON.parse(localStorage.getItem('aeon-blackfriday-cart') || localStorage.getItem('aeon-mooncake-cart') || '[]');
let lastFocusedElement = null;
let storefrontAdminLastFocus = null;

const $ = selector => document.querySelector(selector);
const fmt = value => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} ₫`;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const safeColor = (value, fallback = '#eee5d4') => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : fallback;
const isStorefrontAdmin = () => aeonStore.isAdminSession();

function normaliseImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return `/${url.replace(/^\.?\//, '')}`;
}

function normaliseProductImages(value, primaryImage = '') {
  const rawImages = (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(/[\r\n,]+/));
  const images = rawImages
    .map(normaliseImageUrl)
    .filter(Boolean);
  const legacyImage = normaliseImageUrl(primaryImage);
  if (!images.length && legacyImage) images.push(legacyImage);
  else if (legacyImage && !images.includes(legacyImage)) images.push(legacyImage);
  return [...new Set(images)].slice(0, 12);
}

function normaliseGiftImageList(value) {
  const rawImages = (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(/[\r\n,]+/));
  return [...new Set(rawImages.map(normaliseImageUrl).filter(Boolean))].slice(0, 2);
}

function normaliseHeroDisplayMode(value) {
  return String(value || '').trim() === 'image-only' ? 'image-only' : 'content-image';
}

function normaliseQuoteFileUrl(value, kind) {
  const url = normaliseImageUrl(value);
  if (!url) return '';
  try {
    const pathname = new URL(url, location.origin).pathname.toLowerCase();
    const matches = kind === 'pdf' ? pathname.endsWith('.pdf') : /\.(xlsx|xls)$/.test(pathname);
    return matches ? url : '';
  } catch {
    return '';
  }
}

function normaliseVariants(value, fallbackPrice) {
  if (!Array.isArray(value)) return [];
  return value.map((variant, index) => {
    const name = String(variant?.name || '').trim();
    if (!name) return null;
    const rawPrice = aeonCommercePrice(variant.price);
    const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice) : fallbackPrice;
    const rawId = String(variant.id || variant.sku || name || index + 1).trim();
    const id = rawId.replace(/\s+/g, '-').slice(0, 100) || `variant-${index + 1}`;
    return {id, name, price, sku: String(variant.sku || '').trim().slice(0, 100), image: normaliseImageUrl(variant.image || '')};
  }).filter(Boolean);
}

function normaliseProduct(product) {
  const price = productCommerceValue(product, ['price', 'salePrice', 'promotionalPrice', 'promotionPrice', 'discountPrice', 'giaKhuyenMai', 'giaKM']);
  const variants = normaliseVariants(product.variants, price);
  const effectivePrice = price || Math.min(...variants.map(variant => variant.price).filter(value => value > 0), Infinity);
  const originalPrice = productCommerceValue(product, ['originalPrice', 'regularPrice', 'listPrice', 'oldPrice', 'retailPrice', 'normalPrice', 'giaThuong']);
  const dealSlotsTotal = Math.max(1, cleanDealSlotCount(product.dealSlotsTotal, 20));
  const dealSlotsRemaining = Math.min(dealSlotsTotal, cleanDealSlotCount(product.dealSlotsRemaining, 0));
  const images = normaliseProductImages(product.images, product.image);
  return {
    id: String(product.id || ''),
    name: String(product.name || 'Sản phẩm đang cập nhật'),
    price,
    originalPrice: originalPrice > effectivePrice ? originalPrice : 0,
    dealSlotsRemaining,
    dealSlotsTotal,
    description: String(product.description || ''),
    details: String(product.details || product.description || ''),
    label: String(product.label || ''),
    brand: normaliseAeonBrand(product.brand) || inferAeonBrandFromProductName(product.name),
    productGroup: String(product.productGroup || product.category || product.group || '').trim().slice(0, 100),
    promotionProductName: String(product.promotionProductName || product.promoName || '').trim().slice(0, 160),
    promotionProductValue: String(product.promotionProductValue || product.promoValue || '').trim().slice(0, 120),
    promotionProductImage: normaliseGiftImageList(product.promotionProductImage || product.promoImage || '').join(', '),
    image: images[0] || '',
    images,
    bg: safeColor(product.bg),
    box: safeColor(product.box, '#8f1834'),
    weight: String(product.weight || ''),
    ingredients: String(product.ingredients || ''),
    sku: String(product.sku || ''),
    variantLabel: String(product.variantLabel || '').trim().slice(0, 100),
    variants
  };
}

function storefrontProductInsertPositionOptions(items, selectedPosition = items.length) {
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

function priceLabel(product) {
  if (product.variants?.length) {
    const available = product.variants.map(variant => variant.price).filter(price => price > 0);
    return available.length ? `Từ ${fmt(Math.min(...available))}` : 'Liên hệ';
  }
  return product.price > 0 ? fmt(product.price) : 'Liên hệ';
}

function discountPercent(product) {
  const originalPrice = aeonCommercePrice(product.originalPrice);
  const variantPrices = Array.isArray(product.variants)
    ? product.variants.map(variant => aeonCommercePrice(variant.price)).filter(price => price > 0)
    : [];
  const sellingPrice = aeonCommercePrice(product.price) || (variantPrices.length ? Math.min(...variantPrices) : 0);
  return originalPrice > sellingPrice && sellingPrice > 0
    ? Math.round((1 - sellingPrice / originalPrice) * 100)
    : 0;
}

function productPriceMarkup(product, canOrder) {
  const discount = discountPercent(product);
  const regular = Number(product.originalPrice) || 0;
  return `<div class="product-price-stack"><span class="price${canOrder ? '' : ' is-contact'}">${priceLabel(product)}</span>${discount ? `<span class="regular-price">${fmt(regular)}</span>` : ''}</div>`;
}

function productDealQuotaMarkup(product) {
  const total = Math.max(1, cleanDealSlotCount(product.dealSlotsTotal, 20));
  const booked = Math.min(total, cleanDealSlotCount(product.dealSlotsRemaining, 0));
  const ratio = booked / total;
  const level = booked >= total ? 'soldout' : ratio >= .75 ? 'low' : ratio >= .35 ? 'medium' : 'high';
  return `<div class="product-deal-quota" data-quota-level="${level}" aria-label="${booked} trên ${total} suất đã đặt trước"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="deal-flame-outer" d="M13.3 1.5c.5 3.1-.8 4.7-2.3 6.1-.8-1.1-.9-2.3-.6-3.3C6.6 7.2 4.4 10.1 4.4 14a7.6 7.6 0 0 0 15.2 0c0-4.4-2.3-8.3-6.3-12.5Z"/><path class="deal-flame-inner" d="M12 10.2c.1 1.7-1.9 2.8-1.9 4.8a2.1 2.1 0 1 0 4.2 0c0-1.8-1.1-3.2-2.3-4.8Z"/></svg><span>${booked}/${total} Suất đã đặt trước</span></div>`;
}

function productSaleOverlayMarkup(product) {
  const name = String(product.promotionProductName || '').trim();
  const value = String(product.promotionProductValue || '').trim();
  const images = normaliseGiftImageList(product.promotionProductImage || '');
  if (!name || !images.length) return '';
  const accessibleLabel = value ? `Tặng ${name}, trị giá ${value}` : `Tặng ${name}`;
  const valueMarkup = value ? `<em>TRỊ GIÁ ${escapeHtml(value)}</em>` : '';
  const bow = `<svg class="bf-gift-bow" viewBox="0 0 180 112" aria-hidden="true" focusable="false">
    <g stroke-linejoin="round" stroke-linecap="round">
      <path d="M83 50C59 29 32 12 17 17 1 24 21 48 79 58 52 61 30 69 27 81 24 95 54 90 88 58Z" fill="#bd0a1b" stroke="#a96721" stroke-width="5"/>
      <path d="M83 50C59 29 32 12 17 17 1 24 21 48 79 58 52 61 30 69 27 81 24 95 54 90 88 58Z" fill="#e52025" stroke="#ffe28a" stroke-width="2.2"/>
      <path d="M76 48C53 28 33 18 22 21 16 27 36 43 70 53M32 76C47 67 62 63 78 61" fill="none" stroke="#ff9b79" stroke-opacity=".76" stroke-width="2.4"/>
      <path d="M97 50c24-21 51-38 66-33 16 7-4 31-62 41 27 3 49 11 52 23 3 14-27 9-61-23Z" fill="#bd0a1b" stroke="#a96721" stroke-width="5"/>
      <path d="M97 50c24-21 51-38 66-33 16 7-4 31-62 41 27 3 49 11 52 23 3 14-27 9-61-23Z" fill="#e52025" stroke="#ffe28a" stroke-width="2.2"/>
      <path d="M104 48c23-20 43-30 54-27 6 6-14 22-48 32m36 23c-15-9-30-13-46-15" fill="none" stroke="#ff9b79" stroke-opacity=".76" stroke-width="2.4"/>
      <path d="M82 55C59 62 24 62 12 76l10 29c21-15 42-34 67-43Z" fill="#bd0a1b" stroke="#a96721" stroke-width="5"/>
      <path d="M82 55C59 62 24 62 12 76l10 29c21-15 42-34 67-43Z" fill="#e52025" stroke="#ffe28a" stroke-width="2.2"/>
      <path d="M98 55c23 7 58 7 70 21l-10 29c-21-15-42-34-67-43Z" fill="#bd0a1b" stroke="#a96721" stroke-width="5"/>
      <path d="M98 55c23 7 58 7 70 21l-10 29c-21-15-42-34-67-43Z" fill="#e52025" stroke="#ffe28a" stroke-width="2.2"/>
      <path d="M28 83c17-11 34-19 51-25m47 25c-17-11-34-19-51-25" fill="none" stroke="#ff9b79" stroke-opacity=".72" stroke-width="2.4"/>
      <path d="M78 43q12-8 24 0l2 17q-14 11-28 0Z" fill="#f3b33a" stroke="#fff0a8" stroke-width="2.5"/>
      <path d="M84 46q6-4 12 0v13q-6 4-12 0Z" fill="#e71e25" stroke="#a96721" stroke-width="1.5"/>
      <path d="m90 37 2 4 4 1-4 2-2 4-2-4-4-2 4-1Z" fill="#fff2ba" stroke="none"/>
    </g>
  </svg>`;
  const giftImagesMarkup = images.map(image => `<span class="bf-gift-photo-item"><img src="${escapeHtml(image)}" alt="" data-image-fallback><span data-image-placeholder hidden></span></span>`).join('');
  return `<span class="bf-gift-promo" role="img" aria-label="${escapeHtml(accessibleLabel)}"><span class="bf-gift-photo${images.length > 1 ? ' is-multi' : ''}" aria-hidden="true">${giftImagesMarkup}</span><span class="bf-gift-ribbon">${bow}<span class="bf-gift-copy"><strong>TẶNG ${escapeHtml(name)}</strong>${valueMarkup}</span></span></span>`;
}
const giftCopyCanvasContext = document.createElement('canvas').getContext('2d');
const giftCopyObserved = new WeakSet();
const giftCopyResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(entries => entries.forEach(entry => fitGiftCopyText(entry.target)))
  : null;

function fitGiftCopyText(copy) {
  const strong = copy?.querySelector('strong');
  const value = copy?.querySelector('em');
  if (!strong || !giftCopyCanvasContext || !copy.isConnected) return;
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const detail = Boolean(copy.closest('.detail-art'));
  const maxStrong = detail ? (narrow ? 14 : 18) : (narrow ? 8 : 16);
  const maxValue = detail ? (narrow ? 12 : 15) : (narrow ? 7 : 13);
  const widthAt = (element, size) => {
    const style = getComputedStyle(element);
    giftCopyCanvasContext.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
    let text = element.textContent.trim();
    if (style.textTransform === 'uppercase') text = text.toLocaleUpperCase('vi-VN');
    const spacing = Number.parseFloat(style.letterSpacing) || 0;
    return giftCopyCanvasContext.measureText(text).width + Math.max(0, text.length - 1) * spacing;
  };
  const available = Math.max(0, copy.clientWidth);
  const stackedGiftCopy = Boolean(copy.closest('.bf-gift-promo')?.querySelector('.bf-gift-photo.is-multi'));
  const copyStyle = getComputedStyle(copy);
  const gap = Number.parseFloat(stackedGiftCopy ? copyStyle.rowGap : copyStyle.columnGap) || 0;
  const strongWidth = widthAt(strong, maxStrong);
  const valueWidth = value ? widthAt(value, maxValue) : 0;
  const naturalWidth = stackedGiftCopy ? Math.max(strongWidth, valueWidth) : strongWidth + (value ? valueWidth + gap : 0);
  if (!available || !naturalWidth) return;
  const scale = Math.max(0.25, Math.min(1, (available - 4) / naturalWidth));
  strong.style.fontSize = `${Math.round(maxStrong * scale * 10) / 10}px`;
  if (value) value.style.fontSize = `${Math.round(maxValue * scale * 10) / 10}px`;
}

function watchGiftCopySizing(root = document) {
  const copies = [];
  if (root.nodeType === 1 && root.matches('.bf-gift-copy')) copies.push(root);
  if (root.querySelectorAll) copies.push(...root.querySelectorAll('.bf-gift-copy'));
  copies.forEach(copy => {
    fitGiftCopyText(copy);
    if (giftCopyResizeObserver && !giftCopyObserved.has(copy)) {
      giftCopyObserved.add(copy);
      giftCopyResizeObserver.observe(copy);
    }
  });
}

watchGiftCopySizing();
new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
  if (node.nodeType === 1) watchGiftCopySizing(node);
}))).observe(document.body, {childList:true, subtree:true});
window.addEventListener('resize', () => watchGiftCopySizing(), {passive:true});
if (document.fonts?.ready) document.fonts.ready.then(() => watchGiftCopySizing()).catch(() => {});
function hasVariants(product) {
  return Array.isArray(product.variants) && product.variants.length > 0;
}

function canOrderProduct(product) {
  return hasVariants(product) ? product.variants.some(variant => variant.price > 0) : product.price > 0;
}

function cartKey(productId, variantId = '') {
  return `${productId}::${variantId || ''}`;
}

function cartLabel(item) {
  return [item.name, item.variantName].filter(Boolean).join(' · ');
}

function cartItemFromProduct(product, variant = null) {
  const variantId = variant?.id || '';
  return {
    id: product.id,
    productId: product.id,
    cartKey: cartKey(product.id, variantId),
    name: product.name,
    price: variant ? variant.price : product.price,
    image: variant?.image || product.image,
    bg: product.bg,
    sku: variant?.sku || product.sku,
    variantId,
    variantName: variant?.name || '',
    variantSku: variant?.sku || ''
  };
}

function promotionFor(subtotal, date = new Date()) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const within = (from, to) => day >= new Date(`${from}T00:00:00`) && day <= new Date(`${to}T23:59:59`);
  if (within('2026-08-03', '2026-08-19') && subtotal >= 1000000) return {rate: .08, label: 'Ưu đãi sớm 8%'};
  if (within('2026-08-20', '2026-09-25')) {
    const rate = subtotal >= 30000001 ? .15 : subtotal >= 15000001 ? .12 : subtotal >= 10000001 ? .10 : subtotal >= 3000000 ? .05 : 0;
    return rate ? {rate, label: `Chiết khấu ${rate * 100}%`} : {rate: 0, label: 'Ưu đãi áp dụng theo giá trị đơn hàng'};
  }
  return {rate: 0, label: 'Ưu đãi áp dụng theo thời gian chương trình'};
}

const grid = $('#productGrid');
const cartItems = $('#cartItems');
const brandDirectory = $('#brandDirectory');
const productGroupDirectory = $('#productGroupDirectory');
const productSearchForm = $('#topProductSearch');
const productSearchInput = $('#productSearchInput');
const clearProductSearch = $('#clearProductSearch');
const productPriceFilter = $('#productPriceFilter');
const productSort = $('#productSort');
const catalogResult = $('#catalogResult');
let activeBrand = '';
let activeProductGroup = '';
let brandDirectoryExpanded = false;
let productGroupDirectoryExpanded = false;
let productSearchQuery = '';
let productPriceFilterValue = 'all';
let productSortValue = 'upload';

$('#openCart').innerHTML = '<svg class="cart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7.1"></path><circle cx="10" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></svg><span>Giỏ hàng</span><b id="cartCount">0</b>';
$('.drawer-head h2').textContent = 'Giỏ hàng';
$('.hero .note')?.remove();
$('#checkout .note').textContent = 'Chúng tôi sẽ liên hệ xác nhận đơn hàng, ưu đãi và thời gian giao phù hợp.';
$('.cart-total small').textContent = 'Phí giao hàng và ưu đãi sẽ được xác nhận khi tư vấn.';
$('footer p').textContent = '© 2026 AEON Black Friday.';

document.body.insertAdjacentHTML('beforeend', '<button class="mobile-cart-cta" id="mobileCart" aria-label="Mở giỏ hàng"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7.1"></path><circle cx="10" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></svg><span>Giỏ hàng</span><b id="mobileCartCount">0</b><i>Xem giỏ →</i></button>');

['product-detail.css', 'hotline.css?v=20260804-contact', 'promotion.css', 'hero-promotion.css', 'catalog-focus.css', 'hero-compact.css', 'admin-layout.css', 'storefront-refine.css', 'mobile-storefront.css', 'official-assets.css', 'product-modal-fix.css', 'product-variants.css', 'storefront-product-ux.css?v=20261108-catalog-contact-last-page-v61', 'brand-directory.css?v=20261108-catalog-contact-last-page-v61', 'storefront-admin.css?v=20261106-promo-fields', 'theme-customization.css?v=20261105-contrast', 'quote-download.css', 'catalog-search-sort.css?v=20260804-search-sort', 'toast-contrast.css?v=20261106-cart-notification'].forEach(href => {
  const alreadyLoaded = [...document.head.querySelectorAll('link[rel="stylesheet"]')]
    .some(link => link.getAttribute('href') === href);
  if (!alreadyLoaded) document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}));
});

document.body.insertAdjacentHTML('beforeend', '<aside class="hotline-widget" aria-label="Liên hệ tư vấn"><a class="hotline-call contact-button" href="tel:0327747337" aria-label="Gọi hotline 0327 747 337"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 3.5 9.6 8 7.9 9.7c1.1 2.3 2.9 4.1 5.2 5.2l1.7-1.7 4.5 2.4-.9 3.8c-.2.8-.9 1.3-1.7 1.3C9.2 20.7 3.3 14.8 3.3 7.3c0-.8.5-1.5 1.3-1.7l2.6-.6Z"></path></svg><span><small>Hotline</small><b>0327 747 337</b></span></a><a class="zalo-link contact-button" href="https://zalo.me/0327747337" target="_blank" rel="noopener noreferrer" aria-label="Nhắn tin qua Zalo"><span>Chat</span><b>Zalo</b></a></aside>');
$('footer').insertAdjacentHTML('beforeend', '<div class="footer-contact-actions" aria-label="Thông tin liên hệ"><a class="footer-hotline footer-contact-button" href="tel:0327747337">Hotline: 0327 747 337</a><a class="footer-zalo footer-contact-button" href="https://zalo.me/0327747337" target="_blank" rel="noopener noreferrer">Nhắn Zalo ↗</a></div>');

$('.benefits').insertAdjacentHTML('afterend', '<section class="promotion-section" id="promotion"><div><p class="eyebrow">ƯU ĐÃI MÙA TRĂNG 2026</p><h2>Ưu đãi càng lớn,<br><em>quà tặng càng trọn.</em></h2><p>Áp dụng theo giá trị hóa đơn trong thời gian chương trình.</p></div><div class="promotion-list"><article><span>03/08 — 19/08</span><h3>Ưu đãi sớm</h3><strong>Giảm 8%</strong><p>Cho hóa đơn từ 1.000.000 ₫</p></article><article><span>20/08 — 25/09</span><h3>Chiết khấu chính thức</h3><p><b>5%</b> từ 3 triệu · <b>10%</b> từ 10 triệu<br><b>12%</b> từ 15 triệu · <b>15%</b> từ 30 triệu</p></article></div><small>Không áp dụng đồng thời ưu đãi thành viên 5% vào ngày 5 & 20 hằng tháng. Phiếu ưu đãi áp dụng cho giỏ quà không rượu.</small></section>');

const compactPromotion = $('#promotion');
const heroCopy = $('.hero-copy');
compactPromotion.className = 'hero-promotion';
compactPromotion.innerHTML = '<span data-promotion-title></span><div data-promotion-text></div>';
heroCopy.querySelector('.hero-actions').append(compactPromotion);

const quoteDownload = $('#quoteDownload');
const quoteDownloadTrigger = $('#quoteDownloadTrigger');
const quoteDownloadMenu = $('#quoteDownloadMenu');

function placeQuoteDownloadInHero(imageOnly) {
  const heroSection = $('.hero');
  const regularActions = heroCopy.querySelector('.hero-actions');
  let imageOnlyActions = heroSection.querySelector('.hero-image-only-actions');

  if (!imageOnlyActions) {
    imageOnlyActions = document.createElement('div');
    imageOnlyActions.className = 'hero-image-only-actions';
    imageOnlyActions.hidden = true;
    heroSection.append(imageOnlyActions);
  }

  const destination = imageOnly ? imageOnlyActions : regularActions;
  if (quoteDownload.parentElement !== destination) destination.prepend(quoteDownload);
  imageOnlyActions.hidden = !imageOnly;
  closeQuoteDownloadMenu();
}

function closeQuoteDownloadMenu() {
  quoteDownloadMenu.hidden = true;
  quoteDownloadTrigger.setAttribute('aria-expanded', 'false');
}

function renderQuoteDownload(ui) {
  const files = [
    {kind:'excel', label:'Tải file Excel', meta:'.XLSX / .XLS', url:normaliseQuoteFileUrl(ui.quoteExcelUrl, 'excel')},
    {kind:'pdf', label:'Tải file PDF', meta:'.PDF', url:normaliseQuoteFileUrl(ui.quotePdfUrl, 'pdf')}
  ];
  const availableCount = files.filter(file => file.url).length;

  quoteDownloadMenu.innerHTML = files.map(file => file.url
    ? `<a class="quote-download-option" href="${escapeHtml(file.url)}" download data-quote-kind="${file.kind}"><b>${file.label}</b><span>${file.meta}</span></a>`
    : `<span class="quote-download-option is-disabled" aria-disabled="true"><b>${file.label}</b><span>Chưa tải lên</span></span>`).join('');
  quoteDownloadTrigger.disabled = availableCount === 0;
  quoteDownloadTrigger.setAttribute('aria-label', availableCount ? `Chọn định dạng file báo giá, có ${availableCount} tệp sẵn sàng` : 'Chưa có file báo giá để tải xuống');
  if (!availableCount) closeQuoteDownloadMenu();
}

quoteDownloadTrigger.addEventListener('click', event => {
  event.stopPropagation();
  if (quoteDownloadTrigger.disabled) return;
  const willOpen = quoteDownloadMenu.hidden;
  quoteDownloadMenu.hidden = !willOpen;
  quoteDownloadTrigger.setAttribute('aria-expanded', String(willOpen));
});
quoteDownloadMenu.addEventListener('click', event => {
  if (event.target.closest('a')) closeQuoteDownloadMenu();
});
document.addEventListener('click', event => {
  if (!quoteDownload.contains(event.target)) closeQuoteDownloadMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !quoteDownloadMenu.hidden) {
    closeQuoteDownloadMenu();
    quoteDownloadTrigger.focus();
  }
});

$('.cart-total').insertAdjacentHTML('beforeend', '<p id="cartPromotion" class="cart-promotion"></p>');
$('#orderForm').insertAdjacentHTML('afterbegin', '<section class="checkout-summary" id="checkoutSummary" aria-live="polite"></section>');

const catalogSection = $('#collection');
const checkoutSection = $('#checkout');
$('.hero').after(catalogSection);
catalogSection.after(checkoutSection);
checkoutSection.hidden = true;
$('.story').hidden = true;
$('.gift-banner').hidden = true;
$('.how').hidden = true;

const mainNav = document.querySelectorAll('.site-header nav a');
mainNav[0].textContent = 'Sản phẩm';
mainNav[1].href = '#promotion';
mainNav[1].textContent = 'Ưu đãi';
mainNav[2].href = '#checkout';
mainNav[2].textContent = 'Đặt hàng';
$('.hero-actions .text-link')?.remove();

function renderStorefrontAdminTools() {
  const authenticated = isStorefrontAdmin();
  document.body.classList.toggle('admin-preview', authenticated);
  let toolbar = $('#storefrontAdminToolbar');
  if (!authenticated) {
    toolbar?.remove();
    closeStorefrontProductEditor();
    return;
  }
  if (!toolbar) {
    toolbar = document.createElement('aside');
    toolbar.id = 'storefrontAdminToolbar';
    toolbar.className = 'storefront-admin-toolbar';
    catalogSection.prepend(toolbar);
  }
  toolbar.innerHTML = `<div><strong class="storefront-admin-status">ĐANG ĐĂNG NHẬP QUẢN TRỊ</strong><small>Thêm hoặc chỉnh sửa sản phẩm ngay trên trang bán hàng.</small></div><div class="storefront-admin-toolbar-actions"><button type="button" data-storefront-new>+ Thêm sản phẩm</button><button type="button" data-storefront-appearance>Tùy chỉnh giao diện</button><a href="admin.html#products">Cài đặt & danh mục</a><button type="button" class="storefront-admin-logout" data-storefront-logout>Đăng xuất</button></div>`;
}

function formatBannerRatio(value) {
  const ratio = Number(value) || AEON_DEFAULT_LAYOUT.bannerAspectRatio;
  return `${ratio.toFixed(2).replace(/\.?0+$/, '')}:1`;
}

const LAYOUT_FONT_FAMILIES = {
  'aeon-default': 'Mặc định AEON',
  'be-vietnam-pro': 'Be Vietnam Pro',
  'playfair-display': 'Playfair Display',
  arial: 'Arial',
  georgia: 'Georgia'
};

function normaliseLayoutFontFamily(value) {
  const key = String(value || '').trim();
  return Object.hasOwn(LAYOUT_FONT_FAMILIES, key) ? key : AEON_DEFAULT_LAYOUT.fontFamily;
}

function layoutFontFamilyOptions(value) {
  const selected = normaliseLayoutFontFamily(value);
  return Object.entries(LAYOUT_FONT_FAMILIES)
    .map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function appearanceRangeMarkup(name, label, value, min, max, step = 1, autoLabel = '', outputFormat = 'px') {
  const numeric = Number(value) || 0;
  const output = outputFormat === 'ratio'
    ? formatBannerRatio(numeric)
    : (numeric === 0 && autoLabel ? autoLabel : `${numeric}px`);
  return `<label>${label}<output data-appearance-output="${name}">${output}</output><input class="layout-range" type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${numeric}"${autoLabel ? ` data-auto-label="${autoLabel}"` : ''}${outputFormat === 'ratio' ? ' data-output-format="ratio"' : ''}></label>`;
}

function storefrontAppearanceValues(form, base = aeonStore.layout()) {
  const values = Object.fromEntries(new FormData(form));
  ['heroTitleSize', 'heroIntroSize', 'bannerAspectRatio', 'productTitleSize', 'headerHeight', 'heroHeight', 'sectionSpacing', 'productImageHeight', 'productColumns', 'productColumnsMobile', 'logoSize'].forEach(key => {
    values[key] = Number(values[key]);
  });
  return {...base, ...values};
}

function closeStorefrontAppearance(restore = true) {
  const modal = $('#storefrontAppearanceEditor');
  if (!modal) return false;
  modal.remove();
  document.body.classList.remove('storefront-appearance-editor-open');
  if (restore) applyLayout();
  return true;
}

function openStorefrontAppearance() {
  if (!isStorefrontAdmin()) return;
  const existing = $('#storefrontAppearanceEditor');
  if (existing) {
    existing.querySelector('input, select, button')?.focus();
    return;
  }

  const layout = aeonStore.layout();
  document.body.insertAdjacentHTML('beforeend', `<section class="storefront-appearance-editor show" id="storefrontAppearanceEditor" role="dialog" aria-modal="true" aria-labelledby="storefrontAppearanceTitle">
    <div class="storefront-appearance-card">
      <button class="storefront-appearance-close" type="button" data-storefront-appearance-close aria-label="Đóng tùy chỉnh giao diện">×</button>
      <header><p class="eyebrow">CHỈNH SỬA TRỰC TIẾP</p><h2 id="storefrontAppearanceTitle">Tùy chỉnh giao diện</h2><p>Điều chỉnh màu và kích thước, xem kết quả ngay trên trang này rồi lưu để đồng bộ với phần Cài đặt.</p></header>
      <form id="storefrontAppearanceForm">
        <section class="storefront-appearance-section"><h3>Màu sắc</h3><div class="storefront-appearance-grid">
          <label>Màu chủ đạo<input name="accentColor" type="color" value="${layout.accentColor}"></label>
          <label>Màu chủ đạo đậm<input name="accentDarkColor" type="color" value="${layout.accentDarkColor}"></label>
          <label>Màu nền trang<input name="pageBackgroundColor" type="color" value="${layout.pageBackgroundColor}"></label>
          <label>Màu nền khu vực nội dung<input name="sectionBackgroundColor" type="color" value="${layout.sectionBackgroundColor}"></label>
          <label>Màu chữ chính<input name="textColor" type="color" value="${layout.textColor}"></label>
        </div></section>
        <section class="storefront-appearance-section"><h3>Chữ và khu vực</h3><div class="storefront-appearance-grid">
          ${appearanceRangeMarkup('heroTitleSize', 'Cỡ tiêu đề hero', layout.heroTitleSize, 10, 90)}
          ${appearanceRangeMarkup('heroIntroSize', 'Cỡ mô tả hero', layout.heroIntroSize, 12, 22)}
          ${appearanceRangeMarkup('bannerAspectRatio', 'Tỷ lệ banner desktop (chỉ đổi chiều ngang)', layout.bannerAspectRatio, 1.5, 4, 'any', '', 'ratio')}
          ${appearanceRangeMarkup('productTitleSize', 'Cỡ tên sản phẩm', layout.productTitleSize, 12, 24)}
          ${appearanceRangeMarkup('headerHeight', 'Chiều cao thanh đầu trang', layout.headerHeight, 10, 112)}
          ${appearanceRangeMarkup('heroHeight', 'Chiều cao hero', layout.heroHeight, 0, 700, 10, 'Tự động')}
          ${appearanceRangeMarkup('sectionSpacing', 'Khoảng cách đầu/cuối khu vực', layout.sectionSpacing, 0, 170, 5, 'Tự động')}
          ${appearanceRangeMarkup('productImageHeight', 'Chiều cao ảnh sản phẩm', layout.productImageHeight, 0, 480, 10, 'Tự động')}
          ${appearanceRangeMarkup('logoSize', 'Cỡ logo', layout.logoSize, 18, 48)}
          <label>Font chữ giao diện<select name="fontFamily">${layoutFontFamilyOptions(layout.fontFamily)}</select></label>
          <label>Số cột sản phẩm trên desktop<select name="productColumns"><option value="0"${Number(layout.productColumns) === 0 ? ' selected' : ''}>Tự động</option><option value="1"${Number(layout.productColumns) === 1 ? ' selected' : ''}>1 cột</option><option value="2"${Number(layout.productColumns) === 2 ? ' selected' : ''}>2 cột</option><option value="3"${Number(layout.productColumns) === 3 ? ' selected' : ''}>3 cột</option><option value="4"${Number(layout.productColumns) === 4 ? ' selected' : ''}>4 cột</option><option value="5"${Number(layout.productColumns) === 5 ? ' selected' : ''}>5 cột</option><option value="6"${Number(layout.productColumns) === 6 ? ' selected' : ''}>6 cột</option></select></label>
          <label>Số cột sản phẩm trên mobile<select name="productColumnsMobile"><option value="0"${Number(layout.productColumnsMobile) === 0 ? ' selected' : ''}>Tự động</option><option value="1"${Number(layout.productColumnsMobile) === 1 ? ' selected' : ''}>1 cột</option><option value="2"${Number(layout.productColumnsMobile) === 2 ? ' selected' : ''}>2 cột</option></select></label>
        </div></section>
        <p class="storefront-appearance-status" id="storefrontAppearanceStatus" role="status"></p>
        <footer><button class="danger" type="button" data-storefront-appearance-reset>Khôi phục mặc định</button><span></span><button class="storefront-appearance-cancel" type="button" data-storefront-appearance-close>Hủy</button><button class="button primary" type="submit">Lưu thay đổi</button></footer>
      </form>
    </div>
  </section>`);
  document.body.classList.add('storefront-appearance-editor-open');

  const modal = $('#storefrontAppearanceEditor');
  const form = $('#storefrontAppearanceForm');
  const status = $('#storefrontAppearanceStatus');
  const preview = () => applyLayout(storefrontAppearanceValues(form));
  form.querySelectorAll('input, select').forEach(input => {
    input.addEventListener('input', () => {
      const output = form.querySelector(`[data-appearance-output="${input.name}"]`);
      if (output) {
        output.textContent = input.dataset.outputFormat === 'ratio'
          ? formatBannerRatio(input.value)
          : (Number(input.value) === 0 && input.dataset.autoLabel ? input.dataset.autoLabel : `${input.value}px`);
      }
      preview();
    });
    input.addEventListener('change', preview);
  });
  modal.querySelectorAll('[data-storefront-appearance-close]').forEach(button => {
    button.onclick = () => closeStorefrontAppearance(true);
  });
  modal.onclick = event => {
    if (event.target === modal) closeStorefrontAppearance(true);
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const values = storefrontAppearanceValues(form);
    button.disabled = true;
    button.textContent = 'Đang lưu...';
    try {
      const synced = await aeonStore.set('aeon-layout', values);
      refreshStorefront();
      closeStorefrontAppearance(false);
      toast(synced ? 'Đã lưu giao diện và đồng bộ website.' : 'Đã lưu giao diện trên trình duyệt này.');
    } catch (error) {
      status.textContent = error.message || 'Không thể lưu giao diện.';
    } finally {
      button.disabled = false;
      button.textContent = 'Lưu thay đổi';
    }
  };
  modal.querySelector('[data-storefront-appearance-reset]').onclick = async () => {
    if (!confirm('Khôi phục toàn bộ màu sắc và kích thước về mặc định?')) return;
    try {
      const synced = await aeonStore.set('aeon-layout', AEON_DEFAULT_LAYOUT);
      refreshStorefront();
      closeStorefrontAppearance(false);
      toast(synced ? 'Đã khôi phục giao diện mặc định.' : 'Đã khôi phục giao diện trên trình duyệt này.');
    } catch (error) {
      status.textContent = error.message || 'Không thể khôi phục giao diện.';
    }
  };
  form.querySelector('input')?.focus();
}

function storefrontProductAdminActions(product) {
  if (!isStorefrontAdmin()) return '';
  return `<div class="storefront-product-admin-actions"><button type="button" data-storefront-edit="${escapeHtml(product.id)}">Sửa</button><button type="button" class="storefront-product-delete" data-storefront-delete="${escapeHtml(product.id)}" aria-label="Xóa ${escapeHtml(product.name)}">×</button></div>`;
}

function cleanStorefrontProductText(value, limit = 1000, preserveLines = false) {
  const source = String(value ?? '').replace(/\u0000/g, '');
  const text = preserveLines
    ? source.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : source.replace(/\s+/g, ' ').trim();
  return text.slice(0, limit);
}

function newStorefrontVariantId() {
  return `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storefrontVariantRowMarkup(variant = {}) {
  const id = String(variant.id || newStorefrontVariantId());
  return `<div class="product-variant-row" data-variant-id="${escapeHtml(id)}"><label>Tên lựa chọn<input data-variant-name required value="${escapeHtml(variant.name || '')}" placeholder="Ví dụ: Hộp 4 bánh"></label><label>Giá bán (VNĐ)<input data-variant-price type="number" min="0" inputmode="numeric" required value="${variant.price ?? ''}" placeholder="750000"></label><label>Mã SKU<input data-variant-sku value="${escapeHtml(variant.sku || '')}" placeholder="AM-2026-04"></label><label>Ảnh phân loại (URL)<input data-variant-image value="${escapeHtml(variant.image || '')}" placeholder="Để trống dùng ảnh chung"></label><button type="button" class="remove-product-variant" data-remove-variant aria-label="Xóa lựa chọn này">×</button></div>`;
}

function storefrontVariantsFromEditor(list) {
  const rows = [...list.querySelectorAll('[data-variant-id]')];
  if (rows.length > 20) throw new Error('Mỗi sản phẩm tối đa 20 lựa chọn.');
  const names = new Set();
  const skus = new Set();
  return rows.map(row => {
    const name = cleanStorefrontProductText(row.querySelector('[data-variant-name]').value, 120);
    const price = Number(row.querySelector('[data-variant-price]').value);
    const sku = cleanStorefrontProductText(row.querySelector('[data-variant-sku]').value, 100);
    const image = normaliseImageUrl(row.querySelector('[data-variant-image]')?.value || '');
    if (!name || !Number.isFinite(price) || price < 0) throw new Error('Mỗi lựa chọn cần có tên và giá bán hợp lệ.');
    const nameKey = name.toLocaleLowerCase('vi-VN');
    const skuKey = sku.toLocaleLowerCase('vi-VN');
    if (names.has(nameKey)) throw new Error('Tên các lựa chọn không được trùng nhau.');
    if (sku && skus.has(skuKey)) throw new Error('Mã SKU của các lựa chọn không được trùng nhau.');
    names.add(nameKey);
    if (sku) skus.add(skuKey);
    return {id: row.dataset.variantId || newStorefrontVariantId(), name, price: Math.round(price), sku, image};
  });
}

function bindStorefrontVariantEditor(form) {
  const list = form.querySelector('[data-variant-rows]');
  const addButton = form.querySelector('[data-add-variant]');
  const priceInput = form.elements.price;
  const hint = form.querySelector('[data-variant-price-hint]');
  const originalPrice = priceInput.value;
  const syncPrice = () => {
    const rows = [...list.querySelectorAll('[data-variant-id]')];
    const prices = rows.map(row => Number(row.querySelector('[data-variant-price]').value));
    priceInput.readOnly = rows.length > 0;
    priceInput.classList.toggle('derived-price', rows.length > 0);
    if (!rows.length) {
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
      toast('Mỗi sản phẩm tối đa 20 lựa chọn.');
      return;
    }
    list.insertAdjacentHTML('beforeend', storefrontVariantRowMarkup());
    const row = list.lastElementChild;
    bindRow(row);
    syncPrice();
    row.querySelector('[data-variant-name]').focus();
  };
  syncPrice();
  return () => storefrontVariantsFromEditor(list);
}

function renderStorefrontEditorPreview(preview, value, name = 'Ảnh sản phẩm') {
  const image = normaliseImageUrl(value);
  preview.innerHTML = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" data-image-fallback><span data-image-placeholder hidden>Không thể hiển thị ảnh này.</span>`
    : '<span data-image-placeholder>Chưa chọn ảnh sản phẩm</span>';
  attachImageFallbacks(preview);
}

function readStorefrontImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'));
    reader.readAsDataURL(file);
  });
}

async function uploadStorefrontProductImage(file) {
  if (!file) throw new Error('Hãy chọn ảnh trước khi tải lên.');
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG, WEBP, GIF hoặc SVG.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl: await readStorefrontImageAsDataUrl(file)})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể tải ảnh lên.');
  return normaliseImageUrl(result.url);
}

function productFromStorefrontForm(form, existing = {}, variants = []) {
  const data = Object.fromEntries(new FormData(form));
  const name = cleanStorefrontProductText(data.name, 160);
  const description = cleanStorefrontProductText(data.description, 500);
  const price = variants.length ? Math.min(...variants.map(variant => variant.price)) : Number(data.price);
  const originalPrice = Number(data.originalPrice) || 0;
  if (!name || !description || !Number.isFinite(price) || price < 0) {
    throw new Error('Vui lòng nhập tên, mô tả và giá bán hợp lệ.');
  }
  const images = normaliseProductImages([data.image, data.images]);
  return {
    ...existing,
    name,
    price: Math.round(price),
    originalPrice: originalPrice > price ? Math.round(originalPrice) : 0,
    dealSlotsRemaining: Math.min(Math.max(1, cleanDealSlotCount(data.dealSlotsTotal, cleanDealSlotCount(existing.dealSlotsTotal, 20))), cleanDealSlotCount(data.dealSlotsRemaining, cleanDealSlotCount(existing.dealSlotsRemaining, 0))),
    dealSlotsTotal: Math.max(1, cleanDealSlotCount(data.dealSlotsTotal, cleanDealSlotCount(existing.dealSlotsTotal, 20))),
    label: cleanStorefrontProductText(data.label, 100),
    brand: normaliseAeonBrand(data.brand) || inferAeonBrandFromProductName(name),
    productGroup: cleanStorefrontProductText(data.productGroup, 100),
    description,
    weight: cleanStorefrontProductText(data.weight, 160, true),
    ingredients: cleanStorefrontProductText(data.ingredients, 250, true),
    sku: cleanStorefrontProductText(data.sku, 100),
    promotionProductName: cleanStorefrontProductText(data.promotionProductName, 160),
    promotionProductValue: cleanStorefrontProductText(data.promotionProductValue, 120),
    promotionProductImage: normaliseGiftImageList(data.promotionProductImage || '').join(', '),
    variants,
    image: images[0] || '',
    images,
    bg: safeColor(data.bg, safeColor(existing.bg, '#e9c38b')),
    box: safeColor(data.box, safeColor(existing.box, '#8f1834'))
  };
}

async function saveStorefrontProduct(form, existing, getVariants) {
  await aeonStore.pull();
  const all = [...aeonStore.products()];
  const position = existing.id ? all.findIndex(product => product.id === existing.id) : -1;
  if (existing.id && position < 0) throw new Error('Sản phẩm đã thay đổi ở phiên khác. Hãy tải lại trang trước khi lưu.');
  const stored = position >= 0 ? all[position] : {};
  const product = productFromStorefrontForm(form, stored, getVariants());
  const requestedPosition = Number(form.elements.insertPosition?.value);
  product.id = stored.id || existing.id || `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (position >= 0) all[position] = product;
  else {
    const insertAt = Number.isInteger(requestedPosition)
      ? Math.max(0, Math.min(requestedPosition, all.length))
      : all.length;
    all.splice(insertAt, 0, product);
  }

  const saved = await aeonStore.set('aeon-products', all);
  if (!saved) {
    await aeonStore.pull();
    throw new Error('Không thể lưu sản phẩm. Vui lòng kiểm tra kết nối rồi thử lại.');
  }
  return {created: position < 0, product};
}

function closeStorefrontProductEditor() {
  const modal = $('#storefrontAdminEditor');
  if (!modal?.classList.contains('show')) return false;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  modal.replaceChildren();
  document.body.classList.remove('storefront-admin-editor-open');
  const focusTarget = storefrontAdminLastFocus;
  storefrontAdminLastFocus = null;
  focusTarget?.focus?.();
  return true;
}

function openStorefrontProductEditor(id) {
  if (!isStorefrontAdmin()) return;
  const found = id ? aeonStore.products().find(product => product.id === id) : null;
  if (id && !found) {
    toast('Không tìm thấy sản phẩm cần chỉnh sửa.');
    return;
  }
  const existingImages = found ? normaliseProductImages(found.images, found.image) : [];
  const existing = found ? {...found, image: existingImages[0] || '', images: existingImages, variants: normaliseVariants(found.variants, Math.max(0, Number(found.price) || 0))} : {id: '', name: '', price: '', originalPrice: '', dealSlotsRemaining: 0, dealSlotsTotal: 20, description: '', details: '', label: '', brand: '', productGroup: '', image: '', images: [], weight: '', ingredients: '', sku: '', variants: [], promotionProductName: '', promotionProductValue: '', promotionProductImage: '', bg: '#e9c38b', box: '#8f1834'};
  storefrontAdminLastFocus = document.activeElement;
  let modal = $('#storefrontAdminEditor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storefrontAdminEditor';
    modal.className = 'storefront-admin-editor';
    modal.setAttribute('aria-hidden', 'true');
    document.body.append(modal);
  }

  modal.innerHTML = `<section class="storefront-admin-editor-card" role="dialog" aria-modal="true" aria-labelledby="storefrontEditorTitle">
    <button type="button" class="storefront-admin-editor-close" data-storefront-admin-close aria-label="Đóng chỉnh sửa sản phẩm">×</button>
    <header><p class="eyebrow">CHỈNH SỬA TRỰC TIẾP</p><h2 id="storefrontEditorTitle">${existing.id ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm mới'}</h2><p>Thay đổi sẽ hiển thị ngay trên trang bán hàng sau khi lưu.</p></header>
    <form id="storefrontProductForm">
      <div class="storefront-admin-form-grid">
        <label>Tên sản phẩm<input name="name" required value="${escapeHtml(existing.name)}"></label>
        <label>Nhóm hàng<input name="productGroup" maxlength="100" value="${escapeHtml(existing.productGroup || '')}" placeholder="Ví dụ: Điện gia dụng"></label>
        <label>Thương hiệu<input name="brand" value="${escapeHtml(normaliseAeonBrand(existing.brand))}" placeholder="Nhập tên thương hiệu"><small>Tự động đưa vào bộ lọc thương hiệu sau khi lưu.</small></label>
        ${existing.id ? '' : `<label>Vị trí trong danh sách<select name="insertPosition">${storefrontProductInsertPositionOptions(aeonStore.products())}</select><small>Sản phẩm sẽ được chèn đúng vị trí này khi lưu.</small></label>`}
        <label>Giá khuyến mãi (VNĐ)<small data-variant-price-hint></small><input name="price" type="number" min="0" inputmode="numeric" required value="${existing.price ?? ''}" placeholder="Ví dụ: 750000"${existing.variants?.length ? ' readonly' : ''}></label>
        <label>Giá thường (VNĐ)<input name="originalPrice" type="number" min="0" inputmode="numeric" value="${existing.originalPrice ?? ''}" placeholder="Ví dụ: 900000"><small>Để trống nếu không giảm giá.</small></label>
        <fieldset class="storefront-promotion-fields wide"><legend>Suất đã đặt trước</legend><p>Dải hiển thị số suất đã có người đặt trước; màu chuyển từ vàng sang cam, đỏ khi số người đặt tăng.</p><div class="storefront-admin-form-grid"><label>Số suất đã đặt trước<input name="dealSlotsRemaining" type="number" min="0" max="9999" step="1" value="${cleanDealSlotCount(existing.dealSlotsRemaining, 0)}"></label><label>Tổng số suất<input name="dealSlotsTotal" type="number" min="1" max="9999" step="1" value="${Math.max(1, cleanDealSlotCount(existing.dealSlotsTotal, 20))}"></label></div></fieldset>
        <fieldset class="storefront-promotion-fields wide"><legend>Hàng tặng kèm Black Friday</legend><p>Chỉ cần nhập tên và ảnh quà để hiển thị; giá trị quà là tùy chọn. Có thể nhập tối đa 2 link ảnh, phân cách bằng dấu phẩy.</p><label>Tên sản phẩm khuyến mãi<input name="promotionProductName" maxlength="160" value="${escapeHtml(existing.promotionProductName || '')}" placeholder="Ví dụ: Nồi lẩu điện"></label><label>Giá trị sản phẩm khuyến mãi<input name="promotionProductValue" maxlength="120" value="${escapeHtml(existing.promotionProductValue || '')}" placeholder="Ví dụ: 990.000 ₫"></label><label class="wide">Link ảnh sản phẩm khuyến mãi<input name="promotionProductImage" value="${escapeHtml(existing.promotionProductImage || '')}" placeholder="Link ảnh 1, link ảnh 2"></label></fieldset>
        <label>Nhãn hiển thị<input name="label" value="${escapeHtml(existing.label || '')}" placeholder="Ví dụ: Bán chạy"></label>
        <label>Kích thước<textarea name="weight" rows="2" placeholder="Ví dụ: 4 bánh · 720g">${escapeHtml(existing.weight || '')}</textarea></label>
        <label class="wide">Mô tả ngắn<textarea name="description" required rows="2">${escapeHtml(existing.description || '')}</textarea></label>
        <label>Tính năng nổi bật<textarea name="ingredients" rows="3" placeholder="Mỗi dòng một tính năng">${escapeHtml(existing.ingredients || '')}</textarea></label>
        <label>Mã sản phẩm<input name="sku" value="${escapeHtml(existing.sku || '')}"></label>
        <fieldset class="product-variant-editor wide"><legend>Lựa chọn sản phẩm</legend><p>Một hình có thể đại diện nhiều loại hàng. Khách sẽ chọn loại trước khi thêm vào giỏ.</p><div class="product-variant-rows" data-variant-rows>${(existing.variants || []).map(storefrontVariantRowMarkup).join('')}</div><button type="button" data-add-variant>+ Thêm lựa chọn</button></fieldset>
        <label class="wide">Ảnh chính (URL)<input name="image" value="${escapeHtml(existing.image || '')}" placeholder="https://... hoặc /assets/uploads/ten-anh.png"></label>
        <label class="wide">Ảnh bổ sung (mỗi dòng một URL)<textarea name="images" rows="4" placeholder="https://.../anh-2.jpg&#10;https://.../anh-3.jpg">${escapeHtml((existing.images || []).slice(1).join('\n'))}</textarea><small>Ảnh hiển thị đúng theo thứ tự nhập; khách có thể bấm nút hoặc vuốt để xem.</small></label>
        <div class="storefront-admin-upload wide"><label for="storefrontProductImageFile">Tải một hoặc nhiều ảnh từ máy</label><input id="storefrontProductImageFile" data-storefront-image-file type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button type="button" data-storefront-image-upload>Tải ảnh lên</button></div>
        <label>Màu nền khi chưa có ảnh<input name="bg" type="color" value="${safeColor(existing.bg, '#e9c38b')}"></label>
        <label>Màu hộp khi chưa có ảnh<input name="box" type="color" value="${safeColor(existing.box, '#8f1834')}"></label>
      </div>
      <div class="storefront-admin-image-preview" data-storefront-image-preview aria-live="polite"></div>
      <p class="storefront-admin-editor-status" data-storefront-editor-status aria-live="polite"></p>
      <footer><button type="button" class="storefront-admin-cancel" data-storefront-admin-close>Hủy</button><button type="submit" class="button primary">${existing.id ? 'Lưu sản phẩm' : 'Thêm sản phẩm'}</button></footer>
    </form>
  </section>`;

  const form = modal.querySelector('#storefrontProductForm');
  AEONRichText.bindAll(form);
  const getVariants = bindStorefrontVariantEditor(form);
  const preview = modal.querySelector('[data-storefront-image-preview]');
  const status = modal.querySelector('[data-storefront-editor-status]');
  const uploadButton = modal.querySelector('[data-storefront-image-upload]');
  const fileInput = modal.querySelector('[data-storefront-image-file]');
  renderStorefrontEditorPreview(preview, existing.image, existing.name);
  form.elements.image.addEventListener('input', () => renderStorefrontEditorPreview(preview, form.elements.image.value, form.elements.name.value));
  form.elements.name.addEventListener('input', () => renderStorefrontEditorPreview(preview, form.elements.image.value, form.elements.name.value));
  modal.onclick = event => {
    if (event.target === modal || event.target.closest('[data-storefront-admin-close]')) closeStorefrontProductEditor();
  };
  uploadButton.onclick = async () => {
    try {
      status.textContent = '';
      uploadButton.disabled = true;
      uploadButton.textContent = 'Đang tải...';
      const files = [...fileInput.files];
      if (!files.length) throw new Error('Hãy chọn ít nhất một ảnh trước khi tải lên.');
      const urls = await Promise.all(files.map(uploadStorefrontProductImage));
      const current = normaliseProductImages([form.elements.image.value, form.elements.images.value]);
      const merged = normaliseProductImages([...current, ...urls]);
      form.elements.image.value = merged[0] || '';
      form.elements.images.value = merged.slice(1).join('\n');
      renderStorefrontEditorPreview(preview, form.elements.image.value, form.elements.name.value);
      status.textContent = `${urls.length} ảnh đã tải lên. Bấm nút lưu để áp dụng cho sản phẩm.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      uploadButton.disabled = false;
      uploadButton.textContent = 'Tải ảnh lên';
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    try {
      status.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Đang lưu...';
      const result = await saveStorefrontProduct(form, existing, getVariants);
      closeStorefrontProductEditor();
      refreshStorefront();
      toast(result.created ? `Đã thêm ${result.product.name}.` : `Đã cập nhật ${result.product.name}.`);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = existing.id ? 'Lưu sản phẩm' : 'Thêm sản phẩm';
    }
  };
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('storefront-admin-editor-open');
  modal.querySelector('[data-storefront-admin-close]').focus();
}

async function deleteStorefrontProduct(id) {
  if (!isStorefrontAdmin()) return;
  const product = aeonStore.products().find(item => item.id === id);
  if (!product) {
    toast('Sản phẩm này không còn tồn tại.');
    return;
  }
  if (!confirm(`Xóa sản phẩm “${product.name}”?`)) return;
  try {
    const result = await aeonStore.deleteProduct(id);
    const current = result.product || product;
    closeProductDetail();
    refreshStorefront();
    toast(`Đã xóa ${current.name}.`);
  } catch (error) {
    toast(error.message);
  }
}

function applyGiftRibbonBackground(ui) {
  const configured = normaliseImageUrl(ui.giftRibbonBackgroundImage);
  let imageUrl = '';
  if (configured) {
    try {
      const parsed = new URL(configured, window.location.origin);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:')
        && parsed.href !== AEON_RETIRED_GIFT_RIBBON_BACKGROUND) imageUrl = parsed.href;
    } catch {
      imageUrl = '';
    }
  }
  // Apply the saved setting directly after markup is created. This keeps
  // product cards and the detail view in sync without relying on CSS variable
  // resolution for the selected artwork.
  document.querySelectorAll('.bf-gift-ribbon').forEach(ribbon => {
    ribbon.classList.toggle('has-configured-background', Boolean(imageUrl));
    ribbon.style.setProperty('background-image', 'none', 'important');
    ribbon.style.setProperty('background-color', imageUrl ? 'transparent' : '#bd1222', 'important');
    let artwork = ribbon.querySelector(':scope > .bf-gift-ribbon-background');
    if (!imageUrl) {
      artwork?.remove();
      return;
    }
    if (!artwork) {
      artwork = document.createElement('img');
      artwork.className = 'bf-gift-ribbon-background';
      artwork.alt = '';
      artwork.setAttribute('aria-hidden', 'true');
      artwork.decoding = 'async';
      ribbon.prepend(artwork);
    }
    if (artwork.getAttribute('src') !== imageUrl) artwork.setAttribute('src', imageUrl);
  });
}

function applyUi() {
  const ui = aeonStore.ui();
  applyGiftRibbonBackground(ui);
  const pageTitle = String(ui.title || '').replace(/\s+/g, ' ').trim();
  document.title = pageTitle || 'BlackFriday';
  renderAeonBrandLogos(ui);
  const campaignSchedule = $('.black-friday-bar [data-campaign-schedule]');
  if (campaignSchedule) campaignSchedule.textContent = ui.campaignSchedule || 'ƯU ĐÃI ĐẶC BIỆT';
  const heroSection = $('.hero');
  const heroImageOnly = normaliseHeroDisplayMode(ui.heroDisplayMode) === 'image-only';
  heroSection.classList.toggle('hero-image-only', heroImageOnly);
  placeQuoteDownloadInHero(heroImageOnly);
  const hero = $('.hero-copy');
  hero.querySelector('.eyebrow').textContent = ui.eyebrow;
  hero.querySelector('h1').innerHTML = String(ui.title).split('\n').map((text, index) => index ? `<em>${escapeHtml(text)}</em>` : escapeHtml(text)).join('<br>');
  hero.querySelector('.intro').textContent = ui.intro;
  $('.hero-promotion [data-promotion-title]').textContent = ui.promotionTitle;
  const promotionText = $('.hero-promotion [data-promotion-text]');
  if (window.AEONPromotionRichText?.render) window.AEONPromotionRichText.render(promotionText, ui.promotionText);
  else promotionText.textContent = ui.promotionText;
  renderQuoteDownload(ui);

  const art = $('.hero-art');
  art.querySelector('img')?.remove();
  let official = art.querySelector('.official-hero');
  if (!official) {
    official = document.createElement('div');
    official.className = 'official-hero';
    art.append(official);
  }
  const heroImage = normaliseImageUrl(ui.heroImage);
  official.innerHTML = heroImage ? `<img src="${escapeHtml(heroImage)}" alt="Hình ảnh sản phẩm AEON BlackFriday" data-image-fallback>` : '<span>Hình ảnh chính thức<br>đang cập nhật</span>';
  attachImageFallbacks(official);
}

function safeThemeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function layoutNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function applyLayout(nextLayout = aeonStore.layout()) {
  const layout = {...AEON_DEFAULT_LAYOUT, ...nextLayout};
  const root = document.documentElement;
  const accent = safeThemeColor(layout.accentColor, AEON_DEFAULT_LAYOUT.accentColor);
  const accentDark = safeThemeColor(layout.accentDarkColor, AEON_DEFAULT_LAYOUT.accentDarkColor);
  root.style.setProperty('--red', accent);
  root.style.setProperty('--wine', accentDark);
  root.style.setProperty('--cream', safeThemeColor(layout.pageBackgroundColor, AEON_DEFAULT_LAYOUT.pageBackgroundColor));
  root.style.setProperty('--paper', safeThemeColor(layout.sectionBackgroundColor, AEON_DEFAULT_LAYOUT.sectionBackgroundColor));
  root.style.setProperty('--ink', safeThemeColor(layout.textColor, AEON_DEFAULT_LAYOUT.textColor));

  const headerHeight = layoutNumber(layout.headerHeight, 10, 112, AEON_DEFAULT_LAYOUT.headerHeight);
  const heroHeight = layoutNumber(layout.heroHeight, 0, 700, 0);
  const sectionSpacing = layoutNumber(layout.sectionSpacing, 0, 170, 0);
  const productImageHeight = layoutNumber(layout.productImageHeight, 0, 480, 0);
  const productColumns = layoutNumber(layout.productColumns, 0, 6, 0);
  const productColumnsMobile = layoutNumber(layout.productColumnsMobile, 0, 2, 0);
  const fontFamily = normaliseLayoutFontFamily(layout.fontFamily);
  const logoSize = layoutNumber(layout.logoSize, 18, 48, AEON_DEFAULT_LAYOUT.logoSize);
  const heroTitleSize = layoutNumber(layout.heroTitleSize, 10, 90, AEON_DEFAULT_LAYOUT.heroTitleSize);
  const heroIntroSize = layoutNumber(layout.heroIntroSize, 12, 22, AEON_DEFAULT_LAYOUT.heroIntroSize);
  const productTitleSize = layoutNumber(layout.productTitleSize, 12, 24, AEON_DEFAULT_LAYOUT.productTitleSize);
  const bannerAspectRatio = layoutNumber(layout.bannerAspectRatio, 1.5, 4, AEON_DEFAULT_LAYOUT.bannerAspectRatio);
  const bannerWidthScale = bannerAspectRatio / AEON_DEFAULT_LAYOUT.bannerAspectRatio;
  root.style.setProperty('--admin-header-height', `${headerHeight}px`);
  root.style.setProperty('--admin-hero-height', `${heroHeight}px`);
  root.style.setProperty('--admin-section-spacing', `${sectionSpacing}px`);
  root.style.setProperty('--admin-product-media-height', `${productImageHeight}px`);
  root.style.setProperty('--admin-logo-size', `${logoSize}px`);
  root.style.setProperty('--admin-hero-title-size', `${heroTitleSize}px`);
  root.style.setProperty('--admin-hero-intro-size', `${heroIntroSize}px`);
  root.style.setProperty('--admin-product-title-size', `${productTitleSize}px`);
  root.style.setProperty('--admin-mobile-hero-title-size', `${Math.max(10, heroTitleSize * .8)}px`);
  root.style.setProperty('--admin-mobile-product-title-size', `${Math.max(12, productTitleSize * .9)}px`);
  root.style.setProperty('--admin-mobile-single-product-title-size', `${Math.max(13, productTitleSize * .94)}px`);
  root.style.setProperty('--admin-mobile-compact-product-title-size', `${Math.max(10, productTitleSize * .78)}px`);
  root.style.setProperty('--admin-banner-ratio', String(bannerAspectRatio));
  root.style.setProperty('--admin-banner-width-desktop', `${520 * bannerWidthScale}px`);
  root.style.setProperty('--admin-banner-width-mobile', '100%');
  root.style.setProperty('--admin-font-family', ({
    'be-vietnam-pro': "'Be Vietnam Pro', sans-serif",
    'playfair-display': "'Playfair Display', Georgia, serif",
    arial: 'Arial, Helvetica, sans-serif',
    georgia: "Georgia, 'Times New Roman', serif"
  })[fontFamily] || "'Be Vietnam Pro', sans-serif");
  document.body.classList.toggle('has-custom-hero-height', heroHeight > 0);
  document.body.classList.toggle('has-custom-section-spacing', sectionSpacing > 0);
  document.body.classList.toggle('has-custom-product-media', productImageHeight > 0);
  document.body.classList.toggle('has-custom-product-columns', [1, 2, 3, 4, 5, 6].includes(productColumns));
  document.body.classList.toggle('has-custom-product-columns-mobile', [1, 2].includes(productColumnsMobile));
  document.body.classList.toggle('has-custom-font-family', fontFamily !== 'aeon-default');
  grid.dataset.layoutColumns = [1, 2, 3, 4, 5, 6].includes(productColumns) ? String(productColumns) : '';
  grid.dataset.layoutColumnsMobile = [1, 2].includes(productColumnsMobile) ? String(productColumnsMobile) : '';

  const hero = $('.hero');
  hero.style.setProperty('--admin-hero-title-size', `${heroTitleSize}px`);
  hero.style.setProperty('--admin-hero-intro-size', `${heroIntroSize}px`);
  hero.querySelector('.hero-actions').dataset.buttonAlign = layout.heroButtonAlign;
  grid.style.setProperty('--admin-product-title-size', `${productTitleSize}px`);
  grid.dataset.buttonAlign = layout.productButtonAlign;
  $('.checkout form').dataset.buttonAlign = layout.checkoutButtonAlign;
  scheduleProductPriceFit();
}

function productImageMarkup(product, className, placeholderClass, placeholderText) {
  if (!product.image) return `<span class="${placeholderClass}" data-image-placeholder>${placeholderText}</span>`;
  return `<img class="${className}" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" data-image-fallback><span class="${placeholderClass}" data-image-placeholder hidden>${placeholderText}</span>`;
}

function detailGalleryImages(product, preferredImage = '') {
  return preferredImage
    ? normaliseProductImages([preferredImage, ...(product.images || [])])
    : normaliseProductImages(product.images || [], product.image);
}

function detailGalleryMarkup(product, preferredImage = '') {
  const images = detailGalleryImages(product, preferredImage);
  if (!images.length) return productImageMarkup({...product, image: ''}, 'detail-official-image', 'detail-image-placeholder', 'Hình ảnh chính thức<br>đang cập nhật');
  const controls = images.length > 1
    ? `<button type="button" class="detail-gallery-control is-prev" data-detail-gallery-step="-1" aria-label="Ảnh trước">‹</button><button type="button" class="detail-gallery-control is-next" data-detail-gallery-step="1" aria-label="Ảnh tiếp theo">›</button><span class="detail-gallery-count" aria-live="polite">1 / ${images.length}</span>`
    : '';
  return `<div class="detail-gallery" data-detail-gallery data-gallery-images="${escapeHtml(JSON.stringify(images))}" data-gallery-index="0"><img class="detail-official-image" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.name)} — ảnh 1" data-image-fallback><span class="detail-image-placeholder" data-image-placeholder hidden>Không thể hiển thị ảnh này.</span>${controls}</div>`;
}

function setDetailGalleryImage(gallery, nextIndex) {
  let images = [];
  try { images = JSON.parse(gallery.dataset.galleryImages || '[]'); } catch { images = []; }
  if (!images.length) return;
  const index = (nextIndex + images.length) % images.length;
  const image = gallery.querySelector('.detail-official-image');
  if (!image) return;
  gallery.dataset.galleryIndex = String(index);
  image.hidden = false;
  image.src = images[index];
  image.alt = `${gallery.closest('.product-modal')?.querySelector('.detail-copy h2')?.textContent || 'Sản phẩm'} — ảnh ${index + 1}`;
  gallery.querySelector('[data-image-placeholder]')?.setAttribute('hidden', '');
  const count = gallery.querySelector('.detail-gallery-count');
  if (count) count.textContent = `${index + 1} / ${images.length}`;
}

function bindDetailGallery(scope) {
  const gallery = scope?.querySelector?.('[data-detail-gallery]');
  if (!gallery || gallery.dataset.galleryBound) return;
  gallery.dataset.galleryBound = 'true';
  gallery.addEventListener('click', event => {
    const control = event.target.closest('[data-detail-gallery-step]');
    if (!control) return;
    event.preventDefault();
    setDetailGalleryImage(gallery, Number(gallery.dataset.galleryIndex || 0) + Number(control.dataset.detailGalleryStep));
  });
  let startX = null;
  gallery.addEventListener('touchstart', event => { startX = event.changedTouches[0]?.clientX ?? null; }, {passive: true});
  gallery.addEventListener('touchend', event => {
    const endX = event.changedTouches[0]?.clientX;
    if (startX === null || !Number.isFinite(endX) || Math.abs(endX - startX) < 35) return;
    setDetailGalleryImage(gallery, Number(gallery.dataset.galleryIndex || 0) + (endX < startX ? 1 : -1));
    startX = null;
  }, {passive: true});
}

function attachImageFallbacks(scope = document) {
  scope.querySelectorAll('img[data-image-fallback]').forEach(image => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = 'true';
    image.addEventListener('error', () => {
      image.hidden = true;
      image.parentElement?.querySelector('[data-image-placeholder]')?.removeAttribute('hidden');
    }, {once: true});
  });
}

function normaliseCatalogText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function catalogProductText(product) {
  return normaliseCatalogText([
    product.name,
    product.productGroup,
    product.brand,
    product.label,
    product.sku,
    product.description,
    product.variantLabel,
    ...product.variants.flatMap(variant => [variant.name, variant.sku])
  ].join(' '));
}

function catalogProductPrice(product) {
  const variantPrices = product.variants.map(variant => variant.price).filter(price => price > 0);
  if (variantPrices.length) return Math.min(...variantPrices);
  return product.price > 0 ? product.price : 0;
}

const PRICE_FILTER_LABELS = {
  'under-200k': 'dưới 200.000 ₫',
  '200k-500k': '200.000 – 500.000 ₫',
  '500k-1m': '500.000 – 1.000.000 ₫',
  'over-1m': 'trên 1.000.000 ₫',
  contact: 'liên hệ'
};

function matchesProductPriceFilter(product, filter = productPriceFilterValue) {
  const price = catalogProductPrice(product);
  if (filter === 'all') return true;
  if (filter === 'contact') return price <= 0;
  if (price <= 0) return false;
  if (filter === 'under-200k') return price < 200000;
  if (filter === '200k-500k') return price >= 200000 && price <= 500000;
  if (filter === '500k-1m') return price > 500000 && price <= 1000000;
  if (filter === 'over-1m') return price > 1000000;
  return true;
}

function sortCatalogProducts(items) {
  const sorted = [...items];
  const collator = new Intl.Collator('vi', {sensitivity:'base', numeric:true});
  const [field, direction = 'asc'] = productSortValue.split('-');
  const order = direction === 'desc' ? -1 : 1;

  if (field === 'featured') {
    sorted.sort((first, second) => discountPercent(second) - discountPercent(first) || collator.compare(first.name, second.name));
  } else if (field === 'name') {
    sorted.sort((first, second) => order * collator.compare(first.name, second.name));
  } else if (field === 'group') {
    sorted.sort((first, second) => {
      const firstGroup = String(first.productGroup || '').trim();
      const secondGroup = String(second.productGroup || '').trim();
      if (!firstGroup && secondGroup) return 1;
      if (firstGroup && !secondGroup) return -1;
      return collator.compare(firstGroup, secondGroup);
    });
  } else if (field === 'brand') {
    sorted.sort((first, second) => {
      if (!first.brand && second.brand) return 1;
      if (first.brand && !second.brand) return -1;
      const byBrand = collator.compare(first.brand, second.brand);
      return order * (byBrand || collator.compare(first.name, second.name));
    });
  } else if (field === 'price') {
    sorted.sort((first, second) => {
      const firstPrice = catalogProductPrice(first);
      const secondPrice = catalogProductPrice(second);
      if (!firstPrice && secondPrice) return 1;
      if (firstPrice && !secondPrice) return -1;
      return order * (firstPrice - secondPrice || collator.compare(first.name, second.name));
    });
  }

  return sorted;
}

function updateCatalogResult(visibleCount, totalCount) {
  if (!catalogResult) return;
  const context = [];
  if (activeProductGroup) context.push(`nhóm hàng ${activeProductGroup}`);
  if (activeBrand) context.push(`nhãn hiệu ${activeBrand}`);
  if (productSearchQuery) context.push(`từ khóa “${productSearchQuery}”`);
  if (PRICE_FILTER_LABELS[productPriceFilterValue]) context.push(`giá ${PRICE_FILTER_LABELS[productPriceFilterValue]}`);
  catalogResult.textContent = context.length
    ? `${visibleCount} / ${totalCount} sản phẩm · ${context.join(' · ')}`
    : `${totalCount} sản phẩm`;
}

function renderBrandDirectory() {
  if (!brandDirectory) return;
  activeBrand = normaliseAeonBrand(activeBrand);
  const selectedLabel = activeBrand ? `Đang xem: ${escapeHtml(activeBrand)}` : 'Chọn thương hiệu để lọc sản phẩm';
  const brandToggleLabel = brandDirectoryExpanded ? 'Thu gọn danh sách thương hiệu' : 'Xem thêm thương hiệu để lọc sản phẩm';
  brandDirectory.innerHTML = `<div class="brand-directory-head">
    <div><h3><button type="button" class="brand-directory-toggle" data-brand-directory-toggle aria-label="${brandToggleLabel}" aria-expanded="${brandDirectoryExpanded}" aria-controls="brandDirectoryContent">Thương hiệu <span class="brand-directory-toggle-state">${brandDirectoryExpanded ? 'Thu gọn' : 'Xem thêm'} <b aria-hidden="true">${brandDirectoryExpanded ? '↑' : '↓'}</b></span></button></h3><p>${selectedLabel}</p></div>
  </div>
  <div class="brand-directory-content" id="brandDirectoryContent"${brandDirectoryExpanded ? '' : ' hidden'}>
    <div class="brand-directory-actions"><button type="button" class="brand-filter-reset${activeBrand ? '' : ' is-active'}" data-brand-filter="" aria-pressed="${activeBrand ? 'false' : 'true'}">Tất cả</button></div>
    <div class="brand-groups">${aeonBrandGroups().filter(group => group.brands.length).map(group => `<section class="brand-group"><h4>${escapeHtml(group.name)}</h4><div class="brand-group-list">${group.brands.map(brand => `<button type="button" class="brand-chip${activeBrand === brand.name ? ' is-active' : ''}" data-brand-filter="${escapeHtml(brand.name)}" aria-pressed="${activeBrand === brand.name ? 'true' : 'false'}">${escapeHtml(brand.name)}</button>`).join('')}</div></section>`).join('')}</div>
  </div>`;
}

function renderProductGroupDirectory() {
  if (!productGroupDirectory) return;
  const collator = new Intl.Collator('vi', {sensitivity:'base', numeric:true});
  const groupsByKey = new Map();
  products.forEach(product => {
    const name = String(product.productGroup || '').trim();
    const key = normaliseCatalogText(name);
    if (key && !groupsByKey.has(key)) groupsByKey.set(key, name);
  });
  const groups = [...groupsByKey.values()].sort((first, second) => collator.compare(first, second));
  const selectedLabel = activeProductGroup ? `Đang lọc: ${escapeHtml(activeProductGroup)}` : 'Chọn nhóm hàng để lọc sản phẩm';
  const toggleLabel = productGroupDirectoryExpanded ? 'Thu gọn danh sách nhóm hàng' : 'Xem nhóm hàng để lọc sản phẩm';
  productGroupDirectory.innerHTML = `<div class="brand-directory-head">
    <div><h3><button type="button" class="brand-directory-toggle" data-product-group-toggle aria-label="${toggleLabel}" aria-expanded="${productGroupDirectoryExpanded}" aria-controls="productGroupDirectoryContent">Nhóm hàng <span class="brand-directory-toggle-state">${productGroupDirectoryExpanded ? 'Thu gọn' : 'Chọn nhóm'} <b aria-hidden="true">${productGroupDirectoryExpanded ? '↑' : '↓'}</b></span></button></h3><p>${selectedLabel}</p></div>
  </div>
  <div class="brand-directory-content" id="productGroupDirectoryContent"${productGroupDirectoryExpanded ? '' : ' hidden'}>
    <div class="brand-directory-actions"><button type="button" class="brand-filter-reset${activeProductGroup ? '' : ' is-active'}" data-product-group-filter="" aria-pressed="${activeProductGroup ? 'false' : 'true'}">Tất cả</button></div>
    ${groups.length ? `<div class="brand-group-list">${groups.map(group => { const selected = normaliseCatalogText(activeProductGroup) === normaliseCatalogText(group); return `<button type="button" class="brand-chip${selected ? ' is-active' : ''}" data-product-group-filter="${escapeHtml(group)}" aria-pressed="${selected ? 'true' : 'false'}">${escapeHtml(group)}</button>`; }).join('')}</div>` : '<p class="product-group-empty">Chưa có nhóm hàng. Hãy thêm nhóm hàng trong sản phẩm hoặc cột Nhóm hàng của file Excel.</p>'}
  </div>`;
}

function reconcileCart() {
  const byId = new Map(products.map(product => [product.id, product]));
  const next = cart.map(item => {
    const product = byId.get(item.productId || item.id);
    if (!product) return null;
    let variant = null;
    if (hasVariants(product)) {
      variant = product.variants.find(candidate => candidate.id === item.variantId) || (product.variants.length === 1 && !item.variantId ? product.variants[0] : null);
      if (!variant || variant.price <= 0) return null;
    } else if (product.price <= 0) {
      return null;
    }
    return {...cartItemFromProduct(product, variant), qty: Math.max(1, Number(item.qty) || 1)};
  }).filter(Boolean);
  const changed = JSON.stringify(next) !== JSON.stringify(cart);
  cart = next;
  if (changed) saveCart();
}

function renderProducts() {
  products = aeonStore.products().map(normaliseProduct).filter(product => product.id);
  reconcileCart();
  renderBrandDirectory();
  renderProductGroupDirectory();
  const searchTerm = normaliseCatalogText(productSearchQuery);
  const activeGroupKey = normaliseCatalogText(activeProductGroup);
  const filteredProducts = products.filter(product => {
    const matchesProductGroup = !activeGroupKey || normaliseCatalogText(product.productGroup) === activeGroupKey;
    const matchesBrand = !activeBrand || product.brand === activeBrand;
    const matchesSearch = !searchTerm || catalogProductText(product).includes(searchTerm);
    const matchesPrice = matchesProductPriceFilter(product);
    return matchesProductGroup && matchesBrand && matchesSearch && matchesPrice;
  });
  const visibleProducts = sortCatalogProducts(filteredProducts);
  updateCatalogResult(visibleProducts.length, products.length);
  grid.dataset.productCount = String(visibleProducts.length);
  grid.classList.remove('storefront-admin-grid');

  if (!visibleProducts.length) {
    const emptyContent = products.length
      ? `<div class="catalog-empty brand-empty"><span>✦</span><h3>Không tìm thấy sản phẩm phù hợp</h3><p>Hãy thử từ khóa khác, đổi nhóm hàng hoặc nhãn hiệu, hay xem toàn bộ danh mục.</p><button type="button" class="catalog-admin-add" data-clear-catalog-filters>Xóa bộ lọc</button></div>`
      : `<div class="catalog-empty"><span>✦</span><h3>Danh mục đang được cập nhật</h3><p>Hình ảnh, thông tin sản phẩm và giá bán sẽ được bổ sung ngay khi có công bố chính thức.</p>${isStorefrontAdmin() ? '<button type="button" class="catalog-admin-add" data-storefront-new>+ Tạo sản phẩm đầu tiên</button>' : ''}</div>`;
    grid.innerHTML = emptyContent;
    applyGiftRibbonBackground(aeonStore.ui());
    renderCart();
    return;
  }

  grid.innerHTML = visibleProducts.map(product => {
    const variants = hasVariants(product);
    const canOrder = canOrderProduct(product);
    const discount = discountPercent(product);
    return `<article class="product" data-product-id="${escapeHtml(product.id)}">
      ${storefrontProductAdminActions(product)}
      ${discount ? `<span class="discount-percent product-discount-badge" aria-label="Giảm ${discount} phần trăm">-${discount}%</span>` : ''}
      <button class="product-media product-view" data-view="${escapeHtml(product.id)}" style="--product-bg:${safeColor(product.bg)}" aria-label="Xem chi tiết ${escapeHtml(product.name)}${discount ? `, giảm ${discount}% dịp Black Friday` : ''}">
        ${product.label ? `<span class="tag">${escapeHtml(product.label)}</span>` : ''}
        ${productSaleOverlayMarkup(product)}
        ${productImageMarkup(product, 'product-official-image', 'product-image-placeholder', 'Hình ảnh<br>đang cập nhật')}
      </button>
      <div class="product-info">
        ${product.brand ? `<span class="product-brand">${escapeHtml(product.brand)}</span>` : ''}
        <h3>${escapeHtml(product.name)}</h3>
        <div class="product-bottom">
          ${productPriceMarkup(product, canOrder)}
          <div class="product-bottom-actions">
            ${variants ? `<button class="product-choose" data-view="${escapeHtml(product.id)}" aria-label="Chọn phân loại cho ${escapeHtml(product.name)}">Chọn loại</button>` : canOrder ? `<button class="product-add" data-add="${escapeHtml(product.id)}" aria-label="Thêm ${escapeHtml(product.name)} vào giỏ hàng" title="Thêm vào giỏ hàng"><svg class="product-cart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7.1"></path><circle cx="10" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></svg><span class="sr-only">Thêm vào giỏ hàng</span></button>` : '<a class="product-contact" href="tel:0327747337">Liên hệ</a>'}
          </div>
        </div>
        ${productDealQuotaMarkup(product)}
      </div>
    </article>`;
  }).join('');
  applyGiftRibbonBackground(aeonStore.ui());
  attachImageFallbacks(grid);
  scheduleProductPriceFit();
  renderCart();
}

let productPriceFitFrame = 0;
let productPriceFitFollowUpFrame = 0;

function fitProductPrices() {
  productPriceFitFrame = 0;
  grid?.querySelectorAll('.product-bottom .price').forEach(price => {
    price.style.removeProperty('font-size');
    const defaultSize = Number.parseFloat(getComputedStyle(price).fontSize);
    // A card can change width after images, fonts, or its column layout finish
    // rendering.  Fit against the actual price column, never the whole row.
    const availableWidth = price.parentElement?.clientWidth || price.clientWidth;
    if (!Number.isFinite(defaultSize) || availableWidth <= 0) return;
    price.style.maxWidth = `${Math.floor(availableWidth)}px`;
    const minSize = Math.min(defaultSize, 7);
    if (price.scrollWidth <= price.clientWidth) return;

    let low = minSize;
    let high = defaultSize;
    let fittedSize = minSize;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const candidate = (low + high) / 2;
      price.style.fontSize = `${candidate}px`;
      if (price.scrollWidth <= price.clientWidth) {
        fittedSize = candidate;
        low = candidate;
      } else {
        high = candidate;
      }
    }
    price.style.fontSize = `${fittedSize.toFixed(2)}px`;
  });
}

function scheduleProductPriceFit() {
  cancelAnimationFrame(productPriceFitFrame);
  cancelAnimationFrame(productPriceFitFollowUpFrame);
  productPriceFitFrame = requestAnimationFrame(() => {
    fitProductPrices();
    // Stylesheets are appended dynamically for the storefront.  Measure again
    // on the next paint so a late-loaded theme cannot restore a clipped price.
    productPriceFitFollowUpFrame = requestAnimationFrame(fitProductPrices);
  });
}

window.addEventListener('resize', scheduleProductPriceFit);
window.addEventListener('load', scheduleProductPriceFit, {once: true});
document.fonts?.ready?.then(scheduleProductPriceFit);

document.querySelectorAll('link[rel="stylesheet"]').forEach(stylesheet => {
  stylesheet.addEventListener('load', scheduleProductPriceFit);
});

if (typeof ResizeObserver !== 'undefined' && grid) {
  new ResizeObserver(scheduleProductPriceFit).observe(grid);
}

function saveCart() {
  localStorage.setItem('aeon-blackfriday-cart', JSON.stringify(cart));
}

function totals() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const promo = promotionFor(subtotal);
  const discount = Math.round(subtotal * promo.rate);
  return {count, subtotal, promo, discount, total: subtotal - discount};
}

function cartThumbMarkup(item, className = 'cart-thumb') {
  const style = `style="--swatch:${safeColor(item.bg)}"`;
  return `<div class="${className}" ${style}>${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">` : '✦'}</div>`;
}

function renderCheckoutSummary(summary) {
  const checkoutSummary = $('#checkoutSummary');
  if (!cart.length) {
    checkoutSummary.innerHTML = '<div class="checkout-summary-head"><h3>Đơn hàng của bạn</h3><button type="button" data-checkout-cart>Mở giỏ hàng</button></div><p class="checkout-summary-empty">Bạn chưa chọn sản phẩm. Mở giỏ hàng để bắt đầu.</p>';
    return;
  }

  checkoutSummary.innerHTML = `<div class="checkout-summary-head"><h3>Đơn hàng của bạn (${summary.count})</h3><button type="button" data-checkout-cart>Chỉnh sửa giỏ</button></div>
    ${cart.map(item => `<div class="checkout-summary-item">${cartThumbMarkup(item, 'checkout-summary-thumb')}<div><b>${escapeHtml(item.name)}</b><span>${item.variantName ? `${escapeHtml(item.variantName)} · ` : ''}${item.qty} × ${fmt(item.price)}</span></div><strong>${fmt(item.qty * item.price)}</strong></div>`).join('')}
    <div class="checkout-summary-total"><div><span>Tạm tính</span><b>${fmt(summary.subtotal)}</b></div>${summary.discount ? `<div><span>${escapeHtml(summary.promo.label)}</span><b>−${fmt(summary.discount)}</b></div>` : ''}<div><span>Tổng đơn hàng</span><b>${fmt(summary.total)}</b></div></div>`;
}

function renderCart() {
  const summary = totals();
  $('#cartCount').textContent = summary.count;
  $('#mobileCartCount').textContent = summary.count;
  $('#cartTotal').textContent = fmt(summary.total);
  $('#cartPromotion').innerHTML = summary.promo.rate ? `<b>${escapeHtml(summary.promo.label)}: −${fmt(summary.discount)}</b><span>Tạm tính ${fmt(summary.subtotal)}</span>` : `<span>${escapeHtml(summary.promo.label)}</span>`;
  $('#mobileCart i').textContent = summary.count ? `${fmt(summary.total)} →` : 'Xem giỏ →';

  cartItems.innerHTML = cart.length ? cart.map(item => `<div class="cart-item">${cartThumbMarkup(item)}<div><h3>${escapeHtml(item.name)}</h3>${item.variantName ? `<p class="cart-variant">${escapeHtml(item.variantName)}</p>` : ''}<p>${fmt(item.price)}</p><div class="quantity"><button data-change="${escapeHtml(item.cartKey)}" data-amount="-1" aria-label="Giảm số lượng ${escapeHtml(cartLabel(item))}">−</button><b>${item.qty}</b><button data-change="${escapeHtml(item.cartKey)}" data-amount="1" aria-label="Tăng số lượng ${escapeHtml(cartLabel(item))}">+</button></div><span class="cart-line-total">${fmt(item.qty * item.price)}</span></div><button class="remove" data-remove="${escapeHtml(item.cartKey)}">Xóa</button></div>`).join('') : '<p class="empty-cart">Giỏ hàng của bạn đang trống.<br>Hãy chọn một hộp bánh thật ưng ý.</p>';
  renderCheckoutSummary(summary);
  saveCart();
}

function add(id, quantity = 1, variantId = '') {
  const product = products.find(item => item.id === id);
  if (!product) {
    toast('Giá bán đang cập nhật. Vui lòng liên hệ hotline để được tư vấn.');
    return;
  }
  const variant = hasVariants(product) ? product.variants.find(item => item.id === variantId) : null;
  if (hasVariants(product) && !variant) {
    openProductDetail(id);
    return;
  }
  const cartItem = cartItemFromProduct(product, variant);
  if (cartItem.price <= 0) {
    toast('Giá bán đang cập nhật. Vui lòng liên hệ hotline để được tư vấn.');
    return;
  }
  const existing = cart.find(item => item.cartKey === cartItem.cartKey);
  if (existing) existing.qty += quantity;
  else cart.push({...cartItem, qty: quantity});
  renderCart();
  const name = cartLabel(cartItem);
  toast(quantity > 1 ? `Đã thêm ${quantity} sản phẩm ${name} vào giỏ hàng.` : `Đã thêm ${name} vào giỏ hàng.`, {success:true, viewCart:true});
}

function closeProductDetail() {
  const modal = $('#productDetail');
  if (!modal?.classList.contains('show')) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  lastFocusedElement?.focus?.();
}

function updateDetailVariantSelection(product, variantId) {
  const modal = $('#productDetail');
  const variant = product.variants.find(item => item.id === variantId);
  if (!modal || !variant) return;
  modal.dataset.variantId = variant.id;
  const detailArt = modal.querySelector('.detail-art');
  if (detailArt) {
    detailArt.innerHTML = detailGalleryMarkup(product, variant.image || product.image);
    attachImageFallbacks(detailArt);
    bindDetailGallery(detailArt);
  }
  modal.querySelectorAll('[data-detail-variant]').forEach(button => {
    const selected = button.dataset.detailVariant === variant.id;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#detailPrice').textContent = variant.price > 0 ? fmt(variant.price) : 'Liên hệ';
  const sku = $('#detailSku');
  if (sku) {
    const text = variant.sku ? `Mã sản phẩm: ${variant.sku}` : (product.sku ? `Mã sản phẩm: ${product.sku}` : '');
    sku.textContent = text;
    sku.hidden = !text;
  }
  const status = $('#detailVariantStatus');
  if (status) status.textContent = `Đã chọn: ${variant.name}`;
  const addButton = $('#detailAdd');
  if (addButton) {
    addButton.disabled = variant.price <= 0;
    addButton.innerHTML = variant.price > 0 ? 'Thêm vào giỏ <span>→</span>' : 'Giá đang cập nhật';
  }
}

function openProductDetail(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  lastFocusedElement = document.activeElement;
  let modal = $('#productDetail');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'productDetail';
    modal.className = 'product-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="product-modal-card" role="dialog" aria-modal="true" aria-label="Chi tiết sản phẩm"><button class="modal-close" aria-label="Đóng">×</button><div id="productDetailBody"></div></div>';
    document.body.append(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('.modal-close')) closeProductDetail();
    });
  }

  const variants = hasVariants(product);
  const canOrder = canOrderProduct(product);
  const variantLabel = product.variantLabel || 'Phân loại';
  const variantPrompt = `Chọn ${variantLabel.toLocaleLowerCase('vi-VN')}`;
  const featureText = String(product.ingredients || 'Thông tin đang cập nhật').replace(/\s*-\s*/g, '\n- ');
  $('#productDetailBody').innerHTML = `<div class="detail-art" style="--product-bg:${safeColor(product.bg)}">${productSaleOverlayMarkup(product)}${detailGalleryMarkup(product)}</div>
    <div class="detail-copy">${product.brand ? `<p class="detail-brand">${escapeHtml(product.brand)}</p>` : ''}${product.label ? `<p class="eyebrow">${escapeHtml(product.label)}</p>` : ''}<h2>${escapeHtml(String(product.name || ''))}</h2><p class="detail-price" id="detailPrice">${priceLabel(product)}</p>${variants ? `<section class="detail-variant-picker" aria-labelledby="detailVariantLabel"><div class="detail-variant-head"><span id="detailVariantLabel">${escapeHtml(variantPrompt)}</span><b id="detailVariantStatus">Vui lòng chọn một lựa chọn</b></div><div class="detail-variant-options" role="group" aria-label="${escapeHtml(variantLabel)}">${product.variants.map(variant => `<button type="button" data-detail-variant="${escapeHtml(variant.id)}" aria-pressed="false"><span>${escapeHtml(variant.name)}</span><strong>${variant.price > 0 ? fmt(variant.price) : 'Liên hệ'}</strong></button>`).join('')}</div></section>` : ''}<p class="detail-meta" id="detailSku"${product.sku ? '' : ' hidden'}>${product.sku ? `Mã sản phẩm: ${escapeHtml(product.sku)}` : ''}</p><dl><div><dt>Tính năng nổi bật</dt><dd>${escapeHtml(featureText)}</dd></div><div><dt>Kích thước</dt><dd>${escapeHtml(product.weight || 'Thông tin đang cập nhật')}</dd></div></dl><div class="detail-actions">${variants ? `<button class="button primary" data-detail-add="${escapeHtml(product.id)}" id="detailAdd" disabled>${escapeHtml(variantPrompt)}</button><button class="quantity-button" data-detail-qty="-1" aria-label="Giảm số lượng">−</button><b id="detailQty">1</b><button class="quantity-button" data-detail-qty="1" aria-label="Tăng số lượng">+</button>` : canOrder ? `<button class="button primary" data-detail-add="${escapeHtml(product.id)}" id="detailAdd">Thêm vào giỏ <span>→</span></button><button class="quantity-button" data-detail-qty="-1" aria-label="Giảm số lượng">−</button><b id="detailQty">1</b><button class="quantity-button" data-detail-qty="1" aria-label="Tăng số lượng">+</button>` : '<a class="button primary" href="tel:0327747337">Liên hệ tư vấn <span>→</span></a>'}</div></div>`;
  applyGiftRibbonBackground(aeonStore.ui());
  modal.dataset.id = id;
  modal.dataset.qty = '1';
  modal.dataset.variantId = '';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  attachImageFallbacks($('#productDetailBody'));
  bindDetailGallery($('#productDetailBody'));
  modal.querySelector('.modal-close').focus();
}

function toast(message, options = {}) {
  const element = $('#toast');
  element.replaceChildren();
  element.classList.toggle('toast-success', Boolean(options.success));
  if (options.success) {
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✓';
    element.append(icon);
  }
  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  element.append(text);
  if (options.viewCart) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = 'Xem giỏ';
    action.addEventListener('click', () => {
      clearTimeout(window.toastTimer);
      element.classList.remove('show');
      toggleCart(true);
    });
    element.append(action);
  }
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
}

function toggleCart(force) {
  const drawer = $('#cartDrawer');
  const overlay = $('#overlay');
  const open = force ?? !drawer.classList.contains('open');
  drawer.classList.toggle('open', open);
  overlay.classList.toggle('show', open);
  drawer.setAttribute('aria-hidden', String(!open));
  if (open) $('#closeCart').focus();
}

productSearchForm.addEventListener('submit', event => {
  event.preventDefault();
  productSearchQuery = productSearchInput.value.trim();
  clearProductSearch.hidden = !productSearchQuery;
  renderProducts();
  catalogSection.scrollIntoView({behavior:'smooth', block:'start'});
});

productSearchInput.addEventListener('input', () => {
  productSearchQuery = productSearchInput.value.trim();
  clearProductSearch.hidden = !productSearchQuery;
  renderProducts();
});

clearProductSearch.addEventListener('click', () => {
  productSearchInput.value = '';
  productSearchQuery = '';
  clearProductSearch.hidden = true;
  renderProducts();
  productSearchInput.focus();
});

productSort.addEventListener('change', () => {
  productSortValue = productSort.value;
  renderProducts();
});

productPriceFilter.addEventListener('change', () => {
  productPriceFilterValue = productPriceFilter.value;
  renderProducts();
});

document.addEventListener('click', event => {
  const brandDirectoryToggle = event.target.closest('[data-brand-directory-toggle]');
  if (brandDirectoryToggle) {
    brandDirectoryExpanded = !brandDirectoryExpanded;
    renderBrandDirectory();
    return;
  }

  const productGroupToggle = event.target.closest('[data-product-group-toggle]');
  if (productGroupToggle) {
    productGroupDirectoryExpanded = !productGroupDirectoryExpanded;
    renderProductGroupDirectory();
    return;
  }

  const clearCatalogFilters = event.target.closest('[data-clear-catalog-filters]');
  if (clearCatalogFilters) {
    activeBrand = '';
    activeProductGroup = '';
    productSearchQuery = '';
    productPriceFilterValue = 'all';
    productSearchInput.value = '';
    productPriceFilter.value = 'all';
    clearProductSearch.hidden = true;
    renderProducts();
    return;
  }

  const productGroupFilter = event.target.closest('[data-product-group-filter]');
  if (productGroupFilter) {
    activeProductGroup = productGroupFilter.dataset.productGroupFilter;
    renderProducts();
    return;
  }

  const brandFilter = event.target.closest('[data-brand-filter]');
  if (brandFilter) {
    activeBrand = normaliseAeonBrand(brandFilter.dataset.brandFilter);
    renderProducts();
    return;
  }

  const adminNew = event.target.closest('[data-storefront-new]');
  if (adminNew) {
    openStorefrontProductEditor();
    return;
  }

  if (event.target.closest('[data-storefront-appearance]')) {
    openStorefrontAppearance();
    return;
  }

  const adminEdit = event.target.closest('[data-storefront-edit]');
  if (adminEdit) {
    openStorefrontProductEditor(adminEdit.dataset.storefrontEdit);
    return;
  }

  const adminDelete = event.target.closest('[data-storefront-delete]');
  if (adminDelete) {
    deleteStorefrontProduct(adminDelete.dataset.storefrontDelete);
    return;
  }

  if (event.target.closest('[data-storefront-logout]')) {
    aeonStore.setAdminSession(false);
    renderStorefrontAdminTools();
    renderProducts();
    toast('Đã tắt chế độ quản trị.');
    return;
  }

  const view = event.target.closest('[data-view]');
  if (view) {
    openProductDetail(view.dataset.view);
    return;
  }

  const detailQty = event.target.closest('[data-detail-qty]');
  if (detailQty) {
    const modal = $('#productDetail');
    modal.dataset.qty = String(Math.max(1, Number(modal.dataset.qty) + Number(detailQty.dataset.detailQty)));
    $('#detailQty').textContent = modal.dataset.qty;
    return;
  }

  const detailVariant = event.target.closest('[data-detail-variant]');
  if (detailVariant) {
    const modal = $('#productDetail');
    const product = products.find(item => item.id === modal?.dataset.id);
    if (product) updateDetailVariantSelection(product, detailVariant.dataset.detailVariant);
    return;
  }

  const detailAdd = event.target.closest('[data-detail-add]');
  if (detailAdd) {
    const modal = $('#productDetail');
    add(detailAdd.dataset.detailAdd, Number(modal.dataset.qty), modal.dataset.variantId);
    closeProductDetail();
    return;
  }

  const addButton = event.target.closest('[data-add]');
  if (addButton) {
    add(addButton.dataset.add);
    return;
  }

  const change = event.target.closest('[data-change]');
  if (change) {
    const item = cart.find(cartItem => cartItem.cartKey === change.dataset.change);
    if (item) {
      item.qty += Number(change.dataset.amount);
      if (item.qty < 1) cart = cart.filter(cartItem => cartItem.cartKey !== item.cartKey);
      renderCart();
    }
    return;
  }

  const remove = event.target.closest('[data-remove]');
  if (remove) {
    cart = cart.filter(item => item.cartKey !== remove.dataset.remove);
    renderCart();
    return;
  }

  if (event.target.closest('[data-checkout-cart]')) toggleCart(true);
});

$('#openCart').onclick = () => toggleCart(true);
$('#closeCart').onclick = () => toggleCart(false);
$('#overlay').onclick = () => toggleCart(false);
$('#goCheckout').onclick = () => {
  if (!cart.length) {
    toast('Vui lòng thêm ít nhất một sản phẩm vào giỏ trước khi tiếp tục đặt hàng.');
    return;
  }
  checkoutSection.hidden = false;
  toggleCart(false);
  requestAnimationFrame(() => checkoutSection.scrollIntoView({behavior: 'smooth', block: 'start'}));
};
$('#mobileCart').onclick = () => toggleCart(true);
$('.menu-toggle').onclick = event => {
  const nav = $('nav');
  nav.classList.toggle('show');
  event.currentTarget.setAttribute('aria-expanded', String(nav.classList.contains('show')));
};

async function syncOrderToGoogleSheet(customer, order) {
  const response = await fetch('/api/google-sheet/orders', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({customer, order})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể đồng bộ Google Sheet.');
  return result;
}

async function saveGoogleSheetSyncStatus(orderCode, syncStatus) {
  const latestOrders = aeonStore.orders();
  const updatedOrders = latestOrders.map(order => order.code === orderCode ? {...order, googleSheetSync:syncStatus} : order);
  await aeonStore.set('aeon-orders', updatedOrders);
}

$('#orderForm').addEventListener('submit', async event => {
  event.preventDefault();
  const orderForm = event.currentTarget;
  const error = $('#formError');
  if (!cart.length) {
    error.textContent = 'Vui lòng thêm ít nhất một sản phẩm vào giỏ trước khi đặt hàng.';
    return;
  }
  if (!orderForm.checkValidity()) {
    error.textContent = 'Vui lòng hoàn thiện các thông tin bắt buộc.';
    orderForm.reportValidity();
    return;
  }

  error.textContent = '';
  const submitButton = orderForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const submitButtonHtml = submitButton.innerHTML;
  submitButton.textContent = 'Đang ghi nhận đơn...';
  const summary = totals();
  const form = new FormData(orderForm);
  const name = String(form.get('name') || 'Quý khách');
  const code = `AM${String(Date.now()).slice(-6)}`;
  const customer = {
    id: Date.now(),
    name,
    phone: form.get('phone'),
    email: form.get('email'),
    address: form.get('address'),
    message: form.get('message'),
    createdAt: new Date().toLocaleString('vi-VN')
  };
  const order = {
    code,
    customerId: customer.id,
    items: cart,
    subtotal: summary.subtotal,
    discount: summary.discount,
    promotion: summary.promo.label,
    total: summary.total,
    createdAt: customer.createdAt,
    googleSheetSync: {status:'pending'}
  };
  const customersSaved = await aeonStore.set('aeon-customers', [customer, ...aeonStore.customers()]);
  const ordersSaved = await aeonStore.set('aeon-orders', [order, ...aeonStore.orders()]);
  if (!customersSaved || !ordersSaved) {
    error.textContent = 'Đơn đã được lưu trên thiết bị này nhưng chưa đồng bộ lên máy chủ. Vui lòng kiểm tra kết nối trước khi xuất Excel.';
  }
  try {
    await syncOrderToGoogleSheet(customer, order);
    await saveGoogleSheetSyncStatus(code, {status:'synced', syncedAt:new Date().toISOString()});
  } catch (sheetError) {
    await saveGoogleSheetSyncStatus(code, {status:'failed', failedAt:new Date().toISOString(), message:String(sheetError.message || 'Không thể đồng bộ Google Sheet.').slice(0, 300)});
    if (customersSaved && ordersSaved) error.textContent = 'Đơn đã được lưu thành công. Google Sheet chưa nhận được dữ liệu; quản trị viên cần kiểm tra quyền triển khai Apps Script.';
  }
  $('#successText').innerHTML = `Cảm ơn <b>${escapeHtml(name)}</b>. Đơn hàng <b>${code}</b> đã được ghi nhận${summary.discount ? ` với ưu đãi <b>${escapeHtml(summary.promo.label)}</b> (−${fmt(summary.discount)})` : ''}. Chúng tôi sẽ sớm liên hệ để xác nhận.`;
  $('#successModal').classList.add('show');
  cart = [];
  renderCart();
  orderForm.reset();
  submitButton.disabled = false;
  submitButton.innerHTML = submitButtonHtml;
});

['#closeSuccess', '#doneOrder'].forEach(selector => {
  $(selector).onclick = () => $('#successModal').classList.remove('show');
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (closeStorefrontAppearance()) return;
  if (closeStorefrontProductEditor()) return;
  toggleCart(false);
  $('#successModal').classList.remove('show');
  closeProductDetail();
});

const refreshStorefront = () => {
  renderStorefrontAdminTools();
  applyUi();
  renderProducts();
  applyLayout();
};

window.addEventListener('storage', event => {
  if (['aeon-layout', 'aeon-products', 'aeon-ui', 'aeon-brands', 'aeon-admin'].includes(event.key)) refreshStorefront();
});
window.addEventListener('aeon-store-sync', refreshStorefront);

Promise.resolve(window.aeonStoreReady).finally(() => {
  refreshStorefront();
  document.body.classList.remove('storefront-loading');
});
