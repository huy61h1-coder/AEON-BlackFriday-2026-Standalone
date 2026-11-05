const AEON_DEFAULT_PRODUCTS = [];
// Only storefront settings carrying this revision may replace the current
// Black Friday shell. Product data remains independent and is never cleared.
const AEON_STOREFRONT_REVISION = 'blackfriday-20261104-v7';
function cleanDealSlotCount(value, fallback = 0) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(9999, Math.floor(number))) : fallback;
}
// Brand filters are generated from the products themselves.  Do not add a
// fixed catalogue here: imported/new product brands appear automatically.
const AEON_BRAND_GROUPS = [];

function cleanAeonBrandGroups(value) {
  const source = Array.isArray(value) ? value : AEON_BRAND_GROUPS;
  const groupIds = new Set();
  const brandKeys = new Set();
  return source.slice(0, 20).map((group, groupIndex) => {
    const name = String(group?.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) return null;
    const baseId = String(group?.id || name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || `group-${groupIndex + 1}`;
    let id = baseId;
    let suffix = 2;
    while (groupIds.has(id)) id = `${baseId}-${suffix++}`;
    groupIds.add(id);

    const brands = (Array.isArray(group?.brands) ? group.brands : []).slice(0, 200).map(brand => {
      const brandName = String(brand?.name ?? brand ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const key = aeonBrandKey(brandName);
      if (!brandName || !key || brandKeys.has(key)) return null;
      brandKeys.add(key);
      const aliases = Array.isArray(brand?.aliases)
        ? brand.aliases.map(alias => String(alias || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 12)
        : [];
      return {name: brandName, ...(aliases.length ? {aliases} : {})};
    }).filter(Boolean);
    return {id, name, brands};
  }).filter(Boolean);
}

function aeonBrandGroups() {
  return typeof aeonStore === 'object' && aeonStore?.brands
    ? aeonStore.brands()
    : cleanAeonBrandGroups(AEON_BRAND_GROUPS);
}

function aeonBrands() {
  return aeonBrandGroups().flatMap(group => group.brands.map(brand => ({
    ...brand,
    groupId: group.id,
    groupName: group.name
  })));
}

function aeonBrandHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function aeonBrandKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '');
}

function normaliseAeonBrand(value) {
  const key = aeonBrandKey(value);
  if (!key) return '';
  const matched = aeonBrands().find(brand => [brand.name, ...(brand.aliases || [])].some(alias => aeonBrandKey(alias) === key));
  return matched?.name || String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const AEON_NON_BRAND_PRODUCT_WORDS = new Set([
  'hop','qua','bo','combo','set','tui','chai','goi','san','pham','gia','dinh','cao','cap',
  'sua','tam','dau','goi','xa','nuoc','hoa','kem','duong','da','mat','banh','keo',
  'lo','vi','song','noi','com','dien','may','say','toc','chao','giay','thuc','pham',
  'trang','den','do','xanh','vang','hong','lon','nho','ml','kg','g'
]);

function inferAeonBrandFromProductName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name) return '';

  const foldedName = ` ${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ')} `;
  const known = (typeof aeonStore === 'object' && aeonStore?.brands ? aeonStore.brands() : [])
    .flatMap(group => group.brands || [])
    .map(brand => String(brand?.name || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const matched = known.find(brand => foldedName.includes(` ${brand.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim()} `));
  if (matched) return matched;

  const tokens = name.match(/[\p{L}\p{N}&+.-]+/gu) || [];
  const candidate = tokens.find(token => {
    const key = aeonBrandKey(token);
    return key.length >= 2 && !AEON_NON_BRAND_PRODUCT_WORDS.has(key) && !/^\d+(?:ml|g|kg)?$/i.test(key);
  });
  return candidate ? candidate.slice(0, 120) : '';
}

function aeonBrandOptions(selectedBrand = '') {
  const selected = normaliseAeonBrand(selectedBrand);
  return `<option value="">Chưa chọn thương hiệu</option>${aeonBrandGroups().map(group => `<optgroup label="${aeonBrandHtml(group.name)}">${group.brands.map(brand => `<option value="${aeonBrandHtml(brand.name)}"${brand.name === selected ? ' selected' : ''}>${aeonBrandHtml(brand.name)}</option>`).join('')}</optgroup>`).join('')}`;
}

const AEON_DEFAULT_UI = {
  eyebrow: 'BLACK FRIDAY 2026',
  title: 'BlackFriday',
  intro: 'BlackFriday 2026, Top sản phẩm có giá ưu đãi đặc biệt.',
  heroDisplayMode: 'image-only',
  promotionTitle: 'Thông Tin Chiết Khấu',
  promotionText: 'Ngày 03/08 – 19/08:  từ 1 triệu trở lên: 8%<br>Ngày 20/08 – 25/09:<br>• Từ 3triệu – 10triệu: Chiết khấu 5%|• Trên 10triệu – 15triệu: Chiết khấu 10%<br>• Trên 15triệu – 30triệu: Chiết khấu 12%|• Trên 30triệu: Chiết khấu 15%<br>*Hình thức chiết khấu: Phiếu ưu đãi. Áp dụng cho hộp bánh không rượu.<br>*Không Áp dụng giảm giá ngày Member(5&amp;20).',
  collectionTitle: 'Deal hot\nBlack Friday.',
  collectionNote: 'Sản phẩm minh họa có thể thay nhanh bằng file Excel trong trang quản trị.',
  heroImage: '/assets/black-friday-hero.svg',
  heroPreviewVersion: '',
  logoText: 'AEON',
  logoSubtitle: '',
  logoImage: '',
  logoMode: 'text',
  campaignSchedule: '25/11 – 01/12/2026',
  quoteExcelUrl: '',
  quotePdfUrl: ''
};

function normaliseAeonLogoImage(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return `/${url.replace(/^\.?\//, '')}`;
}

function aeonLogoSettings(ui = {}) {
  const text = String(ui.logoText ?? AEON_DEFAULT_UI.logoText).replace(/\s+/g, ' ').trim().slice(0, 32) || AEON_DEFAULT_UI.logoText;
  const subtitle = String(ui.logoSubtitle ?? AEON_DEFAULT_UI.logoSubtitle)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, 2)
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 80);
  const mode = ['text', 'image', 'image-subtitle'].includes(String(ui.logoMode || '')) ? String(ui.logoMode) : AEON_DEFAULT_UI.logoMode;
  return {
    text,
    subtitle,
    mode,
    image: normaliseAeonLogoImage(ui.logoImage),
    ariaLabel: [text, subtitle.replace(/\n+/g, ' ')].filter(Boolean).join(' ')
  };
}

function renderAeonBrandLogos(ui = {}, root = document) {
  const settings = aeonLogoSettings(ui);
  const faviconUrl = normaliseAeonLogoImage(ui.faviconImage);
  let favicon = document.querySelector('link[data-aeon-favicon]');
  if (faviconUrl) {
    if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; favicon.dataset.aeonFavicon = 'true'; document.head.append(favicon); }
    favicon.href = faviconUrl;
  } else if (favicon) favicon.remove();
  if (!root?.querySelectorAll) return settings;

  root.querySelectorAll('.brand').forEach(brand => {
    const renderText = () => {
      brand.replaceChildren();
      brand.classList.remove('has-brand-image', 'has-brand-subtitle', 'has-multiline-subtitle');
      const text = document.createElement('span');
      text.className = 'brand-text';
      text.textContent = settings.text;
      brand.append(text);
      if (settings.subtitle) {
        const subtitle = document.createElement('small');
        subtitle.className = 'brand-subtitle';
        subtitle.textContent = settings.subtitle;
        brand.append(subtitle);
        brand.classList.toggle('has-multiline-subtitle', settings.subtitle.includes('\n'));
      }
    };

    brand.dataset.logoMode = settings.mode;
    brand.setAttribute('aria-label', settings.ariaLabel || 'Trang chủ');
    const shouldShowImage = settings.image && settings.mode !== 'text';
    if (!shouldShowImage) {
      renderText();
      return;
    }

    brand.replaceChildren();
    brand.classList.add('has-brand-image');
    const image = document.createElement('img');
    image.className = 'brand-logo-image';
    image.src = settings.image;
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      if (image.parentElement === brand) renderText();
    }, {once: true});
    brand.append(image);

    if (settings.mode === 'image-subtitle' && settings.subtitle) {
      brand.classList.add('has-brand-subtitle');
      brand.classList.toggle('has-multiline-subtitle', settings.subtitle.includes('\n'));
      const subtitle = document.createElement('small');
      subtitle.className = 'brand-subtitle';
      subtitle.textContent = settings.subtitle;
      brand.append(subtitle);
    } else {
      brand.classList.remove('has-brand-subtitle', 'has-multiline-subtitle');
    }
  });
  return settings;
}

const AEON_DEFAULT_LAYOUT = {
  storefrontRevision: 'blackfriday-20261104-v7',
  heroTitleSize: 35,
  heroIntroSize: 13,
  bannerAspectRatio: 1.5,
  heroButtonAlign: 'left',
  productTitleSize: 12,
  productButtonAlign: 'left',
  checkoutButtonAlign: 'stretch',
  accentColor: '#e21d3f',
  accentDarkColor: '#9e102a',
  pageBackgroundColor: '#080808',
  sectionBackgroundColor: '#15100f',
  textColor: '#fffaf4',
  headerHeight: 60,
  heroHeight: 0,
  sectionSpacing: 0,
  productImageHeight: 0,
  productColumns: 5,
  productColumnsMobile: 2,
  fontFamily: 'aeon-default',
  logoSize: 18
};

const sharedKeys = ['aeon-products', 'aeon-ui', 'aeon-layout', 'aeon-brands', 'aeon-customers', 'aeon-orders'];
const canSync = () => location.protocol === 'http:' || location.protocol === 'https:';
// This is deliberately memory-only. The former localStorage flag could remain
// after logout or after a deployment and incorrectly turn the public store into
// the retired inline-admin interface.
let verifiedAdminSession = false;

// The server places only storefront-safe data in the first HTML response.
// Hydrate it before rendering so an old device-local layout cannot flash first.
function storefrontStateFromElement(id) {
  try {
    const source = document.getElementById(id)?.textContent || '';
    const state = JSON.parse(source);
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

const serverStorefrontState = storefrontStateFromElement('aeon-public-state');
const deployedStorefrontState = window.AEON_DEPLOYED_STOREFRONT_STATE && typeof window.AEON_DEPLOYED_STOREFRONT_STATE === 'object'
  ? window.AEON_DEPLOYED_STOREFRONT_STATE
  : {};
const initialStorefrontState = Object.keys(serverStorefrontState).length
  ? serverStorefrontState
  : deployedStorefrontState;
// A deployment can retain an older server-side layout while product data is
// current. Do not let that unversioned layout restore the retired storefront.
['aeon-ui', 'aeon-layout'].forEach(key => {
  const deployed = deployedStorefrontState[key];
  const incoming = initialStorefrontState[key];
  if (deployed?.storefrontRevision === AEON_STOREFRONT_REVISION
    && incoming?.storefrontRevision !== AEON_STOREFRONT_REVISION) {
    initialStorefrontState[key] = deployed;
  }
});
// Never let the legacy pink storefront layout override the current Black Friday
// theme on the public/unauthenticated first paint.
const initialLayout = initialStorefrontState['aeon-layout'];
const legacyPinkLayout = initialLayout && ['#ffd1d1', '#f5e5e5'].includes(String(initialLayout.pageBackgroundColor || '').toLowerCase());
if (legacyPinkLayout && deployedStorefrontState['aeon-layout']) {
  initialStorefrontState['aeon-layout'] = {...deployedStorefrontState['aeon-layout'], ...initialLayout,
    pageBackgroundColor: deployedStorefrontState['aeon-layout'].pageBackgroundColor,
    sectionBackgroundColor: deployedStorefrontState['aeon-layout'].sectionBackgroundColor,
    accentColor: deployedStorefrontState['aeon-layout'].accentColor,
    accentDarkColor: deployedStorefrontState['aeon-layout'].accentDarkColor,
    textColor: deployedStorefrontState['aeon-layout'].textColor};
}
['aeon-products', 'aeon-ui', 'aeon-layout', 'aeon-brands'].forEach(key => {
  if (Object.hasOwn(initialStorefrontState, key)) {
    localStorage.setItem(key, JSON.stringify(initialStorefrontState[key]));
  }
});

const aeonStore = {
  writing: new Set(),
  lastWriteAt: Object.create(null),

  get(key, fallback) {
    if (key === 'aeon-layout') {
      const canonical = deployedStorefrontState['aeon-layout'] || AEON_DEFAULT_LAYOUT;
      let saved = {};
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
      } catch {
        // Use deployed layout values when browser storage is unavailable or invalid.
      }
      const desktopColumns = Number(saved.productColumns);
      const mobileColumns = Number(saved.productColumnsMobile);
      return {
        ...canonical,
        productColumns: [0, 1, 2, 3, 4, 5, 6].includes(desktopColumns) ? desktopColumns : canonical.productColumns,
        productColumnsMobile: [0, 1, 2].includes(mobileColumns) ? mobileColumns : canonical.productColumnsMobile
      };
    }
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    if (key === 'aeon-layout') {
      const canonical = deployedStorefrontState['aeon-layout'] || AEON_DEFAULT_LAYOUT;
      const requested = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const current = this.get(key, AEON_DEFAULT_LAYOUT);
      const desktopColumns = Number(requested.productColumns);
      const mobileColumns = Number(requested.productColumnsMobile);
      value = {
        ...canonical,
        productColumns: [0, 1, 2, 3, 4, 5, 6].includes(desktopColumns) ? desktopColumns : current.productColumns,
        productColumnsMobile: [0, 1, 2].includes(mobileColumns) ? mobileColumns : current.productColumnsMobile,
        storefrontRevision: AEON_STOREFRONT_REVISION
      };
    }
    if (key === 'aeon-ui') {
      value = {...(value && typeof value === 'object' ? value : {}), storefrontRevision: AEON_STOREFRONT_REVISION};
    }
    localStorage.setItem(key, JSON.stringify(value));
    if (!sharedKeys.includes(key)) return Promise.resolve(true);

    this.lastWriteAt[key] = Date.now();
    return this.push(key, value);
  },

  async deleteProduct(productId) {
    const id = String(productId || '').trim();
    if (!id || !canSync()) throw new Error('Không thể xác định sản phẩm cần xóa.');
    const response = await fetch(`/api/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      // This also migrates catalogues that still exist only in an older
      // browser-local store before applying the permanent server deletion.
      body: JSON.stringify({products: this.products()})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể xóa sản phẩm khỏi máy chủ.');
    const products = Array.isArray(result.products) ? result.products : [];
    localStorage.setItem('aeon-products', JSON.stringify(products));
    this.lastWriteAt['aeon-products'] = Date.now();
    window.dispatchEvent(new Event('aeon-store-sync'));
    return result;
  },

  isAdminSession() {
    return verifiedAdminSession;
  },

  setAdminSession(active) {
    verifiedAdminSession = Boolean(active);
    try {
      if (active) {
        sessionStorage.setItem('aeon-admin', 'true');
        localStorage.setItem('aeon-admin', 'true');
      } else {
        sessionStorage.removeItem('aeon-admin');
        localStorage.removeItem('aeon-admin');
      }
    } catch {
      // The admin interface will stay unavailable if browser storage is disabled.
    }
  },

  async refreshAdminSession() {
    try {
      const response = await fetch('/api/admin/session', {cache:'no-store', credentials:'same-origin'});
      const result = await response.json().catch(() => ({}));
      this.setAdminSession(Boolean(response.ok && result.authenticated));
      return verifiedAdminSession;
    } catch {
      this.setAdminSession(false);
      return false;
    }
  },

  products() {
    return this.get('aeon-products', AEON_DEFAULT_PRODUCTS);
  },

  ui() {
    return {...AEON_DEFAULT_UI, ...this.get('aeon-ui', {})};
  },

  layout() {
    return this.get('aeon-layout', AEON_DEFAULT_LAYOUT);
  },

  brands() {
    const configured = cleanAeonBrandGroups(this.get('aeon-brands', AEON_BRAND_GROUPS));
    const known = new Set(configured.flatMap(group => group.brands.map(brand => aeonBrandKey(brand.name))));
    const used = this.products()
      .map(product => String(product?.brand || '').replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(brand => brand && !known.has(aeonBrandKey(brand)));
    if (!used.length) return configured;

    const groups = configured.map(group => ({...group, brands: group.brands.map(brand => ({...brand}))}));
    let other = groups.find(group => group.id === 'other');
    if (!other) {
      other = {id: 'other', name: 'Thương hiệu từ sản phẩm', brands: []};
      groups.push(other);
    }
    used.forEach(name => {
      const key = aeonBrandKey(name);
      if (!key || known.has(key)) return;
      known.add(key);
      other.brands.push({name});
    });
    other.brands.sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    return groups;
  },

  customers() {
    return this.get('aeon-customers', []);
  },

  orders() {
    return this.get('aeon-orders', []);
  },

  async push(key, value) {
    if (!canSync()) return false;

    this.writing.add(key);
    try {
      const response = await fetch('/api/state', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key, value})
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Không thể lưu dữ liệu.');
      }
      return true;
    } catch (error) {
      console.warn('AEON store sync failed:', error);
      window.dispatchEvent(new CustomEvent('aeon-store-error', {
        detail: {key, message: error.message || 'Không thể lưu dữ liệu.'}
      }));
      return false;
    } finally {
      this.writing.delete(key);
    }
  },

  async pull(options = {}) {
    if (!canSync()) return false;

    const preserveLocalKeys = new Set(Array.isArray(options.preserveLocalKeys) ? options.preserveLocalKeys : []);

    const startedAt = Date.now();
    try {
      const response = await fetch('/api/state', {cache: 'no-store'});
      if (!response.ok) return false;

      const state = await response.json();
      const available = sharedKeys.filter(key => Object.prototype.hasOwnProperty.call(state, key));
      if (!available.length) {
        sharedKeys.forEach(key => {
          const raw = localStorage.getItem(key);
          if (raw !== null) this.push(key, JSON.parse(raw));
        });
        return true;
      }

      available.forEach(key => {
        // Do not let a slower GET overwrite a just-saved local change.
        if (preserveLocalKeys.has(key) || this.writing.has(key) || (this.lastWriteAt[key] || 0) > startedAt) return;
        // A legacy API payload must not restore the retired storefront after
        // login. Its product catalogue is still accepted independently.
        if ((key === 'aeon-ui' || key === 'aeon-layout')
          && deployedStorefrontState[key]?.storefrontRevision === AEON_STOREFRONT_REVISION
          && state[key]?.storefrontRevision !== AEON_STOREFRONT_REVISION) return;
        localStorage.setItem(key, JSON.stringify(state[key]));
      });
      window.dispatchEvent(new Event('aeon-store-sync'));
      return true;
    } catch (error) {
      console.warn('AEON store refresh failed:', error);
      return false;
    }
  }
};

const sampleProductIds = ['doan-vien', 'nguyet-sac', 'thu-nguyet', 'kim-nguyet', 'an-nhien', 'trang-vien'];
const savedProducts = aeonStore.get('aeon-products', null);
if (Array.isArray(savedProducts) && savedProducts.length === sampleProductIds.length && savedProducts.every(product => sampleProductIds.includes(product.id))) {
  localStorage.removeItem('aeon-products');
}

// Commerce fields have existed under several spreadsheet/header names over time.
// Normalize only missing values so importing a new file or updating the theme can
// never remove a sale price, regular price, discount calculation, or brand.
function aeonCommercePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Math.max(0, Number(digits)) : 0;
}

function productCommerceValue(product, keys) {
  for (const key of keys) {
    const amount = aeonCommercePrice(product?.[key]);
    if (amount > 0) return amount;
  }
  return 0;
}

function hydrateProductCommerceFields() {
  const stored = aeonStore.get('aeon-products', AEON_DEFAULT_PRODUCTS);
  if (!Array.isArray(stored) || !stored.length) return false;

  let changed = false;
  const products = stored.map(product => {
    if (!product || typeof product !== 'object') return product;
    const next = {...product};
    const salePrice = productCommerceValue(product, ['price', 'salePrice', 'promotionalPrice', 'promotionPrice', 'discountPrice', 'giaKhuyenMai', 'giaKM']);
    const regularPrice = productCommerceValue(product, ['originalPrice', 'regularPrice', 'listPrice', 'oldPrice', 'retailPrice', 'normalPrice', 'giaThuong']);
    const inferredBrand = normaliseAeonBrand(product.brand) || inferAeonBrandFromProductName(product.name);

    if (salePrice > 0 && aeonCommercePrice(product.price) !== salePrice) {
      next.price = salePrice;
      changed = true;
    }
    if (regularPrice > salePrice && aeonCommercePrice(product.originalPrice) !== regularPrice) {
      next.originalPrice = regularPrice;
      changed = true;
    }
    if (!String(product.brand || '').trim() && inferredBrand) {
      next.brand = inferredBrand;
      changed = true;
    }
    return next;
  });

  if (changed) {
    localStorage.setItem('aeon-products', JSON.stringify(products));
    aeonStore.lastWriteAt['aeon-products'] = Date.now();
    aeonStore.push('aeon-products', products);
  }
  return changed;
}

// Run before the storefront renders and once again after a remote catalogue is
// received. This keeps legacy imported rows compatible without touching other data.
hydrateProductCommerceFields();

// Let the storefront wait for the server state once on a fresh page load so
// an older browser-local banner never replaces the current shared banner.
// A server-rendered or deployed snapshot is authoritative for the first paint.
// Avoid a second asynchronous request replacing it with stale cached settings.
const initialStorefrontLoad = Object.keys(initialStorefrontState).length
  ? Promise.resolve(true)
  : aeonStore.pull();
window.aeonStoreReady = Promise.all([initialStorefrontLoad, aeonStore.refreshAdminSession()]).then(([result]) => {
  hydrateProductCommerceFields();
  return result;
});
