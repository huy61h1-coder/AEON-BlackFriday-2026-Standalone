const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const canonicalStorefrontState = require('./storefront-state');
const canonicalLayout = canonicalStorefrontState['aeon-layout'];
const {analyseProductFile, kindFromFile} = require('./product-import');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const root = __dirname;
// Mount AEON_DATA_DIR outside the release directory to keep runtime data when
// a deploy replaces the application files.
const dataDir = String(process.env.AEON_DATA_DIR || '').trim()
  ? path.resolve(process.env.AEON_DATA_DIR.trim()) : root;
const uploadDir = dataDir === root ? path.join(root, 'assets', 'uploads') : path.join(dataDir, 'uploads');
const quoteUploadDir = path.join(uploadDir, 'quotes');
const statePath = path.join(dataDir, '.aeon-store.json');
const seedStatePath = path.join(root, '.aeon-store.seed.json');
const maxUploadBytes = 10 * 1024 * 1024;
const maxImportBytes = 15 * 1024 * 1024;
const maxQuoteUploadBytes = 20 * 1024 * 1024;
const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || '');
// When enabled, the committed shell supplies defaults while saved UI and layout
// fields remain authoritative, even when their revision is older.
const lockPublicStorefront = /^(?:1|true|yes|on)$/i.test(String(process.env.AEON_LOCK_STOREFRONT || '').trim());
const googleSheetWebAppUrl = String(process.env.GOOGLE_SHEET_WEB_APP_URL || '').trim();
const microsoftClientId = String(process.env.MICROSOFT_CLIENT_ID || '').trim();
const microsoftClientSecret = String(process.env.MICROSOFT_CLIENT_SECRET || '').trim();
const microsoftTenantId = String(process.env.MICROSOFT_TENANT_ID || 'common').trim() || 'common';
const microsoftRedirectUri = String(process.env.MICROSOFT_REDIRECT_URI || '').trim();
const outlookTokenEncryptionSecret = String(process.env.AEON_OUTLOOK_TOKEN_KEY || '');
const outlookTokenPath = path.join(dataDir, '.aeon-outlook.json');
function publicSupabaseConfig() {
  try {
    const source = fs.readFileSync(path.join(root, 'supabase-config.js'), 'utf8');
    return {
      url: /AEON_SUPABASE_URL\s*=\s*'([^']+)'/.exec(source)?.[1] || '',
      key: /AEON_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(source)?.[1] || ''
    };
  } catch {
    return {url:'', key:''};
  }
}
// This is the public project key already used by the storefront for image
// uploads. State access is governed by the aeon_state RLS policies in the
// bundled migration; deployment environments can override either value.
const bundledSupabaseConfig = publicSupabaseConfig();
const supabaseUrl = String(process.env.SUPABASE_URL || bundledSupabaseConfig.url).replace(/\/+$/, '');
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || bundledSupabaseConfig.key).trim();
const supabaseServerKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseStateKey = supabaseServerKey || supabaseAnonKey;
const outlookStorage = String(process.env.AEON_OUTLOOK_STORAGE || (supabaseUrl || process.env.NODE_ENV === 'production' ? 'supabase' : 'file')).trim().toLowerCase();
const productTombstoneStateKey = 'aeon-product-tombstones';
const cloudStateKeys = ['aeon-products', productTombstoneStateKey, 'aeon-ui', 'aeon-layout', 'aeon-brands', 'aeon-customers', 'aeon-orders'];
const adminSessionCookie = 'aeon_admin_session';
const adminSessionTtlSeconds = 12 * 60 * 60;
const adminSessions = new Map();
const outlookOAuthAttempts = new Map();
const outlookOrderSends = new Set();
let outlookRefreshInFlight = null;
const adminAccountsStateKey = 'aeon-admin-users';
const adminPermissionDefinitions = [
  {id:'products', label:'Sản phẩm & giá'},
  {id:'interface', label:'Nội dung, giao diện & banner'},
  {id:'quotes', label:'File báo giá'},
  {id:'brands', label:'Thương hiệu'},
  {id:'customers', label:'Khách hàng & đơn hàng'}
];
const adminPermissionIds = new Set(adminPermissionDefinitions.map(item => item.id));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.pdf':'application/pdf','.csv':'text/csv; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel'};
// Bump this whenever the storefront shell changes. It fingerprints every
// local CSS/JS URL emitted by the Node deployment, so a CDN cannot revive an
// obsolete interface after a new release.
const storefrontBuild = '20261111-preserve-storefront-data-v87';
const productImageFitCss = '\n/* Server-enforced product commerce lock. */\n.product-media{position:relative!important;overflow:hidden!important;background:#fff!important}.product-media:has(.product-image-placeholder:not([hidden])),.product-media:has(.product-image-placeholder:not([hidden])):before,.product-media .product-image-placeholder:not([hidden]){background:#fff!important}.product-media img.product-official-image{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;margin:0!important;padding:0!important;object-fit:contain!important;object-position:center center!important}.product-price-stack .price,.product-price-stack .regular-price,.product-discount-badge{visibility:visible!important;opacity:1!important}\n';
const noCacheHeaders = {
  'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
  'CDN-Cache-Control':'no-store',
  'Surrogate-Control':'no-store',
  'Pragma':'no-cache',
  'Expires':'0',
  'X-AEON-Build':storefrontBuild
};
const imageExtensions = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg'};
const uploadImageTypes = new Set(Object.keys(imageExtensions));
fs.mkdirSync(dataDir, {recursive:true});
fs.mkdirSync(uploadDir, {recursive:true});
fs.mkdirSync(quoteUploadDir, {recursive:true});
if (dataDir !== root) {
  for (const name of ['.aeon-store.json', '.aeon-outlook.json']) {
    const legacy = path.join(root, name);
    const persistent = path.join(dataDir, name);
    if (!fs.existsSync(persistent) && fs.existsSync(legacy)) fs.copyFileSync(legacy, persistent);
  }
  const legacyUploads = path.join(root, 'assets', 'uploads');
  if (fs.existsSync(legacyUploads)) fs.cpSync(legacyUploads, uploadDir, {recursive:true, force:false});
}

function json(response, status, body) { response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); }
function readBody(request, maxBytes = maxUploadBytes) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; const maxRequestBytes = Math.ceil(maxBytes * 1.38) + 65536; request.on('data', chunk => { size += chunk.length; if (size > maxRequestBytes) { reject(new Error(`Tệp vượt quá dung lượng cho phép (${Math.round(maxBytes / 1024 / 1024)} MB).`)); request.destroy(); return; } chunks.push(chunk); }); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); }); }

function configuredAdmin() {
  return Boolean(adminUsername && adminPassword);
}

function secureTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function adminUsernameMatches(value) {
  return secureTextEqual(
    String(value ?? '').trim().toLocaleLowerCase('vi-VN'),
    adminUsername.toLocaleLowerCase('vi-VN')
  );
}

function normaliseSubAdminUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

function cleanSubAdminDisplayName(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
}

function cleanSubAdminPermissions(value) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map(item => String(item ?? '').trim()).filter(item => adminPermissionIds.has(item)))];
}

function ownerPrincipal() {
  return {
    accountId: 'owner',
    username: adminUsername,
    displayName: 'Quản trị chính',
    isOwner: true,
    permissions: [...adminPermissionIds]
  };
}

function publicAdminPrincipal(principal) {
  if (!principal) return null;
  return {
    username: principal.username,
    displayName: principal.displayName,
    isOwner: Boolean(principal.isOwner),
    permissions: [...new Set(principal.permissions || [])]
  };
}

function hashSubAdminPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifySubAdminPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltText, 'base64url'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function subAdminAccounts(state) {
  return Array.isArray(state?.[adminAccountsStateKey]) ? state[adminAccountsStateKey] : [];
}

function publicSubAdminAccount(account) {
  return {
    id: String(account?.id || ''),
    username: String(account?.username || ''),
    displayName: cleanSubAdminDisplayName(account?.displayName, String(account?.username || '')),
    permissions: cleanSubAdminPermissions(account?.permissions),
    active: account?.active !== false,
    createdAt: String(account?.createdAt || ''),
    updatedAt: String(account?.updatedAt || ''),
    isOwner: false
  };
}

function accountDirectory(state) {
  return [
    {...ownerPrincipal(), id:'owner', active:true, createdAt:'', updatedAt:''},
    ...subAdminAccounts(state).map(publicSubAdminAccount)
  ];
}

function requestCookies(request) {
  return String(request.headers.cookie || '').split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 0) return cookies;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function adminSession(request) {
  const token = requestCookies(request)[adminSessionCookie] || '';
  const session = adminSessions.get(token);
  if (!token || !session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + adminSessionTtlSeconds * 1000;
  adminSessions.set(token, session);
  return {token, principal: publicAdminPrincipal(session)};
}

function adminSessionToken(request) {
  return adminSession(request)?.token || '';
}

function adminPrincipal(request) {
  return adminSession(request)?.principal || null;
}

function isAdminRequest(request) {
  return Boolean(adminPrincipal(request));
}

function principalHasPermission(principal, permission) {
  return Boolean(principal && (principal.isOwner || principal.permissions.includes(permission)));
}

function adminCookie(request, token, maxAge = adminSessionTtlSeconds) {
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = forwardedProtocol === 'https' ? '; Secure' : '';
  return `${adminSessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function requireAdmin(request, response) {
  if (isAdminRequest(request)) return true;
  json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
  return false;
}

function requirePermission(request, response, permission) {
  const principal = adminPrincipal(request);
  if (!principal) {
    json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
    return null;
  }
  if (!principalHasPermission(principal, permission)) {
    json(response, 403, {error:`Tài khoản chưa được cấp quyền “${adminPermissionDefinitions.find(item => item.id === permission)?.label || permission}”.`});
    return null;
  }
  return principal;
}

function requireOwner(request, response) {
  const principal = adminPrincipal(request);
  if (!principal) {
    json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
    return null;
  }
  if (!principal.isOwner) {
    json(response, 403, {error:'Chỉ tài khoản quản trị chính mới được quản lý tài khoản và phân quyền.'});
    return null;
  }
  return principal;
}
function readState() {
  // A corrupt runtime file must not be silently replaced with the seed.
  if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (fs.existsSync(seedStatePath)) return JSON.parse(fs.readFileSync(seedStatePath, 'utf8'));
  return {};
}
function writeLocalState(state) {
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, statePath);
}

function cloudHeaders(prefer = '') {
  return {
    apikey: supabaseStateKey,
    Authorization: `Bearer ${supabaseStateKey}`,
    ...(prefer ? {Prefer: prefer} : {})
  };
}

async function readCloudState() {
  if (!supabaseUrl || !supabaseStateKey) return null;
  const response = await fetch(`${supabaseUrl}/rest/v1/aeon_state?select=key,value`, {
    headers: cloudHeaders()
  });
  if (!response.ok) throw new Error(`Không thể đọc dữ liệu cloud (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const state = {};
  rows.forEach(row => {
    if (cloudStateKeys.includes(row?.key)) state[row.key] = row.value;
  });
  return Object.keys(state).length ? state : null;
}

async function writeCloudState(state, changedKeys = cloudStateKeys) {
  if (!supabaseUrl || !supabaseStateKey) return;
  const requestedKeys = Array.isArray(changedKeys) ? changedKeys : cloudStateKeys;
  const rows = cloudStateKeys
    // Persist only the key requested by the caller. Writing a UI/layout change
    // must never re-save an older in-memory product catalogue or its images.
    .filter(key => requestedKeys.includes(key))
    .filter(key => Object.hasOwn(state || {}, key))
    .map(key => ({key, value: state[key], updated_at: new Date().toISOString()}));
  if (!rows.length) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/aeon_state?on_conflict=key`, {
    method: 'POST',
    headers: {...cloudHeaders('resolution=merge-duplicates,return=minimal'), 'Content-Type':'application/json'},
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Không thể lưu dữ liệu cloud (HTTP ${response.status}).`);
}

const bundledGiftDefaults = {
  name: 'nồi cơm mini',
  value: '699.000đ',
  image: 'https://product.hstatic.net/200000274675/product/dfb-c16k1_ab7703a6eeb644249f75dd1b5170414a_1024x1024.png'
};
function clearBundledGiftDefaults(state) {
  const products = Array.isArray(state?.['aeon-products']) ? state['aeon-products'] : [];
  let changed = false;
  const nextProducts = products.map(product => {
    const isBundledExample = String(product?.id || '') === '09680425'
      && String(product?.name || '') === 'NỒI LẨU NƯỚNG ĐA NĂNG BEAR 4L DHG-C40W2'
      && String(product?.promotionProductName || '').trim().toLocaleLowerCase('vi-VN') === bundledGiftDefaults.name
      && String(product?.promotionProductValue || '').trim().toLocaleLowerCase('vi-VN') === bundledGiftDefaults.value
      && String(product?.promotionProductImage || '').trim() === bundledGiftDefaults.image
      && (!product?.promoName || String(product.promoName).trim().toLocaleLowerCase('vi-VN') === bundledGiftDefaults.name)
      && (!product?.promoValue || String(product.promoValue).trim().toLocaleLowerCase('vi-VN') === bundledGiftDefaults.value)
      && (!product?.promoImage || String(product.promoImage).trim() === bundledGiftDefaults.image);
    if (!isBundledExample) return product;
    changed = true;
    return {...product, promotionProductName:'', promotionProductValue:'', promotionProductImage:'', promoName:'', promoValue:'', promoImage:''};
  });
  if (changed) state['aeon-products'] = nextProducts;
  return changed;
}

// Cloud state is authoritative when configured. AEON_DATA_DIR provides a
// persistent local copy for hosts with a mounted data directory.
// Also remove only the exact gift values from the original bundled demo item.
const stateReady = readCloudState()
  .then(async cloudState => {
    const state = {...readState(), ...(cloudState || {})};
    const giftDefaultsCleared = clearBundledGiftDefaults(state);
    const missingCloudKeys = cloudStateKeys.filter(key =>
      Object.hasOwn(state, key) && !Object.hasOwn(cloudState || {}, key));
    if (cloudState || giftDefaultsCleared || (supabaseUrl && supabaseStateKey)) writeLocalState(state);
    if (missingCloudKeys.length) await writeCloudState(state, missingCloudKeys);
    if (giftDefaultsCleared) await writeCloudState(state, ['aeon-products']);
  })
  .catch(error => console.warn(`AEON state initialization failed: ${error.message}`));

async function writeState(state, changedKeys = []) {
  writeLocalState(state);
  await writeCloudState(state, changedKeys);
}

function publicStorefrontState(state, useCanonicalShell = lockPublicStorefront) {
  const visible = {};
  ['aeon-products', 'aeon-brands'].forEach(key => {
    if (Object.hasOwn(state || {}, key)) visible[key] = state[key];
  });
  if (useCanonicalShell) {
    visible['aeon-ui'] = {...canonicalStorefrontState['aeon-ui'], ...(state?.['aeon-ui'] || {})};
    visible['aeon-layout'] = publicLayoutForState(state);
  } else {
    if (Object.hasOwn(state || {}, 'aeon-ui')) visible['aeon-ui'] = state['aeon-ui'];
    visible['aeon-layout'] = publicLayoutForState(state);
  }
  return visible;
}

function publicLayoutForState(state) {
  const saved = state?.['aeon-layout'] && typeof state['aeon-layout'] === 'object' ? state['aeon-layout'] : {};
  const desktopColumns = Number(saved.productColumns);
  const mobileColumns = Number(saved.productColumnsMobile);
  return {
    ...canonicalLayout,
    ...saved,
    productColumns: [0, 1, 2, 3, 4, 5, 6].includes(desktopColumns) ? desktopColumns : canonicalLayout.productColumns,
    productColumnsMobile: [0, 1, 2].includes(mobileColumns) ? mobileColumns : canonicalLayout.productColumnsMobile
  };
}

function productTombstones(state) {
  return new Set((Array.isArray(state?.[productTombstoneStateKey]) ? state[productTombstoneStateKey] : [])
    .map(id => String(id || '').trim().slice(0, 100))
    .filter(Boolean));
}

function withoutDeletedProducts(state, products) {
  const deletedIds = productTombstones(state);
  return (Array.isArray(products) ? products : []).filter(product => !deletedIds.has(String(product?.id || '')));
}

function stateForRequest(request) {
  const state = readState();
  const principal = adminPrincipal(request);
  const visible = publicStorefrontState(state, lockPublicStorefront && !principal);
  if (principalHasPermission(principal, 'customers')) {
    ['aeon-customers', 'aeon-orders'].forEach(key => {
      if (Object.hasOwn(state, key)) visible[key] = state[key];
    });
  }
  return visible;
}

function valuesMatch(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && valuesMatch(left[key], right[key]));
}

function quoteFileOnlyUiChange(previous, next) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
  const allowedKeys = new Set(['quoteExcelUrl', 'quotePdfUrl']);
  const previousUi = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const keys = new Set([...Object.keys(previousUi), ...Object.keys(next)]);
  return [...keys].every(key => allowedKeys.has(key) || valuesMatch(previousUi[key], next[key]));
}

function revokeSubAdminSessions(accountId) {
  for (const [token, session] of adminSessions.entries()) {
    if (session.accountId === accountId) adminSessions.delete(token);
  }
}

function escapeHtmlAttribute(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}

function requestOrigin(request) {
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
  const hostHeader = String(request.headers['x-forwarded-host'] || request.headers.host || `127.0.0.1:${port}`).split(',')[0].trim();
  try {
    return new URL(`${protocol}://${hostHeader}`).origin;
  } catch {
    return `http://127.0.0.1:${port}`;
  }
}

function localAssetPath(source) {
  if (source.startsWith('/assets/uploads/')) {
    const file = path.resolve(uploadDir, source.slice('/assets/uploads/'.length));
    return file.startsWith(`${uploadDir}${path.sep}`) ? file : null;
  }
  const file = path.resolve(root, `.${source}`);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

function socialPreviewVersion(imagePath) {
  if (imagePath.startsWith('/')) {
    const localPath = localAssetPath(imagePath);
    if (localPath) {
      try { return Math.round(fs.statSync(localPath).mtimeMs).toString(36); }
      catch { /* Use the image path below when the local file has not been created yet. */ }
    }
  }
  return crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 12);
}

function currentHeroImage(state) {
  const configuredImage = String(state?.['aeon-ui']?.heroImage || '').trim();
  return /^(?:https?:\/\/|\/)/i.test(configuredImage) ? configuredImage : 'https://res.cloudinary.com/rnrbw9za/image/upload/v1793679407/bf_yggx12.png';
}

function safeHeroPreviewVersion(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function heroPreviewVersion(state) {
  const savedVersion = safeHeroPreviewVersion(state?.['aeon-ui']?.heroPreviewVersion);
  return savedVersion || socialPreviewVersion(currentHeroImage(state));
}

function versionedHeroImage(imagePath, previewVersion = '') {
  try {
    const imageUrl = new URL(imagePath, 'http://aeon.local');
    imageUrl.searchParams.set('v', safeHeroPreviewVersion(previewVersion) || socialPreviewVersion(imagePath));
    return /^https?:\/\//i.test(imagePath) ? imageUrl.href : `${imageUrl.pathname}${imageUrl.search}`;
  } catch {
    return imagePath;
  }
}

function socialPreviewImage(imagePath, previewVersion = '') {
  try {
    const imageUrl = new URL(imagePath, 'http://aeon.local');
    if (imageUrl.hostname === 'res.cloudinary.com' && imageUrl.pathname.includes('/image/upload/')) {
      imageUrl.pathname = imageUrl.pathname.replace('/image/upload/', '/image/upload/f_jpg,q_auto,w_1200,h_630,c_fill/');
    }
    const transformed = /^https?:\/\//i.test(imagePath) ? imageUrl.href : imageUrl.pathname;
    return versionedHeroImage(transformed, previewVersion);
  } catch {
    return versionedHeroImage(imagePath, previewVersion);
  }
}

function storefrontPageTitle(ui) {
  const titleText = String(ui?.title || '').replace(/\s+/g, ' ').trim();
  return titleText || 'BlackFriday';
}

function socialPreviewTitle(request, ui) {
  // Keep browser, storefront and social previews on the same campaign title.
  return storefrontPageTitle(ui);
}

function socialPreviewMeta(request, state) {
  const ui = state?.['aeon-ui'] || {};
  const currentImage = currentHeroImage(state);
  const previewVersion = heroPreviewVersion(state);
  const heroImage = socialPreviewImage(currentImage, previewVersion);
  let imageUrl;
  try {
    imageUrl = new URL(heroImage, requestOrigin(request));
  } catch {
    return '';
  }
  const title = socialPreviewTitle(request, ui);
  const description = String(ui.intro || 'BlackFriday 2026, Top sản phẩm có giá ưu đãi đặc biệt.').replace(/\s+/g, ' ').trim();
  const previewUrl = new URL('/index.html', requestOrigin(request));
  previewUrl.searchParams.set('preview', `${previewVersion}-host`);
  const pageUrl = previewUrl.href;
  return `<meta property="og:type" content="website" />\n  <meta property="og:locale" content="vi_VN" />\n  <meta property="og:title" content="${escapeHtmlAttribute(title)}" />\n  <meta property="og:description" content="${escapeHtmlAttribute(description)}" />\n  <meta property="og:url" content="${escapeHtmlAttribute(pageUrl)}" />\n  <meta property="og:image" content="${escapeHtmlAttribute(imageUrl.href)}" />\n  <meta property="og:image:secure_url" content="${escapeHtmlAttribute(imageUrl.href)}" />\n  <meta property="og:image:alt" content="${escapeHtmlAttribute(title)}" />\n  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="${escapeHtmlAttribute(title)}" />\n  <meta name="twitter:description" content="${escapeHtmlAttribute(description)}" />\n  <meta name="twitter:image" content="${escapeHtmlAttribute(imageUrl.href)}" />`;
}

function publicStoreStateMarkup(state) {
  const publicState = publicStorefrontState(state);
  const encoded = JSON.stringify(publicState)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script id="aeon-public-state" type="application/json">${encoded}</script>`;
}

function layoutNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function layoutColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function initialLayoutStyle(state) {
  const layout = publicLayoutForState(state);
  const headerHeight = layoutNumber(layout.headerHeight, 10, 112, 82);
  const heroHeight = layoutNumber(layout.heroHeight, 0, 700, 0);
  const sectionSpacing = layoutNumber(layout.sectionSpacing, 0, 170, 0);
  const productImageHeight = layoutNumber(layout.productImageHeight, 0, 480, 0);
  const productColumns = layoutNumber(layout.productColumns, 0, 6, 0);
  const productColumnsMobile = layoutNumber(layout.productColumnsMobile, 0, 2, 0);
  const heroTitleSize = layoutNumber(layout.heroTitleSize, 10, 90, 68);
  const heroIntroSize = layoutNumber(layout.heroIntroSize, 12, 22, 15);
  const productTitleSize = layoutNumber(layout.productTitleSize, 12, 24, 15);
  const logoSize = layoutNumber(layout.logoSize, 18, 48, 25);
  const bannerRatio = layoutNumber(layout.bannerAspectRatio, 1.5, 4, 21 / 9);
  const desktopColumns = [1, 2, 3, 4, 5, 6].includes(productColumns)
    ? `.products:not([data-product-count="1"]):not([data-product-count="2"]){grid-template-columns:repeat(${productColumns},minmax(0,1fr))!important}`
    : '';
  const mobileColumns = [1, 2].includes(productColumnsMobile)
    ? `.products:not([data-product-count="1"]){grid-template-columns:${productColumnsMobile === 1 ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))'}!important}`
    : '';
  const fontFamily = ({
    'be-vietnam-pro': "'Be Vietnam Pro',sans-serif",
    'playfair-display': "'Playfair Display',Georgia,serif",
    arial: 'Arial,Helvetica,sans-serif',
    georgia: "Georgia,'Times New Roman',serif"
  })[String(layout.fontFamily || '')] || '';
  const fontRule = fontFamily ? `body,body button,body input,body textarea,body select,body h1,body h2,body h3,body h4,body h5,body h6{font-family:${fontFamily}!important}` : '';
  const sectionRule = sectionSpacing ? `.collection,.checkout{padding-top:${sectionSpacing}px!important;padding-bottom:${sectionSpacing}px!important}` : '';
  const mediaRule = productImageHeight ? `.product-media{height:${productImageHeight}px!important;aspect-ratio:auto!important}` : '';
  // This lock is generated by the server on every page request. Some deployment
  // environments keep older static CSS files on a persistent volume, so the
  // critical image-fit rule must not depend on those files being refreshed.
  const productImageFitRule = productImageFitCss;
  const heroHeightRule = heroHeight ? `.hero{min-height:${heroHeight}px!important}` : '';
  const mobileHeader = Math.min(84, Math.max(10, headerHeight * .75));
  return `<style id="aeon-initial-layout">body.storefront-loading>*{visibility:hidden!important}:root{--red:${layoutColor(layout.accentColor, '#a9163a')};--wine:${layoutColor(layout.accentDarkColor, '#71162b')};--cream:${layoutColor(layout.pageBackgroundColor, '#fbf8f1')};--paper:${layoutColor(layout.sectionBackgroundColor, '#f2ede2')};--ink:${layoutColor(layout.textColor, '#242224')};--admin-header-height:${headerHeight}px;--admin-hero-height:${heroHeight}px;--admin-section-spacing:${sectionSpacing}px;--admin-product-media-height:${productImageHeight}px;--admin-logo-size:${logoSize}px;--admin-hero-title-size:${heroTitleSize}px;--admin-hero-intro-size:${heroIntroSize}px;--admin-product-title-size:${productTitleSize}px;--admin-mobile-hero-title-size:${Math.max(10, heroTitleSize * .8)}px;--admin-mobile-product-title-size:${Math.max(12, productTitleSize * .9)}px;--admin-mobile-single-product-title-size:${Math.max(13, productTitleSize * .94)}px;--admin-mobile-compact-product-title-size:${Math.max(10, productTitleSize * .78)}px;--admin-banner-ratio:${bannerRatio};--admin-banner-width-desktop:${520 * bannerRatio / (21 / 9)}px}${fontRule}${heroHeightRule}${sectionRule}${mediaRule}${productImageFitRule}@media(min-width:761px){.site-header{height:${headerHeight}px!important}.site-header nav{top:${headerHeight}px!important}.brand{font-size:${logoSize}px!important}.hero h1{font-size:${heroTitleSize}px!important}.hero .intro{font-size:${heroIntroSize}px!important}.product-info h3{font-size:${productTitleSize}px!important}${desktopColumns}}@media(max-width:760px){.site-header{height:${mobileHeader}px!important}.site-header nav{top:${mobileHeader}px!important}.brand{font-size:${logoSize * .88}px!important}.hero h1{font-size:${Math.max(10, heroTitleSize * .8)}px!important}.hero .intro{font-size:${heroIntroSize}px!important}.product-info h3{font-size:${Math.max(12, productTitleSize * .9)}px!important}${mobileColumns}}</style>`;
}

function storefrontHtml(request) {
  const state = readState();
  // Version every local CSS/JS asset in the server response. A few clients had
  // retained an old app bundle even after a deploy, which restored the former
  // layout and object-fit:cover rule. The source files remain unchanged; only
  // the response URLs receive the current build marker.
  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/\b(href|src)="((?!https?:|\/\/)[^"]+\.(?:css|js))(?:\?[^"]*)?"/g, `$1="$2?v=${storefrontBuild}"`);
  const heroImage = escapeHtmlAttribute(versionedHeroImage(currentHeroImage(state), heroPreviewVersion(state)));
  const pageTitle = escapeHtmlAttribute(storefrontPageTitle(state['aeon-ui']));
  return template
    .replace(/<!-- SOCIAL_PREVIEW_START -->[\s\S]*?<!-- SOCIAL_PREVIEW_END -->/, socialPreviewMeta(request, state))
    .replace('<!-- PUBLIC_STORE_STATE -->', publicStoreStateMarkup(state))
    .replace('<!-- INITIAL_LAYOUT -->', initialLayoutStyle(state))
    .replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`)
    .replace('src="https://res.cloudinary.com/rnrbw9za/image/upload/v1793679407/bf_yggx12.png"', `src="${heroImage}"`);
}

function spreadsheetText(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function spreadsheetNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function worksheetFromRows(headers, rows, widths) {
  const values = [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))];
  const worksheet = XLSX.utils.aoa_to_sheet(values);
  worksheet['!cols'] = widths.map(width => ({wch: width}));
  worksheet['!autofilter'] = {ref: 'A1:' + XLSX.utils.encode_col(headers.length - 1) + Math.max(values.length, 2)};
  return worksheet;
}

function customerWorkbook(state) {
  const customers = Array.isArray(state['aeon-customers']) ? state['aeon-customers'] : [];
  const orders = Array.isArray(state['aeon-orders']) ? state['aeon-orders'] : [];
  const customerById = new Map(customers.map(customer => [String(customer?.id ?? ''), customer]));
  const customerHeaders = ['STT', 'Mã khách hàng', 'Họ và tên', 'Điện thoại', 'Email', 'Địa chỉ', 'Lời nhắn', 'Số đơn hàng', 'Tổng chi tiêu (VNĐ)', 'Ngày ghi nhận'];
  const customerRows = customers.map((customer, index) => {
    const customerId = String(customer?.id ?? '');
    const relatedOrders = orders.filter(order => String(order?.customerId ?? '') === customerId);
    return {
      'STT': index + 1,
      'Mã khách hàng': spreadsheetText(customerId),
      'Họ và tên': spreadsheetText(customer?.name),
      'Điện thoại': spreadsheetText(customer?.phone),
      'Email': spreadsheetText(customer?.email),
      'Địa chỉ': spreadsheetText(customer?.address),
      'Lời nhắn': spreadsheetText(customer?.message),
      'Số đơn hàng': relatedOrders.length,
      'Tổng chi tiêu (VNĐ)': relatedOrders.reduce((total, order) => total + spreadsheetNumber(order?.total), 0),
      'Ngày ghi nhận': spreadsheetText(customer?.createdAt)
    };
  });

  const orderHeaders = ['Thời gian nhận', 'Mã đơn hàng', 'Mã khách hàng', 'Họ và tên', 'Số điện thoại', 'Email', 'Địa chỉ', 'Lời nhắn', 'Sản phẩm, mã sản phẩm, số lượng', 'Đơn giá (VNĐ)', 'Thành tiền (VNĐ)', 'Tổng thanh toán (VNĐ)', 'Ưu đãi'];
  const orderRows = orders.map(order => {
    const customer = customerById.get(String(order?.customerId ?? '')) || {};
    const items = Array.isArray(order?.items) ? order.items : [];
    const products = items.map(item => {
      const name = spreadsheetText(item?.name || 'Sản phẩm');
      const variant = spreadsheetText(item?.variantName || item?.variantLabel || item?.variant || '');
      const productCode = spreadsheetText(item?.variantSku || item?.sku || item?.id || '');
      const quantity = Math.max(1, spreadsheetNumber(item?.quantity ?? item?.qty ?? 1));
      return name + (variant ? ' – ' + variant : '') + (productCode ? ' | Mã: ' + productCode : '') + ' | SL: ' + quantity;
    }).join('\n');
    const unitPrices = items.map(item => spreadsheetNumber(item?.unitPrice ?? item?.price)).join('\n');
    const lineTotals = items.map(item => {
      const quantity = Math.max(1, spreadsheetNumber(item?.quantity ?? item?.qty ?? 1));
      return quantity * spreadsheetNumber(item?.unitPrice ?? item?.price);
    }).join('\n');
    const promotion = spreadsheetText(order?.promotion);
    const discount = spreadsheetNumber(order?.discount);
    return {
      'Thời gian nhận': spreadsheetText(order?.createdAt),
      'Mã đơn hàng': spreadsheetText(order?.code),
      'Mã khách hàng': spreadsheetText(order?.customerId),
      'Họ và tên': spreadsheetText(customer?.name),
      'Số điện thoại': spreadsheetText(customer?.phone),
      'Email': spreadsheetText(customer?.email),
      'Địa chỉ': spreadsheetText(customer?.address),
      'Lời nhắn': spreadsheetText(customer?.message),
      'Sản phẩm, mã sản phẩm, số lượng': products,
      'Đơn giá (VNĐ)': unitPrices,
      'Thành tiền (VNĐ)': lineTotals,
      'Tổng thanh toán (VNĐ)': spreadsheetNumber(order?.total),
      'Ưu đãi': promotion + (discount ? (promotion ? ' – ' : '') + 'Giảm ' + discount + ' VNĐ' : '')
    };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheetFromRows(customerHeaders, customerRows, [7, 18, 24, 16, 28, 38, 36, 13, 20, 22]), 'Khách hàng');
  XLSX.utils.book_append_sheet(workbook, worksheetFromRows(orderHeaders, orderRows, [22, 18, 18, 24, 16, 28, 38, 36, 58, 22, 22, 22, 30]), 'Đơn hàng');
  return XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx', compression: true});
}

const pdfRegularFont = [
  path.join(root, 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  'C:\\Windows\\Fonts\\arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
].find(fontPath => fs.existsSync(fontPath)) || 'Helvetica';
const pdfBoldFont = [
  path.join(root, 'assets', 'fonts', 'NotoSans-Bold.ttf'),
  'C:\\Windows\\Fonts\\arialbd.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
].find(fontPath => fs.existsSync(fontPath)) || 'Helvetica-Bold';
const pdfMoney = new Intl.NumberFormat('vi-VN');

function cleanPdfText(value, limit = 1000) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit);
}

function formatPdfMoney(value) {
  return `${pdfMoney.format(Math.max(0, Math.round(Number(value) || 0)))} đ`;
}

function safeCatalogLink(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function directGoogleDriveImage(value) {
  const url = String(value || '').trim();
  const match = /^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i.exec(url);
  return match ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(match[1])}` : url;
}

async function orderImageBuffer(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  if (source.startsWith('/')) {
    const imagePath = localAssetPath(source);
    if (!imagePath) return null;
    if (!/\.(?:png|jpe?g)$/i.test(imagePath)) return null;
    try {
      const content = await fs.promises.readFile(imagePath);
      return content.length <= 5 * 1024 * 1024 ? content : null;
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(source)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const remote = await fetch(directGoogleDriveImage(source), {signal:controller.signal, redirect:'follow'});
    clearTimeout(timer);
    if (!remote.ok) return null;
    const contentType = String(remote.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('image/png') && !contentType.includes('image/jpeg')) return null;
    const content = Buffer.from(await remote.arrayBuffer());
    return content.length <= 5 * 1024 * 1024 ? content : null;
  } catch {
    return null;
  }
}

async function orderPdfBuffer(state, requestedCode) {
  const orders = Array.isArray(state['aeon-orders']) ? state['aeon-orders'] : [];
  const customers = Array.isArray(state['aeon-customers']) ? state['aeon-customers'] : [];
  const order = orders.find(entry => String(entry?.code || '') === String(requestedCode || ''));
  if (!order) {
    const error = new Error('Không tìm thấy đơn hàng.');
    error.statusCode = 404;
    throw error;
  }
  const customer = customers.find(entry => String(entry?.id ?? '') === String(order?.customerId ?? '')) || {};
  const items = Array.isArray(order.items) ? order.items.slice(0, 60) : [];
  const ui = state['aeon-ui'] && typeof state['aeon-ui'] === 'object' ? state['aeon-ui'] : {};
  const layout = state['aeon-layout'] && typeof state['aeon-layout'] === 'object' ? state['aeon-layout'] : {};
  const accent = /^#[0-9a-f]{6}$/i.test(layout.accentColor || '') ? layout.accentColor : '#d72d58';
  const dark = /^#[0-9a-f]{6}$/i.test(layout.accentDarkColor || '') ? layout.accentDarkColor : '#9f1739';
  const [logoImage, ...itemImages] = await Promise.all([
    orderImageBuffer(ui.logoImage),
    ...items.map(item => orderImageBuffer(item?.image))
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {top:0, right:0, bottom:0, left:0},
      bufferPages: true,
      info: {
        Title: `Đơn hàng ${cleanPdfText(order.code, 80)}`,
        Author: 'AEON BlackFriday 2026',
        Subject: 'Phiếu xác nhận đơn hàng'
      }
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 44;
    const contentWidth = pageWidth - margin * 2;
    const paper = '#fbf8f2';
    const line = '#ddd4c7';
    const ink = '#242224';
    const muted = '#706b68';

    const font = (bold = false, size = 10, color = ink) => {
      doc.font(bold ? pdfBoldFont : pdfRegularFont).fontSize(size).fillColor(color);
      return doc;
    };
    const drawPageHeader = continuation => {
      doc.rect(0, 0, pageWidth, 8).fill(accent);
      if (logoImage) {
        try {
          doc.image(logoImage, margin, 28, {fit:[112, 36], align:'left', valign:'center'});
        } catch {
          font(true, 24, accent).text('AEON', margin, 31);
        }
      } else {
        font(true, 24, accent).text(cleanPdfText(ui.logoText || 'AEON', 30), margin, 31);
      }
      font(false, 7.5, muted).text(cleanPdfText(ui.logoSubtitle || 'SIÊU SALE', 70).replace(/\n+/g, ' · '), margin, 71, {width:190});
      font(true, 15, ink).text(continuation ? 'CHI TIẾT ĐƠN HÀNG' : 'PHIẾU XÁC NHẬN ĐƠN HÀNG', 285, 31, {width:266, align:'right'});
      font(false, 8.5, muted).text(`Mã đơn: ${cleanPdfText(order.code, 80)}\nThời gian: ${cleanPdfText(order.createdAt || customer.createdAt || '', 100)}`, 285, 54, {width:266, align:'right', lineGap:3});
      doc.moveTo(margin, 91).lineTo(pageWidth - margin, 91).lineWidth(.7).strokeColor(line).stroke();
      return 112;
    };
    const field = (label, value, x, y, width, options = {}) => {
      font(true, 7.3, dark).text(label.toUpperCase(), x, y, {width, characterSpacing:.5});
      font(false, options.size || 10, ink).text(cleanPdfText(value || '—', options.limit || 500), x, y + 13, {
        width,
        height:options.height || 28,
        ellipsis:true,
        lineGap:2
      });
    };
    const drawItemsHeading = y => {
      doc.roundedRect(margin, y, contentWidth, 30, 5).fill(dark);
      font(true, 8.5, '#ffffff').text('SẢN PHẨM', margin + 14, y + 10, {width:330});
      font(true, 8.5, '#ffffff').text('THÀNH TIỀN', pageWidth - margin - 126, y + 10, {width:112, align:'right'});
      return y + 30;
    };
    const drawPlaceholder = (item, x, y, size) => {
      const color = /^#[0-9a-f]{6}$/i.test(item?.bg || '') ? item.bg : '#efe2d2';
      doc.roundedRect(x, y, size, size, 4).fill(color);
      font(true, 17, dark).text(cleanPdfText(item?.name || 'SP', 1).toUpperCase(), x, y + 17, {width:size, align:'center'});
    };

    let y = drawPageHeader(false);
    const hasMessage = Boolean(cleanPdfText(customer.message, 500));
    const customerHeight = hasMessage ? 174 : 143;
    doc.roundedRect(margin, y, contentWidth, customerHeight, 8).fill(paper).strokeColor(line).lineWidth(.7).stroke();
    font(true, 12.5, ink).text('Thông tin nhận hàng', margin + 17, y + 16);
    field('Họ và tên', customer.name, margin + 17, y + 43, 225);
    field('Số điện thoại', customer.phone, margin + 270, y + 43, 220);
    field('Email', customer.email, margin + 17, y + 81, 225);
    field('Địa chỉ giao hàng', customer.address, margin + 270, y + 81, 220, {height:42});
    if (hasMessage) field('Lời nhắn', customer.message, margin + 17, y + 119, 473, {height:38});
    y += customerHeight + 18;

    font(true, 15, ink).text(`Đơn hàng của bạn (${items.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity ?? item?.qty) || 1), 0)})`, margin, y);
    font(false, 8.5, muted).text('Đơn giá và thành tiền được thể hiện bằng Việt Nam đồng.', margin + 274, y + 5, {width:233, align:'right'});
    y = drawItemsHeading(y + 27);

    items.forEach((item, index) => {
      const rowHeight = 78;
      if (y + rowHeight > pageHeight - 118) {
        doc.addPage();
        y = drawPageHeader(true);
        y = drawItemsHeading(y);
      }
      const imageX = margin + 10;
      const imageY = y + 11;
      const imageSize = 56;
      const image = itemImages[index];
      if (image) {
        doc.roundedRect(imageX, imageY, imageSize, imageSize, 4).fill('#f1e7d8');
        try {
          doc.image(image, imageX, imageY, {fit:[imageSize, imageSize], align:'center', valign:'center'});
        } catch {
          drawPlaceholder(item, imageX, imageY, imageSize);
        }
      } else {
        drawPlaceholder(item, imageX, imageY, imageSize);
      }
      const quantity = Math.max(1, Math.round(Number(item?.quantity ?? item?.qty) || 1));
      const price = Math.max(0, Math.round(Number(item?.unitPrice ?? item?.price) || 0));
      const variant = cleanPdfText(item?.variantName || item?.variantLabel || item?.variant || '', 120);
      const sku = cleanPdfText(item?.variantSku || item?.sku || item?.id || '', 100);
      const textX = margin + 79;
      font(true, 10.5, ink).text(cleanPdfText(item?.name || 'Sản phẩm', 220), textX, y + 12, {width:292, height:28, ellipsis:true});
      font(false, 8.2, muted).text([variant, sku ? `Mã: ${sku}` : ''].filter(Boolean).join(' · ') || 'Sản phẩm AEON BlackFriday', textX, y + 40, {width:292, height:15, ellipsis:true});
      font(false, 9, muted).text(`${quantity} × ${formatPdfMoney(price)}`, textX, y + 57, {width:200});
      font(true, 10.5, ink).text(formatPdfMoney(quantity * price), pageWidth - margin - 126, y + 31, {width:112, align:'right'});
      doc.moveTo(margin, y + rowHeight).lineTo(pageWidth - margin, y + rowHeight).lineWidth(.6).strokeColor(line).stroke();
      y += rowHeight;
    });

    if (!items.length) {
      font(false, 10, muted).text('Đơn hàng chưa có sản phẩm.', margin + 14, y + 18);
      y += 55;
    }
    if (y + 137 > pageHeight - 60) {
      doc.addPage();
      y = drawPageHeader(true);
    }
    const summaryHeight = order.discount ? 113 : 91;
    doc.roundedRect(margin, y + 18, contentWidth, summaryHeight, 8).fill(paper).strokeColor(line).lineWidth(.7).stroke();
    const summaryX = pageWidth - margin - 232;
    font(false, 9.5, muted).text('Tạm tính', summaryX, y + 34, {width:105});
    font(true, 10, ink).text(formatPdfMoney(order.subtotal), summaryX + 108, y + 34, {width:110, align:'right'});
    let totalY = y + 58;
    if (order.discount) {
      font(false, 9.5, accent).text(cleanPdfText(order.promotion || 'Ưu đãi', 120), summaryX, y + 58, {width:150, height:18, ellipsis:true});
      font(true, 10, accent).text(`-${formatPdfMoney(order.discount)}`, summaryX + 108, y + 58, {width:110, align:'right'});
      totalY = y + 82;
    }
    doc.moveTo(summaryX, totalY - 8).lineTo(summaryX + 218, totalY - 8).strokeColor(line).stroke();
    font(true, 12.5, ink).text('Tổng thanh toán', summaryX, totalY, {width:120});
    font(true, 13, dark).text(formatPdfMoney(order.total), summaryX + 108, totalY, {width:110, align:'right'});
    font(true, 8, dark).text('XÁC NHẬN ĐƠN HÀNG', margin + 17, y + 36);
    font(false, 8.5, muted).text('Đơn hàng sẽ được nhân viên liên hệ để xác nhận thời gian giao nhận và hình thức thanh toán.', margin + 17, y + 55, {width:230, lineGap:3});
    font(true, 9, dark).text('Hotline: 0327 747 337', margin + 17, y + summaryHeight - 7);

    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = 0; pageIndex < pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageRange.start + pageIndex);
      doc.moveTo(margin, pageHeight - 41).lineTo(pageWidth - margin, pageHeight - 41).lineWidth(.5).strokeColor(line).stroke();
      font(false, 7.5, muted).text('AEON BlackFriday 2026 · Siêu Sale', margin, pageHeight - 30, {width:300});
      font(false, 7.5, muted).text(`Trang ${pageIndex + 1}/${pageRange.count}`, pageWidth - margin - 100, pageHeight - 30, {width:100, align:'right'});
    }
    doc.end();
  });
}

async function productCatalogPdfBuffer(state) {
  const allProducts = Array.isArray(state['aeon-products']) ? state['aeon-products'] : [];
  const ui = state['aeon-ui'] && typeof state['aeon-ui'] === 'object' ? state['aeon-ui'] : {};
  const layout = state['aeon-layout'] && typeof state['aeon-layout'] === 'object' ? state['aeon-layout'] : {};
  const accent = /^#[0-9a-f]{6}$/i.test(layout.accentColor || '') ? layout.accentColor : '#e3183c';
  const dark = /^#[0-9a-f]{6}$/i.test(layout.accentDarkColor || '') ? layout.accentDarkColor : '#a80f2a';
  const giftBackground = String(ui.giftRibbonBackgroundImage || '').trim();
  const showQr = true;
  const selectedProductIds = Array.isArray(ui.catalogProductIds) ? new Set(ui.catalogProductIds.map(String)) : null;
  const requestedProductLimit = Number(ui.catalogProductLimit);
  const productLimit = Number.isInteger(requestedProductLimit) && requestedProductLimit >= 1
    ? Math.min(9999, requestedProductLimit)
    : Math.max(1, allProducts.length);
  const products = allProducts
    .filter(product => !selectedProductIds || selectedProductIds.has(String(product?.id ?? '')))
    .slice(0, productLimit);
  const columns = [3, 4, 5].includes(Number(ui.catalogColumns)) ? Number(ui.catalogColumns) : 5;
  const gridProfile = {
    3:{firstRows:2, laterRows:3, firstCardHeight:210, laterCardHeight:245, firstImageHeight:106, laterImageHeight:140, firstTitleHeight:30, laterTitleHeight:34},
    4:{firstRows:3, laterRows:4, firstCardHeight:170, laterCardHeight:180, firstImageHeight:76, laterImageHeight:86, firstTitleHeight:23, laterTitleHeight:24},
    5:{firstRows:4, laterRows:5, firstCardHeight:143, laterCardHeight:155, firstImageHeight:60, laterImageHeight:68, firstTitleHeight:18, laterTitleHeight:20}
  }[columns];
  const defaultBannerSource = '/assets/catalog/black-friday-catalog-banner.jpg';
  const bannerSource = String(ui.catalogBannerImage || defaultBannerSource).trim();
  const bannerLogoSource = '/assets/catalog/aeon-binh-duong-newcity.png';
  const defaultOrderQrSource = '/assets/catalog/order-qr.png';
  const orderQrSource = String(ui.catalogOrderQrImage || defaultOrderQrSource).trim();
  const catalogHotline = cleanPdfText(ui.catalogHotline ?? '0327 747 337', 50);
  const catalogOrderPrompt = cleanPdfText(ui.catalogOrderPrompt || 'Quét mã đặt hàng & xem thêm sản phẩm', 120);
  const catalogMoreProductsUrl = (() => {
    const destination = safeCatalogLink(ui.catalogMoreProductsUrl) || 'https://blackfriday.tinhgon.xyz';
    try {
      const url = new URL(destination);
      if (url.hostname.toLowerCase() === 'aeonblackfriday.tinhgon.xyz') url.hostname = 'blackfriday.tinhgon.xyz';
      return url.href;
    } catch {
      return 'https://blackfriday.tinhgon.xyz';
    }
  })();
  const catalogMoreProductsHost = (() => {
    try {
      const host = new URL(catalogMoreProductsUrl).host;
      return host.toLowerCase() === 'blackfriday.tinhgon.xyz' ? 'Blackfriday.tinhgon.xyz' : host;
    } catch { return 'Blackfriday.tinhgon.xyz'; }
  })();
  const productImages = products.map(product => {
    const images = Array.isArray(product?.images) ? product.images : [];
    const main = String(images.find(Boolean) || product?.image || '').trim();
    const gifts = String(product?.promotionProductImage || product?.promoImage || '')
      .split(',').map(value => value.trim()).filter(Boolean).slice(0, 2);
    return {main, gifts};
  });
  const imageSources = [...new Set([
    ...productImages.flatMap(item => [item.main, ...item.gifts]),
    giftBackground,
    bannerSource,
    defaultBannerSource,
    bannerLogoSource,
    orderQrSource,
    defaultOrderQrSource,
    String(ui.logoImage || '').trim()
  ].filter(Boolean))];
  const imageBuffers = new Map();
  let imageIndex = 0;
  const imageWorkers = Array.from({length:Math.min(10, imageSources.length)}, async () => {
    while (imageIndex < imageSources.length) {
      const source = imageSources[imageIndex++];
      imageBuffers.set(source, await catalogImageBuffer(source));
    }
  });
  await Promise.all(imageWorkers);

  return new Promise((resolve, reject) => {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 18;
    const gap = 5;
    const cardWidth = (pageWidth - margin * 2 - gap * (columns - 1)) / columns;
    const renderedBannerSource = imageBuffers.get(bannerSource) ? bannerSource : defaultBannerSource;
    const renderedQrSource = imageBuffers.get(orderQrSource) ? orderQrSource : defaultOrderQrSource;
    const bannerBuffer = imageBuffers.get(renderedBannerSource);
    const bannerInfo = bannerBuffer && imageDimensions(bannerBuffer);
    const hasBanner = Boolean(bannerInfo);
    const firstPageRows = hasBanner ? gridProfile.firstRows : gridProfile.laterRows;
    const firstPageCapacity = columns * firstPageRows;
    const laterPageCapacity = columns * gridProfile.laterRows;
    const productPageCount = Math.max(1, products.length <= firstPageCapacity
      ? 1
      : 1 + Math.ceil((products.length - firstPageCapacity) / laterPageCapacity));
    const lineColor = '#dedbd5';
    const ink = '#242224';
    const muted = '#6d6966';
    const doc = new PDFDocument({
      size:'A4',
      layout:'portrait',
      margins:{top:0, right:0, bottom:0, left:0},
      bufferPages:true,
      info:{
        Title:'Catalog sản phẩm AEON Black Friday 2026',
        Author:'AEON BlackFriday 2026',
        Subject:`Danh mục ${products.length} sản phẩm`
      }
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const setFont = (bold, size, color = ink) => {
      doc.font(bold ? pdfBoldFont : pdfRegularFont).fontSize(size).fillColor(color);
    };
    const text = (value, x, y, width, options = {}) => {
      setFont(Boolean(options.bold), options.size || 8, options.color || ink);
      doc.text(cleanPdfText(value, options.limit || 400), x, y, {
        width,
        height:options.height,
        align:options.align || 'left',
        ellipsis:Boolean(options.ellipsis),
        lineGap:options.lineGap || 0
      });
    };
    const image = (source, x, y, width, height) => {
      const buffer = imageBuffers.get(source);
      if (!buffer || !imageDimensions(buffer)) return false;
      try {
        doc.image(buffer, x, y, {fit:[width, height], align:'center', valign:'center'});
        return true;
      } catch {
        return false;
      }
    };
    const drawHeader = pageNumber => {
      doc.rect(0, 0, pageWidth, pageHeight).fill('#050505');
      if (pageNumber === 1 && hasBanner) {
        const bannerWidth = pageWidth - margin * 2;
        const bannerHeight = bannerWidth * bannerInfo.height / bannerInfo.width;
        const bannerY = 12;
        image(renderedBannerSource, margin, bannerY, bannerWidth, bannerHeight);
        image(bannerLogoSource, margin + bannerWidth * 0.009, bannerY + bannerHeight * 0.02, bannerWidth * 0.085, bannerHeight * 0.12);
        if (showQr && renderedQrSource) {
          const qrPanelWidth = Math.min(290, bannerWidth - 18);
          const qrPanelHeight = 52;
          const qrPanelX = margin + bannerWidth - qrPanelWidth - 8;
          const qrPanelY = bannerY + bannerHeight - qrPanelHeight - 7;
          const qrSize = 42;
          const qrX = qrPanelX + qrPanelWidth - qrSize - 3;
          const qrY = qrPanelY + (qrPanelHeight - qrSize) / 2;
          const promptWidth = qrPanelWidth - qrSize - 18;
          let promptSize = 9.5;
          doc.font(pdfBoldFont).fontSize(promptSize);
          while (doc.widthOfString(catalogOrderPrompt) > promptWidth && promptSize > 7) {
            promptSize -= .25;
            doc.fontSize(promptSize);
          }
          const promptNeedsWrap = doc.widthOfString(catalogOrderPrompt) > promptWidth;
          const promptHeight = promptNeedsWrap ? 24 : 12;
          const promptY = qrY + qrSize - promptHeight;
          doc.font(pdfBoldFont).fontSize(promptSize).fillColor('#f5c644')
            .text(catalogOrderPrompt, qrPanelX + 8, promptY, {
              width:promptWidth, height:promptHeight, align:'right', lineGap:0, fill:true
            });
          doc.roundedRect(qrX - 1, qrY - 1, qrSize + 2, qrSize + 2, 2).fill('#ffffff');
          image(renderedQrSource, qrX, qrY, qrSize, qrSize);
          doc.link(qrX, qrY, qrSize, qrSize, catalogMoreProductsUrl);
        }
        return 12 + bannerHeight + 7;
      }
      doc.rect(0, 0, pageWidth, 3).fill('#bd1232');
      return 16;
    };
    const drawGiftRibbon = (product, itemImages, x, ribbonBottom, width, minimumHeight, productImageHeight) => {
      const rawName = cleanPdfText(product?.promotionProductName || product?.promoName || '', 160);
      const name = rawName.replace(/^tặng\s*/i, '').trim();
      const rawValue = cleanPdfText(product?.promotionProductValue || product?.promoValue || '', 120);
      const value = rawValue.replace(/^trị\s*giá\s*/i, '').trim();
      const giftSources = itemImages.gifts.filter(source => imageBuffers.get(source)).slice(0, 2);
      if (!name && !value && !giftSources.length) return;

      const giftTitle = name ? `TẶNG ${name}` : '';
      const giftValue = value ? `TRỊ GIÁ ${value}` : '';
      const photoArea = giftSources.length === 2 ? 30 : giftSources.length ? 23 : 4;
      const copyWidth = Math.max(20, width - photoArea - 9);
      let titleSize = giftTitle.length > 90 ? 2.6 : giftTitle.length > 58 ? 2.9 : 3.4;
      let valueSize = 3.2;
      const measureText = (content, size) => {
        if (!content) return 0;
        doc.font(pdfBoldFont).fontSize(size);
        return doc.heightOfString(content, {width:copyWidth, lineGap:0});
      };
      const maximumHeight = Math.min(productImageHeight - 8, 18);
      let titleHeight = measureText(giftTitle, titleSize);
      let valueHeight = measureText(giftValue, valueSize);
      let textHeight = titleHeight + (giftTitle && giftValue ? 1 : 0) + valueHeight;
      while (textHeight + 5 > maximumHeight && (titleSize > 2.4 || valueSize > 2.4)) {
        titleSize = Math.max(2.4, titleSize - .15);
        valueSize = Math.max(2.4, valueSize - .15);
        titleHeight = measureText(giftTitle, titleSize);
        valueHeight = measureText(giftValue, valueSize);
        textHeight = titleHeight + (giftTitle && giftValue ? 1 : 0) + valueHeight;
      }
      const height = Math.max(minimumHeight, Math.min(maximumHeight, Math.ceil(textHeight + 5)));
      const y = ribbonBottom - height;
      doc.roundedRect(x, y, width, height, 4).fill('#bd1232');
      const ribbonImage = imageBuffers.get(giftBackground);
      if (ribbonImage && imageDimensions(ribbonImage)) {
        try { doc.image(ribbonImage, x, y, {width, height}); } catch { /* Keep the red fallback ribbon. */ }
      }
      let copyY = y + 2;
      if (giftTitle) {
        setFont(true, titleSize, '#ffffff');
        doc.text(giftTitle, x + 4, copyY, {width:copyWidth, height:titleHeight + 1, lineGap:0});
        copyY += titleHeight + (giftValue ? 1 : 0);
      }
      if (giftValue) {
        setFont(true, valueSize, '#ffe66d');
        doc.text(giftValue, x + 4, copyY, {width:copyWidth, height:valueHeight + 1, lineGap:0});
      }
      if (giftSources.length === 1) {
        const giftX = x + width - 21;
        doc.roundedRect(giftX - 1, y + 1, 18, height - 2, 2).fill('#ffffff');
        image(giftSources[0], giftX, y + 2, 16, height - 4);
      } else if (giftSources.length === 2) {
        const firstGiftX = x + width - 32;
        const secondGiftX = x + width - 17;
        doc.roundedRect(firstGiftX - 1, y + 1, 15, height - 2, 2).fill('#ffffff');
        doc.roundedRect(secondGiftX - 1, y + 1, 14, height - 2, 2).fill('#ffffff');
        image(giftSources[0], firstGiftX, y + 2, 13, height - 4);
        image(giftSources[1], secondGiftX, y + 2, 12, height - 4);
      }
    };
    const drawProduct = (product, itemImages, x, y, cardHeight, imageHeight, titleBlockHeight) => {
      const cardBottom = y + cardHeight;
      doc.roundedRect(x, y, cardWidth, cardHeight, 5).fill('#171719').strokeColor('#303033').lineWidth(.6).stroke();
      const mediaX = x + 5;
      const mediaY = y + 5;
      const mediaWidth = cardWidth - 10;
      doc.roundedRect(mediaX, mediaY, mediaWidth, imageHeight, 3).fill('#ffffff');
      if (!image(itemImages.main, mediaX + 3, mediaY + 3, mediaWidth - 6, imageHeight - 6)) {
        text('Hình ảnh đang cập nhật', mediaX + 6, mediaY + imageHeight / 2 - 3, mediaWidth - 12, {size:5.2, color:'#777777', align:'center', limit:80});
      }

      const salePrice = productCatalogPrice(product);
      const regularPrice = Math.max(0, Number(product?.originalPrice || product?.regularPrice) || 0);
      const discount = salePrice > 0 && regularPrice > salePrice ? Math.round((1 - salePrice / regularPrice) * 100) : 0;
      if (discount) {
        const badgeWidth = 29;
        doc.roundedRect(mediaX + mediaWidth - badgeWidth - 4, mediaY + 4, badgeWidth, 14, 2).fill('#e61943');
        text(`-${discount}%`, mediaX + mediaWidth - badgeWidth - 4, mediaY + 7, badgeWidth, {bold:true, size:5.7, color:'#ffffff', align:'center', limit:10});
      }
      if (product?.label) {
        doc.roundedRect(mediaX + 4, mediaY + 4, 48, 12, 2).fill('#222228');
        text(product.label, mediaX + 7, mediaY + 7, 42, {bold:true, size:4.7, color:'#ffffff', ellipsis:true, limit:40});
      }

      const hasGift = Boolean(cleanPdfText(product?.promotionProductName || product?.promoName || '', 160)
        || cleanPdfText(product?.promotionProductValue || product?.promoValue || '', 120)
        || itemImages.gifts.some(source => imageBuffers.get(source)));
      if (hasGift) drawGiftRibbon(product, itemImages, mediaX + 3, mediaY + imageHeight + 2, mediaWidth - 6, 12, imageHeight);

      const bodyY = y + imageHeight + 8;
      const brand = cleanPdfText(product?.brand || '', 60);
      if (brand) text(brand.toLocaleUpperCase('vi-VN'), x + 6, bodyY, cardWidth - 12, {bold:true, size:6.1, color:'#e61943', ellipsis:true, limit:70});
      const titleY = bodyY + (brand ? 8 : 0);
      const productTitle = cleanPdfText(product?.name || 'Sản phẩm chưa có tên', 240);
      const titleWidth = cardWidth - 12;
      let titleSize = 7.2;
      doc.font(pdfBoldFont).fontSize(titleSize);
      let titleHeight = doc.heightOfString(productTitle, {width:titleWidth, lineGap:0});
      while (titleHeight > titleBlockHeight - 1 && titleSize > 2.6) {
        titleSize = Math.max(2.6, titleSize - .2);
        doc.fontSize(titleSize);
        titleHeight = doc.heightOfString(productTitle, {width:titleWidth, lineGap:0});
      }
      text(productTitle, x + 6, titleY, titleWidth, {
        bold:true, size:titleSize, color:'#ffffff', height:titleBlockHeight, lineGap:0, limit:240
      });
      const dividerY = titleY + titleBlockHeight + 2;
      doc.moveTo(x + 6, dividerY).lineTo(x + cardWidth - 6, dividerY).lineWidth(.45).strokeColor('#39393b').stroke();
      const priceY = dividerY + 4;
      const priceWidth = cardWidth - 12;
      const saleText = salePrice ? formatPdfMoney(salePrice) : 'Liên hệ';
      doc.font(pdfBoldFont).fontSize(1);
      const saleTextWidthAtOnePoint = Math.max(.1, doc.widthOfString(saleText));
      const saleTargetWidth = Math.min(priceWidth, cardWidth - 16) * .92;
      const saleSize = Math.min(16, saleTargetWidth / saleTextWidthAtOnePoint);
      const saleTextHeight = saleSize + 3;
      text(saleText, x + 6, priceY, priceWidth, {bold:true, size:saleSize, color:'#f5c644', height:saleTextHeight, align:'center', limit:60});
      if (regularPrice > salePrice && salePrice > 0) {
        const regularText = formatPdfMoney(regularPrice);
        let regularSize = 7.4;
        doc.font(pdfRegularFont).fontSize(regularSize);
        while (doc.widthOfString(regularText) > priceWidth && regularSize > 6) {
          regularSize -= .2;
          doc.fontSize(regularSize);
        }
        const regularY = priceY + Math.max(regularSize + 5, saleSize + 1);
        doc.font(pdfRegularFont).fontSize(regularSize);
        const regularWidth = Math.min(priceWidth, doc.widthOfString(regularText));
        const regularX = x + (cardWidth - regularWidth) / 2;
        const regularTextHeight = doc.heightOfString(regularText, {width:regularWidth, lineGap:0});
        doc.fillColor('#bab7b4').text(regularText, regularX, regularY, {
          width:regularWidth, height:regularTextHeight, align:'center', lineGap:0
        });
        const strikeY = regularY + regularTextHeight / 2 + regularSize * .18;
        doc.moveTo(regularX, strikeY).lineTo(regularX + regularWidth, strikeY).lineWidth(.5).strokeColor('#bab7b4').stroke();
      }

      const booked = Math.max(0, Math.min(9999, Math.floor(Number(product?.dealSlotsRemaining) || 0)));
      const total = Math.max(1, Math.min(9999, Math.floor(Number(product?.dealSlotsTotal) || 20)));
      const quotaRatio = booked / total;
      const quotaLevel = booked >= total ? 'soldout' : quotaRatio >= .75 ? 'low' : quotaRatio >= .35 ? 'medium' : 'high';
      const quotaPalette = {
        high:{stops:[[0,'#fff3b6'],[.48,'#ffe071'],[1,'#ffb51b']], border:'#ffbe25', outer:'#f47a12', inner:'#ffcf35', text:'#263141'},
        medium:{stops:[[0,'#ffe4a3'],[1,'#ffb13b']], border:'#ff9b24', outer:'#f47a12', inner:'#ffcf35', text:'#342515'},
        low:{stops:[[0,'#f46b46'],[1,'#d9303c']], border:'#e43c36', outer:'#fff0cb', inner:'#ffc14d', text:'#ffffff'},
        soldout:{stops:[[0,'#a6a6a6'],[1,'#686868']], border:'#777777', outer:'#e7e7e7', inner:'#bdbdbd', text:'#ffffff'}
      }[quotaLevel];
      const quotaY = cardBottom - 14;
      const quotaX = x + 5;
      const quotaWidth = cardWidth - 10;
      const quotaHeight = 10;
      const quotaGradient = doc.linearGradient(quotaX, quotaY, quotaX + quotaWidth, quotaY);
      for (const [stop, color] of quotaPalette.stops) quotaGradient.stop(stop, color);
      doc.roundedRect(quotaX, quotaY, quotaWidth, quotaHeight, quotaHeight / 2).fill(quotaGradient);
      doc.roundedRect(quotaX, quotaY, quotaWidth, quotaHeight, quotaHeight / 2).lineWidth(.35).strokeColor(quotaPalette.border).stroke();
      const quotaLabel = `${booked}/${total} Suất đã đặt trước`;
      let quotaLabelSize = 4.5;
      doc.font(pdfBoldFont).fontSize(quotaLabelSize);
      const quotaFlameSize = 7.2;
      const quotaFlameGap = 3.2;
      const maxQuotaLabelWidth = quotaWidth - quotaFlameSize - quotaFlameGap - 10;
      while (doc.widthOfString(quotaLabel) > maxQuotaLabelWidth && quotaLabelSize > 3.2) {
        quotaLabelSize -= .2;
        doc.fontSize(quotaLabelSize);
      }
      const quotaTextWidth = Math.min(maxQuotaLabelWidth, doc.widthOfString(quotaLabel));
      const quotaGroupWidth = quotaFlameSize + quotaFlameGap + quotaTextWidth;
      const quotaGroupX = quotaX + (quotaWidth - quotaGroupWidth) / 2;
      const quotaFlameX = quotaGroupX;
      const quotaFlameY = quotaY + (quotaHeight - quotaFlameSize) / 2;
      doc.save();
      doc.translate(quotaFlameX, quotaFlameY);
      doc.scale(quotaFlameSize / 24, quotaFlameSize / 24);
      doc.path('M13.3 1.5c.5 3.1-.8 4.7-2.3 6.1-.8-1.1-.9-2.3-.6-3.3C6.6 7.2 4.4 10.1 4.4 14a7.6 7.6 0 0 0 15.2 0c0-4.4-2.3-8.3-6.3-12.5Z').fill(quotaPalette.outer);
      doc.path('M12 10.2c.1 1.7-1.9 2.8-1.9 4.8a2.1 2.1 0 1 0 4.2 0c0-1.8-1.1-3.2-2.3-4.8Z').fill(quotaPalette.inner);
      doc.restore();
      const quotaTextX = quotaGroupX + quotaFlameSize + quotaFlameGap;
      const quotaTextHeight = doc.heightOfString(quotaLabel, {width:quotaTextWidth, lineGap:0});
      const quotaTextY = quotaY + (quotaHeight - quotaTextHeight) / 2 - .45;
      text(quotaLabel, quotaTextX, quotaTextY, quotaTextWidth, {
        bold:true, size:quotaLabelSize, color:quotaPalette.text, limit:50
      });
    };

    for (let pageIndex = 0; pageIndex < productPageCount; pageIndex += 1) {
      if (pageIndex > 0) doc.addPage();
      const gridStartY = drawHeader(pageIndex + 1);
      const compactBannerPage = pageIndex === 0 && hasBanner;
      const cardHeight = compactBannerPage ? gridProfile.firstCardHeight : gridProfile.laterCardHeight;
      const imageHeight = compactBannerPage ? gridProfile.firstImageHeight : gridProfile.laterImageHeight;
      const titleBlockHeight = compactBannerPage ? gridProfile.firstTitleHeight : gridProfile.laterTitleHeight;
      const productOffset = pageIndex === 0 ? 0 : firstPageCapacity + (pageIndex - 1) * laterPageCapacity;
      const pageCapacity = pageIndex === 0 ? firstPageCapacity : laterPageCapacity;
      const pageProducts = products.slice(productOffset, productOffset + pageCapacity);
      pageProducts.forEach((product, itemIndex) => {
        const column = itemIndex % columns;
        const row = Math.floor(itemIndex / columns);
        const x = margin + column * (cardWidth + gap);
        const y = gridStartY + row * (cardHeight + gap);
        drawProduct(product, productImages[productOffset + itemIndex], x, y, cardHeight, imageHeight, titleBlockHeight);
      });
      if (!products.length) {
        text('Danh mục sản phẩm đang được cập nhật.', margin, gridStartY + 35, pageWidth - margin * 2, {size:12, color:muted, align:'center', limit:100});
      }
    }

    const lastPageIndex = productPageCount - 1;
    const lastOffset = lastPageIndex === 0 ? 0 : firstPageCapacity + (lastPageIndex - 1) * laterPageCapacity;
    const lastPageProducts = products.slice(lastOffset, lastOffset + (lastPageIndex === 0 ? firstPageCapacity : laterPageCapacity));
    const lastGridStartY = lastPageIndex === 0
      ? Math.max(hasBanner ? 12 + (pageWidth - margin * 2) * bannerInfo.height / bannerInfo.width + 7 : 16, 16)
      : 16;
    const lastCardHeight = lastPageIndex === 0 && hasBanner ? gridProfile.firstCardHeight : gridProfile.laterCardHeight;
    const lastRows = Math.ceil(lastPageProducts.length / columns);
    const lastProductsBottom = lastRows
      ? lastGridStartY + (lastRows - 1) * (lastCardHeight + gap) + lastCardHeight
      : lastGridStartY;
    const contactPanelHeight = 82;
    const closingSectionTopLimit = lastProductsBottom + 14;
    const closingSectionBottomLimit = pageHeight - 38;
    const availableClosingHeight = Math.max(0, closingSectionBottomLimit - closingSectionTopLimit);
    const canFitClosingSection = availableClosingHeight >= contactPanelHeight;
    const closingSectionHeight = contactPanelHeight;
    let contactPageIndex = lastPageIndex;
    let closingSectionY;
    if (canFitClosingSection) {
      closingSectionY = closingSectionTopLimit + (availableClosingHeight - closingSectionHeight) / 2;
      doc.switchToPage(contactPageIndex);
    } else {
      doc.addPage();
      contactPageIndex = productPageCount;
      doc.rect(0, 0, pageWidth, pageHeight).fill('#09090b');
      doc.rect(0, 0, pageWidth, 5).fill('#bd1232');
      closingSectionY = (pageHeight - closingSectionHeight) / 2;
    }

    const contactPanelY = closingSectionY;
    const contactPanelWidth = pageWidth - margin * 2;
    const contactPanelX = (pageWidth - contactPanelWidth) / 2;
    const contactQrSize = showQr && renderedQrSource ? 64 : 0;
    const contactQrX = contactPanelX + contactPanelWidth - 14 - contactQrSize;
    const contactTextX = contactPanelX + 14;
    const contactTextWidth = contactQrSize ? contactQrX - contactTextX - 18 : contactPanelWidth - 28;
    doc.roundedRect(contactPanelX, contactPanelY, contactPanelWidth, contactPanelHeight, 8).fill('#171719').strokeColor('#4a4140').lineWidth(.8).stroke();
    if (contactQrSize) {
      const contactQrY = contactPanelY + (contactPanelHeight - contactQrSize) / 2;
      doc.roundedRect(contactQrX - 3, contactQrY - 3, contactQrSize + 6, contactQrSize + 6, 4).fill('#ffffff');
      image(renderedQrSource, contactQrX, contactQrY, contactQrSize, contactQrSize);
      doc.link(contactQrX, contactQrY, contactQrSize, contactQrSize, catalogMoreProductsUrl);
    }
    const hotlineContactLine = `HOTLINE TƯ VẤN & ĐẶT HÀNG: ${catalogHotline || 'liên hệ tư vấn'}`;
    let hotlineContactSize = 13;
    doc.font(pdfBoldFont).fontSize(hotlineContactSize);
    while (doc.widthOfString(hotlineContactLine) > contactTextWidth && hotlineContactSize > 8) {
      hotlineContactSize -= .5;
      doc.fontSize(hotlineContactSize);
    }
    text(hotlineContactLine, contactTextX, contactPanelY + 19, contactTextWidth, {bold:true, size:hotlineContactSize, color:'#f5c644', align:'center', limit:100});

    const orderContactLine = showQr ? `${catalogOrderPrompt} · ${catalogMoreProductsHost}` : catalogMoreProductsHost;
    let orderContactSize = 10;
    doc.font(pdfBoldFont).fontSize(orderContactSize);
    while (doc.widthOfString(orderContactLine) > contactTextWidth && orderContactSize > 7) {
      orderContactSize -= .25;
      doc.fontSize(orderContactSize);
    }
    doc.font(pdfBoldFont).fontSize(orderContactSize).fillColor('#ffffff')
      .text(orderContactLine, contactTextX, contactPanelY + 45, {width:contactTextWidth, align:'center', link:catalogMoreProductsUrl});
    doc.link(contactTextX, contactPanelY + 43, contactTextWidth, 16, catalogMoreProductsUrl);

    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = 0; pageIndex < pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageRange.start + pageIndex);
      doc.moveTo(margin, pageHeight - 22).lineTo(pageWidth - margin, pageHeight - 22).lineWidth(.5).strokeColor(lineColor).stroke();
      text(`Hotline ${catalogHotline || 'liên hệ tư vấn'} · ${showQr ? 'Quét mã QR đặt hàng · ' : ''}Xem thêm: ${catalogMoreProductsHost}`, margin, pageHeight - 16, 450, {size:6, color:muted, limit:140});
      text(`${pageIndex + 1}/${pageRange.count}`, pageWidth - margin - 44, pageHeight - 16, 44, {size:6, color:muted, align:'right', limit:20});
    }
    doc.end();
  });
}

const productWorkbookHeaders = [
  'ID hệ thống',
  'Tên sản phẩm',
  'Nhóm hàng',
  'Giá khuyến mãi',
  'Giá thường',
  'Tên sản phẩm khuyến mãi',
  'Giá trị sản phẩm khuyến mãi',
  'Ảnh sản phẩm khuyến mãi (URL)',
  'Thương hiệu',
  'Mã sản phẩm',
  'Nhãn hiển thị',
  'Quy cách / khối lượng',
  'Tính năng nổi bật',
  'Mô tả',
  'Ảnh 1 (URL)',
  'Ảnh 2 (URL)',
  'Ảnh 3 (URL)',
  'Ảnh 4 (URL)',
  'Ảnh 5 (URL)',
  'Tên phân loại',
  'Giá trị phân loại',
  'Mã phân loại',
  'Giá phân loại',
  'Ảnh phân loại (URL)',
  'Số suất đã đặt trước',
  'Tổng số suất'
];

const productWorkbookWidths = [20, 38, 24, 16, 16, 34, 30, 46, 26, 20, 18, 24, 38, 46, 46, 46, 46, 46, 46, 20, 24, 20, 18, 46, 23, 16];

function productWorkbookRow(product, variant = null) {
  return {
    'ID hệ thống': spreadsheetText(product?.id),
    'Tên sản phẩm': spreadsheetText(product?.name),
    'Nhóm hàng': spreadsheetText(product?.productGroup),
    'Giá khuyến mãi': spreadsheetNumber(product?.price),
    'Giá thường': spreadsheetNumber(product?.originalPrice),
    'Tên sản phẩm khuyến mãi': spreadsheetText(product?.promotionProductName),
    'Giá trị sản phẩm khuyến mãi': spreadsheetText(product?.promotionProductValue),
    'Ảnh sản phẩm khuyến mãi (URL)': spreadsheetText(product?.promotionProductImage),
    'Thương hiệu': spreadsheetText(product?.brand),
    'Mã sản phẩm': spreadsheetText(product?.sku),
    'Nhãn hiển thị': spreadsheetText(product?.label),
    'Quy cách / khối lượng': spreadsheetText(product?.weight),
    'Tính năng nổi bật': spreadsheetText(product?.ingredients),
    'Mô tả': spreadsheetText(product?.description),
    'Ảnh 1 (URL)': spreadsheetText(product?.image),
    'Ảnh 2 (URL)': spreadsheetText(product?.images?.[1]),
    'Ảnh 3 (URL)': spreadsheetText(product?.images?.[2]),
    'Ảnh 4 (URL)': spreadsheetText(product?.images?.[3]),
    'Ảnh 5 (URL)': spreadsheetText(product?.images?.[4]),
    'Tên phân loại': spreadsheetText(product?.variantLabel || (variant ? 'Phân loại' : '')),
    'Giá trị phân loại': spreadsheetText(variant?.name),
    'Mã phân loại': spreadsheetText(variant?.sku),
    'Giá phân loại': variant ? spreadsheetNumber(variant.price) : '',
    'Ảnh phân loại (URL)': spreadsheetText(variant?.image),
    'Số suất đã đặt trước': Number.isFinite(Number(product?.dealSlotsRemaining)) ? Math.max(0, Math.min(9999, Math.floor(Number(product.dealSlotsRemaining)))) : 0,
    'Tổng số suất': Number.isFinite(Number(product?.dealSlotsTotal)) ? Math.max(1, Math.min(9999, Math.floor(Number(product.dealSlotsTotal)))) : 20
  };
}

function productWorkbookRows(products) {
  return products.flatMap(product => {
    const variants = Array.isArray(product?.variants)
      ? product.variants.filter(variant => String(variant?.name || '').trim())
      : [];
    return variants.length
      ? variants.map(variant => productWorkbookRow(product, variant))
      : [productWorkbookRow(product)];
  });
}

function productWorkbookGuide() {
  const guideHeaders = ['Cột', 'Yêu cầu', 'Ví dụ'];
  const guideRows = [
    {'Cột': 'ID hệ thống', 'Yêu cầu': 'Giữ nguyên khi cập nhật danh sách đã tải xuống; để trống khi tạo sản phẩm mới', 'Ví dụ': 'sp-2026-01'},
    {'Cột': 'Tên sản phẩm', 'Yêu cầu': 'Bắt buộc; lặp lại trên các dòng phân loại của cùng sản phẩm', 'Ví dụ': 'Sản phẩm ưu đãi BlackFriday'},
    {'Cột': 'Nhóm hàng', 'Yêu cầu': 'Không bắt buộc; dùng để phân nhóm sản phẩm', 'Ví dụ': 'Điện gia dụng'},
    {'Cột': 'Giá khuyến mãi', 'Yêu cầu': 'Giá chung khi không có phân loại; nếu có phân loại, hệ thống lấy giá thấp nhất', 'Ví dụ': '350000'},
    {'Cột': 'Giá thường', 'Yêu cầu': 'Không bắt buộc; lớn hơn Giá khuyến mãi để hiển thị giá gạch ngang và % giảm', 'Ví dụ': '450000'},
    {'Cột': 'Tên sản phẩm khuyến mãi', 'Yêu cầu': 'Không bắt buộc; tên hàng tặng kèm trên dải khuyến mãi Black Friday', 'Ví dụ': 'Nồi lẩu điện'},
    {'Cột': 'Giá trị sản phẩm khuyến mãi', 'Yêu cầu': 'Không bắt buộc; giá trị quà tặng hiển thị sau chữ TRỊ GIÁ', 'Ví dụ': '990.000 ₫'},
    {'Cột': 'Ảnh sản phẩm khuyến mãi (URL)', 'Yêu cầu': 'Không bắt buộc; lớp phủ hiện khi có tên quà và link ảnh; giá trị quà không bắt buộc', 'Ví dụ': 'https://example.com/noi-lau.jpg'},
    {'Cột': 'Số suất đã đặt trước', 'Yêu cầu': 'Số suất đã có người đặt trước; 0 nghĩa là chưa có người đặt, màu dải thay đổi khi số lượt đặt tăng', 'Ví dụ': '0'},
    {'Cột': 'Tổng số suất', 'Yêu cầu': 'Tổng số suất ưu đãi của sản phẩm', 'Ví dụ': '20'},
    {'Cột': 'Thương hiệu', 'Yêu cầu': 'Nhập tên thương hiệu; bộ lọc sẽ tự động được tạo', 'Ví dụ': 'Kinh Đô'},
    {'Cột': 'Mã sản phẩm', 'Yêu cầu': 'Nên có và phải giống nhau trên các dòng phân loại của cùng sản phẩm', 'Ví dụ': 'AM-2026-01'},
    {'Cột': 'Nhãn hiển thị', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': 'Bán chạy'},
    {'Cột': 'Quy cách / khối lượng', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': '4 bánh · 720g'},
    {'Cột': 'Tính năng nổi bật', 'Yêu cầu': 'Không bắt buộc; có thể xuống dòng', 'Ví dụ': 'Công suất 1500W\nDễ vệ sinh'},
    {'Cột': 'Mô tả', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': 'Hộp quà phù hợp để biếu tặng.'},
    {'Cột': 'Ảnh 1 (URL)', 'Yêu cầu': 'Không bắt buộc; dùng link ảnh hoặc đường dẫn /assets/uploads/...', 'Ví dụ': 'https://example.com/blackfriday-product.jpg'},
    {'Cột': 'Tên phân loại', 'Yêu cầu': 'Tên nhóm lựa chọn; lặp lại trên các dòng của cùng sản phẩm', 'Ví dụ': 'Màu sắc'},
    {'Cột': 'Giá trị phân loại', 'Yêu cầu': 'Mỗi lựa chọn nằm trên một dòng riêng', 'Ví dụ': 'Đỏ'},
    {'Cột': 'Mã phân loại', 'Yêu cầu': 'Không bắt buộc nhưng không được trùng trong cùng sản phẩm', 'Ví dụ': 'AM-2026-01-RED'},
    {'Cột': 'Giá phân loại', 'Yêu cầu': 'Bắt buộc khi có Giá trị phân loại', 'Ví dụ': '350000'},
    {'Cột': 'Ảnh phân loại (URL)', 'Yêu cầu': 'Không bắt buộc; để trống sẽ dùng Ảnh (URL) của sản phẩm', 'Ví dụ': 'https://example.com/blackfriday-product-red.jpg'}
  ];
  return worksheetFromRows(guideHeaders, guideRows, [28, 72, 52]);
}

function productImportTemplateWorkbook() {
  const worksheet = worksheetFromRows(productWorkbookHeaders, [{}], productWorkbookWidths);
  worksheet['!freeze'] = {xSplit: 0, ySplit: 1};

  const exampleProduct = {
    id: '',
    name: 'Sản phẩm ưu đãi BlackFriday',
    productGroup: 'Bánh trung thu',
    price: 350000,
    originalPrice: 450000,
    promotionProductName: 'Nồi lẩu điện',
    promotionProductValue: '990.000 ₫',
    promotionProductImage: 'https://example.com/noi-lau.jpg',
    dealSlotsRemaining: 0,
    dealSlotsTotal: 20,
    brand: 'Kinh Đô',
    sku: 'AM-2026-01',
    label: 'Bán chạy',
    weight: '4 bánh · 720g',
    ingredients: 'Hạt sen · trứng muối',
    description: 'Hộp quà có nhiều màu để khách lựa chọn.',
    details: 'Chọn màu phù hợp trước khi thêm vào giỏ hàng.',
    image: 'https://example.com/blackfriday-product.jpg',
    variantLabel: 'Màu sắc',
    variants: [
      {name:'Đỏ', sku:'AM-2026-01-RED', price:350000},
      {name:'Xanh', sku:'AM-2026-01-BLUE', price:360000},
      {name:'Vàng', sku:'AM-2026-01-YELLOW', price:350000}
    ]
  };
  const example = worksheetFromRows(productWorkbookHeaders, productWorkbookRows([exampleProduct]), productWorkbookWidths);
  example['!freeze'] = {xSplit: 0, ySplit: 1};

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Danh mục');
  XLSX.utils.book_append_sheet(workbook, example, 'Ví dụ');
  XLSX.utils.book_append_sheet(workbook, productWorkbookGuide(), 'Hướng dẫn');
  return XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx', compression: true});
}

function productCatalogPrice(product) {
  const variantPrices = Array.isArray(product?.variants)
    ? product.variants.map(variant => Number(variant?.price) || 0).filter(price => price > 0)
    : [];
  return variantPrices.length ? Math.min(...variantPrices) : Math.max(0, Number(product?.price) || 0);
}

function productCatalogVariants(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants
    .filter(variant => String(variant?.name || '').trim())
    .map(variant => {
      const price = Math.max(0, Number(variant?.price) || 0);
      return price ? `${String(variant.name).trim()} (${new Intl.NumberFormat('vi-VN').format(price)} đ)` : String(variant.name).trim();
    })
    .join('\n');
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {extension:'png', width:buffer.readUInt32BE(16), height:buffer.readUInt32BE(20)};
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {extension:'jpeg', width:buffer.readUInt16BE(offset + 5), height:buffer.readUInt16BE(offset + 3)};
    }
    offset += length;
  }
  return null;
}

function compactCatalogImageUrl(source) {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.hostname.toLowerCase() === 'res.cloudinary.com' && url.pathname.includes('/image/upload/')) {
      url.pathname = url.pathname.replace('/image/upload/', '/image/upload/f_jpg,q_auto,w_420,h_420,c_fit/');
    }
    return url.href;
  } catch {
    return '';
  }
}

async function responseBufferWithLimit(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function catalogImageBuffer(value) {
  const source = String(value || '').trim();
  if (!source) return null;

  if (source.startsWith('/')) {
    const imagePath = localAssetPath(source);
    const assetsRoot = path.join(root, 'assets');
    if (!imagePath || (!imagePath.startsWith(`${assetsRoot}${path.sep}`)
      && !imagePath.startsWith(`${uploadDir}${path.sep}`))) return null;
    try {
      const buffer = await fs.promises.readFile(imagePath);
      return buffer.length <= 2 * 1024 * 1024 && imageDimensions(buffer) ? buffer : null;
    } catch {
      return null;
    }
  }

  const imageUrl = compactCatalogImageUrl(directGoogleDriveImage(source));
  if (!imageUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(imageUrl, {signal: controller.signal, redirect: 'follow'});
    clearTimeout(timer);
    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('image/png') && !contentType.includes('image/jpeg')) return null;
    const buffer = await responseBufferWithLimit(response, 2 * 1024 * 1024);
    return buffer && imageDimensions(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

async function productCatalogWorkbook(state) {
  const products = Array.isArray(state['aeon-products']) ? state['aeon-products'] : [];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AEON BlackFriday 2026';
  workbook.created = new Date();

  const catalogue = workbook.addWorksheet('Danh mục sản phẩm', {
    views: [{state:'frozen', ySplit:4}],
    pageSetup: {orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0}
  });
  catalogue.columns = [
    {key:'image', width:18},
    {key:'name', width:44},
    {key:'productGroup', width:24},
    {key:'price', width:20},
    {key:'brand', width:24},
    {key:'sku', width:22},
    {key:'variants', width:36},
    {key:'dealSlotsRemaining', width:23},
    {key:'dealSlotsTotal', width:16}
  ];
  catalogue.mergeCells('A1:I1');
  catalogue.getCell('A1').value = 'DANH MỤC SẢN PHẨM';
  catalogue.getCell('A1').font = {name:'Be Vietnam Pro', size:18, bold:true, color:{argb:'FFFFFFFF'}};
  catalogue.getCell('A1').fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFD72D58'}};
  catalogue.getCell('A1').alignment = {horizontal:'left', vertical:'middle'};
  catalogue.getRow(1).height = 34;
  catalogue.mergeCells('A2:I2');
  catalogue.getCell('A2').value = `Danh sách ${products.length} sản phẩm đang hiển thị trên website`;
  catalogue.getCell('A2').font = {name:'Be Vietnam Pro', size:10, color:{argb:'FF6E6967'}};
  catalogue.getCell('A2').alignment = {vertical:'middle'};
  catalogue.getRow(2).height = 22;
  catalogue.getRow(3).height = 8;

  const headerRow = catalogue.addRow(['Hình ảnh', 'Tên sản phẩm', 'Nhóm hàng', 'Giá bán', 'Thương hiệu', 'Mã sản phẩm', 'Phân loại', 'Số suất đã đặt trước', 'Tổng số suất']);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = {name:'Be Vietnam Pro', size:10, bold:true, color:{argb:'FFFFFFFF'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF9F1739'}};
    cell.alignment = {horizontal:'left', vertical:'middle'};
    cell.border = {bottom:{style:'thin', color:{argb:'FFE5D7CC'}}};
  });

  for (const product of products) {
    const row = catalogue.addRow([
      '',
      String(product?.name || 'Sản phẩm chưa có tên'),
      String(product?.productGroup || ''),
      productCatalogPrice(product),
      String(product?.brand || ''),
      String(product?.sku || ''),
      productCatalogVariants(product),
      Number.isFinite(Number(product?.dealSlotsRemaining)) ? Math.max(0, Math.min(9999, Math.floor(Number(product.dealSlotsRemaining)))) : 0,
      Number.isFinite(Number(product?.dealSlotsTotal)) ? Math.max(1, Math.min(9999, Math.floor(Number(product.dealSlotsTotal)))) : 20
    ]);
    row.height = 86;
    row.eachCell(cell => {
      cell.font = {name:'Be Vietnam Pro', size:10, color:{argb:'FF242224'}};
      cell.alignment = {vertical:'middle', wrapText:true};
      cell.border = {bottom:{style:'thin', color:{argb:'FFE5D7CC'}}};
    });
    row.getCell(2).font = {name:'Be Vietnam Pro', size:10, bold:true, color:{argb:'FF242224'}};
    row.getCell(4).numFmt = '#,##0 "đ"';
    row.getCell(4).font = {name:'Be Vietnam Pro', size:10, bold:true, color:{argb:'FFD72D58'}};
    row.getCell(1).alignment = {horizontal:'center', vertical:'middle'};

    const imageBuffer = await catalogImageBuffer(product?.image);
    const imageInfo = imageBuffer && imageDimensions(imageBuffer);
    if (!imageInfo || !imageBuffer) {
      row.getCell(1).value = 'Chưa có ảnh';
      row.getCell(1).font = {name:'Be Vietnam Pro', size:9, italic:true, color:{argb:'FF6E6967'}};
      continue;
    }
    const boxWidth = 104;
    const boxHeight = 98;
    const scale = Math.min(boxWidth / imageInfo.width, boxHeight / imageInfo.height);
    const width = Math.max(1, Math.round(imageInfo.width * scale));
    const height = Math.max(1, Math.round(imageInfo.height * scale));
    const imageId = workbook.addImage({buffer:imageBuffer, extension:imageInfo.extension});
    catalogue.addImage(imageId, {
      tl: {col: 0.15 + (boxWidth - width) / 130, row: row.number - 1 + (boxHeight - height) / 115},
      ext: {width, height}
    });
  }

  const dataSheet = workbook.addWorksheet('Dữ liệu cập nhật');
  dataSheet.columns = productWorkbookHeaders.map((header, index) => ({header, key:header, width:productWorkbookWidths[index]}));
  productWorkbookRows(products).forEach(row => dataSheet.addRow(row));
  dataSheet.views = [{state:'frozen', ySplit:1}];
  dataSheet.getRow(1).height = 26;
  dataSheet.getRow(1).eachCell(cell => {
    cell.font = {name:'Be Vietnam Pro', size:10, bold:true, color:{argb:'FFFFFFFF'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF9F1739'}};
    cell.alignment = {vertical:'middle', wrapText:true};
  });
  dataSheet.getColumn('Giá khuyến mãi').numFmt = '#,##0';
  dataSheet.getColumn('Giá thường').numFmt = '#,##0';
  dataSheet.getColumn('Giá phân loại').numFmt = '#,##0';

  const guideSheet = workbook.addWorksheet('Hướng dẫn');
  guideSheet.columns = [{width:28}, {width:72}, {width:52}];
  const guideRows = XLSX.utils.sheet_to_json(productWorkbookGuide(), {defval:'', raw:false});
  const guideHeaders = ['Cột', 'Yêu cầu', 'Ví dụ'];
  guideSheet.addRow(guideHeaders);
  guideRows.forEach(row => guideSheet.addRow(guideHeaders.map(header => row[header])));
  guideSheet.views = [{state:'frozen', ySplit:1}];
  guideSheet.getRow(1).eachCell(cell => {
    cell.font = {name:'Be Vietnam Pro', size:10, bold:true, color:{argb:'FFFFFFFF'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF9F1739'}};
  });
  guideSheet.eachRow(row => row.eachCell(cell => {
    cell.alignment = {vertical:'top', wrapText:true};
    cell.font = {name:'Be Vietnam Pro', size:10, color:{argb:'FF242224'}};
  }));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function isValidUploadedImage(mimeType, buffer) {
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const gif = buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/png') return png;
  if (mimeType === 'image/jpeg') return jpeg;
  if (mimeType === 'image/gif') return gif;
  if (mimeType === 'image/webp') return webp;
  if (mimeType !== 'image/svg+xml') return false;
  const svg = buffer.toString('utf8');
  return /<svg[\s>]/i.test(svg) && !/<(?:script|foreignObject)\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=\s*[\"']?\s*(?:javascript:|data:)/i.test(svg);
}

function dataUrlBuffer(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Tệp tải lên không hợp lệ.');
  return {mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64')};
}

function isValidImportFile(kind, filename, buffer) {
  if (!buffer.length) return false;
  if (kind === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind === 'image') {
    const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const gif = buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
    const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    return png || jpeg || gif || webp;
  }
  if (kind === 'excel') {
    const extension = path.extname(filename).toLowerCase();
    if (extension === '.csv') return !buffer.subarray(0, 512).includes(0);
    const zip = buffer.subarray(0, 2).toString('ascii') === 'PK';
    const ole = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    return zip || ole;
  }
  return false;
}

function quoteFileKind(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.xlsx' || extension === '.xls') return 'excel';
  return '';
}

function isValidQuoteFile(kind, filename, buffer) {
  if (!buffer.length) return false;
  if (kind === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind !== 'excel') return false;

  const extension = path.extname(filename).toLowerCase();
  const zip = buffer.subarray(0, 2).toString('ascii') === 'PK';
  const ole = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if ((extension === '.xlsx' && !zip) || (extension === '.xls' && !ole)) return false;
  try {
    XLSX.read(buffer, {type:'buffer', dense:true});
    return true;
  } catch {
    return false;
  }
}

function sheetText(value, limit = 500) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function sheetMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function googleSheetOrderPayload(input = {}) {
  const customer = input.customer && typeof input.customer === 'object' ? input.customer : {};
  const order = input.order && typeof input.order === 'object' ? input.order : {};
  const items = Array.isArray(order.items) ? order.items.slice(0, 50).map(item => {
    const quantity = Math.max(1, Math.min(999, Math.round(Number(item?.quantity ?? item?.qty) || 1)));
    const unitPrice = sheetMoney(item?.unitPrice ?? item?.price);
    return {
    name: sheetText(item?.name || 'Sản phẩm', 180),
    variant: sheetText(item?.variantName || item?.variantLabel || item?.variant || '', 120),
    sku: sheetText(item?.variantSku || item?.sku || '', 100),
    code: sheetText(item?.variantSku || item?.sku || item?.id || '', 100),
    quantity,
    price: unitPrice,
    unitPrice,
    lineTotal: quantity * unitPrice
    };
  }) : [];
  const orderCode = sheetText(order.code, 40);
  const customerName = sheetText(customer.name, 160);
  const phone = sheetText(customer.phone, 40);
  if (!orderCode || !customerName || !phone || !items.length) throw new Error('Dữ liệu khách hàng hoặc đơn hàng chưa đầy đủ để gửi Google Sheet.');

  const createdAt = sheetText(order.createdAt || customer.createdAt, 80) || new Date().toISOString();
  const customerId = sheetText(customer.id, 80);
  const safeCustomer = {
    id: customerId,
    name: customerName,
    phone,
    email: sheetText(customer.email, 180),
    address: sheetText(customer.address, 500),
    message: sheetText(customer.message, 500),
    createdAt
  };
  const safeOrder = {
    code: orderCode,
    customerId,
    items,
    subtotal: sheetMoney(order.subtotal),
    discount: sheetMoney(order.discount),
    promotion: sheetText(order.promotion, 180),
    total: sheetMoney(order.total),
    createdAt
  };
  const itemsText = items.map(item => `${item.name}${item.variant ? ` – ${item.variant}` : ''}${item.code ? ` | Mã: ${item.code}` : ''} | SL: ${item.quantity}`).join('\n');
  const unitPricesText = items.map(item => String(item.unitPrice)).join('\n');
  const lineTotalsText = items.map(item => String(item.lineTotal)).join('\n');
  const promotionText = safeOrder.promotion + (safeOrder.discount ? `${safeOrder.promotion ? ' – ' : ''}Giảm ${safeOrder.discount} VNĐ` : '');
  return {
    event: 'new_order',
    source: 'AEON BlackFriday 2026',
    submittedAt: new Date().toISOString(),
    orderCode,
    customerId,
    customerName,
    phone,
    email: safeCustomer.email,
    address: safeCustomer.address,
    message: safeCustomer.message,
    itemsText,
    unitPricesText,
    lineTotalsText,
    itemsJson: JSON.stringify(items),
    subtotal: safeOrder.subtotal,
    discount: safeOrder.discount,
    promotion: safeOrder.promotion,
    promotionText,
    total: safeOrder.total,
    createdAt,
    customer: safeCustomer,
    order: safeOrder
  };
}

async function sendOrderToGoogleSheet(payload) {
  if (!googleSheetWebAppUrl) throw new Error('Máy chủ chưa cấu hình GOOGLE_SHEET_WEB_APP_URL.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(googleSheetWebAppUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json; charset=utf-8'},
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await response.text();
    const finalUrl = String(response.url || '');
    const loginRequired = /accounts\.google\.com|ServiceLogin/i.test(finalUrl + '\n' + text.slice(0, 1000));
    if (loginRequired) throw new Error('Apps Script đang yêu cầu đăng nhập Google. Hãy triển khai Web App với quyền truy cập Anyone.');
    if (!response.ok) throw new Error(`Google Apps Script phản hồi HTTP ${response.status}.`);
    if (/<title>\s*(?:Lỗi|Error)\s*<\/title>|Không tìm thấy hàm tập lệnh|class=["']errorMessage["']/i.test(text)) {
      const plainText = text
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
      throw new Error(plainText.slice(0, 300) || 'Google Apps Script trả về trang lỗi.');
    }

    let result = null;
    try { result = JSON.parse(text); } catch { result = {message:text.slice(0, 300)}; }
    if (result && (result.ok === false || String(result.status || '').toLowerCase() === 'error')) {
      throw new Error(sheetText(result.message || result.error || 'Google Sheet từ chối dữ liệu.', 300));
    }
    return {ok:true, status:response.status, result};
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Google Apps Script phản hồi quá chậm.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function outlookConfigurationStatus() {
  const missing = [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(microsoftClientId)) missing.push('MICROSOFT_CLIENT_ID');
  if (microsoftClientSecret.length < 8) missing.push('MICROSOFT_CLIENT_SECRET');
  if (!/^(common|organizations|consumers|[a-z0-9.-]+)$/i.test(microsoftTenantId)) missing.push('MICROSOFT_TENANT_ID (không hợp lệ)');
  if (!microsoftRedirectUri) missing.push('MICROSOFT_REDIRECT_URI');
  if (outlookTokenEncryptionSecret.length < 32) missing.push('AEON_OUTLOOK_TOKEN_KEY');
  if (!['file', 'supabase'].includes(outlookStorage)) missing.push('AEON_OUTLOOK_STORAGE (không hợp lệ)');
  if (outlookStorage === 'supabase' && !supabaseUrl) missing.push('SUPABASE_URL');
  if (outlookStorage === 'supabase' && !supabaseServerKey) missing.push('SUPABASE_SECRET_KEY hoặc SUPABASE_SERVICE_ROLE_KEY');
  if (microsoftRedirectUri) {
    try {
      const redirect = new URL(microsoftRedirectUri);
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
      if (redirect.protocol !== 'https:' && !(localHost && redirect.protocol === 'http:')) missing.push('MICROSOFT_REDIRECT_URI (cần HTTPS)');
    } catch {
      missing.push('MICROSOFT_REDIRECT_URI (không hợp lệ)');
    }
  }
  return {configured:missing.length === 0, missing};
}

function outlookTokenKey() {
  if (outlookTokenEncryptionSecret.length < 32) throw new Error('Máy chủ chưa cấu hình khóa mã hóa token Outlook (AEON_OUTLOOK_TOKEN_KEY).');
  return crypto.createHash('sha256').update(outlookTokenEncryptionSecret, 'utf8').digest();
}

function decryptOutlookTokens(record) {
  if (record?.version !== 1 || !record.iv || !record.tag || !record.data) throw new Error('Không đọc được thông tin kết nối Outlook đã lưu.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', outlookTokenKey(), Buffer.from(record.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.data, 'base64url')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function encryptOutlookTokens(tokens) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', outlookTokenKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens), 'utf8'),
    cipher.final()
  ]);
  return {
    version:1,
    iv:iv.toString('base64url'),
    tag:cipher.getAuthTag().toString('base64url'),
    data:encrypted.toString('base64url')
  };
}

function outlookCloudHeaders(prefer = '') {
  return {
    apikey:supabaseServerKey,
    // New sb_secret keys are not JWTs. Legacy service_role keys still use Bearer.
    ...(!supabaseServerKey.startsWith('sb_secret_') ? {Authorization:`Bearer ${supabaseServerKey}`} : {}),
    ...(prefer ? {Prefer:prefer} : {})
  };
}

async function outlookCloudRequest(url, options = {}) {
  const {prefer, headers, ...requestOptions} = options;
  const response = await fetch(`${supabaseUrl}/rest/v1/aeon_outlook_credentials${url}`, {
    ...requestOptions,
    headers:{...outlookCloudHeaders(prefer), ...(headers || {})},
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Không thể truy cập kho kết nối Outlook trên Supabase (HTTP ${response.status}). Kiểm tra bảng riêng và khóa service role.`);
  return response;
}

async function readOutlookTokens() {
  if (outlookStorage === 'supabase') {
    if (!supabaseUrl || !supabaseServerKey) throw new Error('Máy chủ chưa cấu hình kho kết nối Outlook trên Supabase.');
    const response = await outlookCloudRequest('?id=eq.primary&select=payload');
    const rows = await response.json();
    if (rows?.length) return decryptOutlookTokens(rows[0].payload);
    // Preserve an existing connection when moving from a persistent local disk.
    if (!fs.existsSync(outlookTokenPath)) return null;
    const tokens = decryptOutlookTokens(JSON.parse(fs.readFileSync(outlookTokenPath, 'utf8')));
    await writeOutlookTokens(tokens);
    fs.rmSync(outlookTokenPath, {force:true});
    return tokens;
  }
  if (!fs.existsSync(outlookTokenPath)) return null;
  return decryptOutlookTokens(JSON.parse(fs.readFileSync(outlookTokenPath, 'utf8')));
}

async function writeOutlookTokens(tokens) {
  const record = encryptOutlookTokens(tokens);
  if (outlookStorage === 'supabase') {
    await outlookCloudRequest('?on_conflict=id', {
      method:'POST',
      prefer:'resolution=merge-duplicates,return=minimal',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify([{id:'primary', payload:record, updated_at:new Date().toISOString()}])
    });
    return;
  }
  const temporary = `${outlookTokenPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record), {mode:0o600});
  fs.renameSync(temporary, outlookTokenPath);
  try { fs.chmodSync(outlookTokenPath, 0o600); } catch {}
}

async function deleteOutlookTokens() {
  if (outlookStorage === 'supabase') {
    await outlookCloudRequest('?id=eq.primary', {method:'DELETE'});
  }
  fs.rmSync(outlookTokenPath, {force:true});
  fs.rmSync(`${outlookTokenPath}.tmp`, {force:true});
}

function microsoftEndpoint(pathname) {
  const tenant = encodeURIComponent(microsoftTenantId);
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/${pathname}`;
}

async function microsoftTokenRequest(form) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(microsoftEndpoint('token'), {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(form),
      signal:controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(result.error_description || result.error || '').replace(/\s+/g, ' ').trim().slice(0, 260);
      throw new Error(detail ? `Microsoft không chấp nhận kết nối: ${detail}` : `Microsoft phản hồi HTTP ${response.status} khi kết nối Outlook.`);
    }
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Microsoft đăng nhập phản hồi quá chậm. Hãy thử kết nối lại.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function microsoftProfile(accessToken) {
  const response = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
    headers:{Authorization:`Bearer ${accessToken}`, Accept:'application/json'},
    signal:AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `Không đọc được hộp thư Microsoft (HTTP ${response.status}).`);
  return {
    displayName:String(result.displayName || '').slice(0, 160),
    email:String(result.mail || result.userPrincipalName || '').slice(0, 254)
  };
}

async function getOutlookAccessToken() {
  if (outlookRefreshInFlight) return outlookRefreshInFlight;
  outlookRefreshInFlight = (async () => {
    const saved = await readOutlookTokens();
    if (!saved?.refreshToken) throw new Error('Chưa kết nối hộp thư Outlook. Hãy kết nối Outlook trước khi gửi email.');
    if (Number(saved.expiresAt) > Date.now() + 120000 && saved.accessToken) return saved.accessToken;
    const refreshed = await microsoftTokenRequest({
      client_id:microsoftClientId,
      client_secret:microsoftClientSecret,
      grant_type:'refresh_token',
      refresh_token:saved.refreshToken,
      scope:'offline_access User.Read Mail.Send'
    });
    const next = {
      ...saved,
      accessToken:String(refreshed.access_token || ''),
      refreshToken:String(refreshed.refresh_token || saved.refreshToken),
      expiresAt:Date.now() + Math.max(60, Number(refreshed.expires_in) || 3600) * 1000
    };
    if (!next.accessToken) throw new Error('Microsoft không cấp access token mới. Hãy kết nối lại Outlook.');
    await writeOutlookTokens(next);
    return next.accessToken;
  })();
  try {
    return await outlookRefreshInFlight;
  } catch (error) {
    if (/invalid_grant|interaction_required|expired/i.test(String(error.message || ''))) {
      throw new Error('Phiên kết nối Outlook đã hết hạn. Hãy kết nối lại hộp thư.');
    }
    throw error;
  } finally {
    outlookRefreshInFlight = null;
  }
}

function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}

function formatEmailMoney(value) {
  const amount = Math.max(0, Number(value) || 0);
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
}

function orderConfirmationHtml(customer, order) {
  const items = (Array.isArray(order.items) ? order.items : []).slice(0, 80);
  const rows = items.map(item => {
    const quantity = Math.max(1, Math.min(9999, Number(item?.qty ?? item?.quantity) || 1));
    const unitPrice = Math.max(0, Number(item?.price ?? item?.unitPrice) || 0);
    const lineTotal = Math.max(0, Number(item?.lineTotal) || unitPrice * quantity);
    return `<tr><td style="padding:12px 8px;border-bottom:1px solid #e9e3db">${escapeEmailHtml(item?.name || 'Sản phẩm')}${item?.variantLabel ? `<br><span style="color:#766f68;font-size:13px">${escapeEmailHtml(item.variantLabel)}</span>` : ''}</td><td style="padding:12px 8px;border-bottom:1px solid #e9e3db;text-align:center">${quantity}</td><td style="padding:12px 8px;border-bottom:1px solid #e9e3db;text-align:right">${formatEmailMoney(lineTotal)}</td></tr>`;
  }).join('');
  const discount = Math.max(0, Number(order.discount) || 0);
  const subtotal = Math.max(0, Number(order.subtotal) || 0);
  const promotion = order.promotion ? `<p style="margin:5px 0;color:#706a64">Ưu đãi: ${escapeEmailHtml(order.promotion)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f0e8;color:#242224;font-family:Arial,Helvetica,sans-serif"><div style="max-width:680px;margin:24px auto;padding:0 14px"><div style="background:#bd1232;color:#fff;padding:24px;border-radius:14px 14px 0 0"><div style="font-size:13px;letter-spacing:2px;font-weight:bold">AEON · BLACK FRIDAY</div><h1 style="margin:12px 0 4px;font-size:25px">Đơn hàng đã được xác nhận</h1><div style="font-size:15px">Mã đơn: <b>${escapeEmailHtml(order.code)}</b></div></div><div style="background:#fff;padding:24px;border:1px solid #e7e0d6;border-top:0"><p>Xin chào <b>${escapeEmailHtml(customer.name || 'Quý khách')}</b>,</p><p>Đơn hàng của bạn đã được xác nhận. AEON sẽ liên hệ để cập nhật quá trình giao hàng nếu cần.</p><table role="presentation" style="width:100%;border-collapse:collapse;margin:18px 0"><thead><tr><th style="text-align:left;padding:10px 8px;border-bottom:2px solid #bd1232">Sản phẩm</th><th style="padding:10px 8px;border-bottom:2px solid #bd1232">SL</th><th style="text-align:right;padding:10px 8px;border-bottom:2px solid #bd1232">Thành tiền</th></tr></thead><tbody>${rows}</tbody></table><div style="text-align:right;line-height:1.8"><div>Tạm tính: ${formatEmailMoney(subtotal)}</div>${discount ? `<div>Giảm giá: −${formatEmailMoney(discount)}</div>` : ''}${promotion}<div style="font-size:20px;font-weight:bold;color:#bd1232">Tổng thanh toán: ${formatEmailMoney(order.total)}</div></div><div style="margin-top:22px;padding-top:16px;border-top:1px solid #e9e3db;color:#706a64;font-size:13px"><div>Điện thoại: ${escapeEmailHtml(customer.phone || '—')}</div><div>Địa chỉ: ${escapeEmailHtml(customer.address || '—')}</div><div>Thời gian đặt: ${escapeEmailHtml(order.createdAt || customer.createdAt || '—')}</div></div></div><div style="padding:18px;text-align:center;color:#706a64;font-size:12px">Cảm ơn bạn đã mua sắm cùng AEON Black Friday.</div></div></body></html>`;
}

async function sendOrderConfirmationFromOutlook(customer, order) {
  const accessToken = await getOutlookAccessToken();
  const message = {
    subject:`AEON Black Friday · Xác nhận đơn ${String(order.code || '').slice(0, 60)}`,
    body:{contentType:'HTML', content:orderConfirmationHtml(customer, order)},
    toRecipients:[{emailAddress:{address:String(customer.email || '').trim()}}],
    importance:'normal'
  };
  let response;
  try {
    response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method:'POST',
      headers:{Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json', Accept:'application/json'},
      body:JSON.stringify({message, saveToSentItems:true}),
      signal:AbortSignal.timeout(20000)
    });
  } catch (error) {
    const uncertain = new Error(error?.name === 'TimeoutError'
      ? 'Không nhận được phản hồi từ Outlook; hãy kiểm tra mục Sent Items trước khi gửi lại.'
      : 'Mất kết nối khi gửi email; hãy kiểm tra mục Sent Items trước khi gửi lại.');
    uncertain.deliveryUnknown = true;
    throw uncertain;
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(String(result?.error?.message || `Outlook từ chối gửi email (HTTP ${response.status}).`).slice(0, 300));
  }
  return {acceptedAt:new Date().toISOString(), statusCode:response.status};
}

function outlookCallbackPage(ok, message) {
  const safeMessage = escapeHtmlAttribute(message);
  const result = JSON.stringify({type:'aeon-outlook-oauth', ok:Boolean(ok), message:String(message || '')}).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Outlook</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e8;font-family:Arial,sans-serif;color:#242224"><main style="max-width:460px;margin:24px;padding:28px;border-radius:14px;background:#fff;box-shadow:0 12px 40px #2d182015"><h1 style="font-size:22px">${ok ? 'Đã kết nối Outlook' : 'Chưa kết nối được Outlook'}</h1><p>${safeMessage}</p><button onclick="window.close()" style="padding:10px 16px;border:0;border-radius:6px;background:#bd1232;color:#fff;font-weight:bold;cursor:pointer">Đóng cửa sổ</button></main><script>try{window.opener?.postMessage(${result},window.location.origin)}catch{} if(window.opener&&${Boolean(ok)})setTimeout(()=>window.close(),900)</script></body></html>`;
}

function sendOutlookCallbackPage(response, ok, message, statusCode = 200) {
  response.writeHead(statusCode, {'Content-Type':'text/html; charset=utf-8', ...noCacheHeaders});
  response.end(outlookCallbackPage(ok, message));
}

async function handleOutlookOrderConfirmation(request, response, orderCode) {
  if (!requirePermission(request, response, 'customers')) return;
  if (outlookOrderSends.has(orderCode)) return json(response, 409, {error:'Email cho đơn này đang được xử lý.'});
  outlookOrderSends.add(orderCode);
  try {
    const payload = JSON.parse((await readBody(request, 24 * 1024)).toString('utf8') || '{}');
    const resend = payload?.resend === true;
    const state = readState();
    const orders = Array.isArray(state['aeon-orders']) ? state['aeon-orders'].map(order => ({...order})) : [];
    const orderIndex = orders.findIndex(order => String(order?.code || '') === orderCode);
    if (orderIndex < 0) return json(response, 404, {error:'Không tìm thấy đơn hàng.'});
    const order = orders[orderIndex];
    const customer = (Array.isArray(state['aeon-customers']) ? state['aeon-customers'] : [])
      .find(item => String(item?.id ?? '') === String(order.customerId ?? ''));
    const email = String(customer?.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(response, 400, {error:'Đơn hàng chưa có địa chỉ email hợp lệ của khách hàng.'});
    const emailState = order.emailConfirmation || {};
    if (emailState.status === 'sending') return json(response, 409, {error:'Email của đơn này đang ở trạng thái xử lý. Hãy tải lại trước khi thao tác tiếp.'});
    if (emailState.status === 'sent' && !resend) return json(response, 409, {error:'Email đã được gửi. Chọn gửi lại nếu khách cần nhận thêm một bản.'});
    if (emailState.status === 'uncertain' && !resend) return json(response, 409, {error:'Chưa rõ Outlook đã nhận email hay chưa. Hãy kiểm tra Sent Items trước khi chọn gửi lại.'});
    const outlookConfig = outlookConfigurationStatus();
    if (!outlookConfig.configured) return json(response, 503, {error:`Máy chủ chưa cấu hình Outlook: ${outlookConfig.missing.join(', ')}.`});
    const connected = await readOutlookTokens();
    if (!connected?.refreshToken) return json(response, 503, {error:'Chưa kết nối hộp thư Outlook. Hãy kết nối trong mục Khách hàng & đơn hàng.'});

    const principal = adminPrincipal(request);
    const now = new Date().toISOString();
    order.status = 'confirmed';
    order.confirmedAt ||= now;
    order.confirmedBy ||= principal?.username || 'admin';
    order.emailConfirmation = {
      status:'sending',
      startedAt:now,
      recipient:email,
      sentBy:principal?.username || 'admin',
      resendCount:Math.max(0, Number(emailState.resendCount) || 0) + (emailState.status === 'sent' ? 1 : 0)
    };
    orders[orderIndex] = order;
    state['aeon-orders'] = orders;
    await writeState(state, ['aeon-orders']);

    let graphAccepted = false;
    try {
      const sent = await sendOrderConfirmationFromOutlook(customer, order);
      graphAccepted = true;
      order.emailConfirmation = {
        ...order.emailConfirmation,
        status:'sent',
        sentAt:sent.acceptedAt,
        outlookResponse:sent.statusCode
      };
      orders[orderIndex] = order;
      state['aeon-orders'] = orders;
      await writeState(state, ['aeon-orders']);
      return json(response, 200, {ok:true, status:'sent', orderCode, recipient:email, sentAt:sent.acceptedAt});
    } catch (error) {
      const deliveryUnknown = Boolean(error.deliveryUnknown || graphAccepted);
      order.emailConfirmation = {
        ...order.emailConfirmation,
        status:deliveryUnknown ? 'uncertain' : 'failed',
        failedAt:new Date().toISOString(),
        error:String(graphAccepted
          ? 'Outlook đã nhận email nhưng chưa lưu được trạng thái đơn. Hãy kiểm tra Sent Items trước khi gửi lại.'
          : error.message || 'Không gửi được email xác nhận.').slice(0, 300)
      };
      orders[orderIndex] = order;
      state['aeon-orders'] = orders;
      try { await writeState(state, ['aeon-orders']); } catch {}
      return json(response, 502, {error:order.emailConfirmation.error, status:order.emailConfirmation.status});
    }
  } catch (error) {
    return json(response, 500, {error:error.message || 'Không thể xác nhận và gửi email đơn hàng.'});
  } finally {
    outlookOrderSends.delete(orderCode);
  }
}

http.createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname); }
  catch { response.writeHead(400); return response.end('Bad request'); }
  await stateReady;

  if (request.method === 'GET' && pathname === '/api/admin/session') {
    const principal = adminPrincipal(request);
    return json(response, 200, {authenticated:Boolean(principal), configured:configuredAdmin(), user:publicAdminPrincipal(principal)});
  }
  if (request.method === 'POST' && pathname === '/api/admin/login') {
    if (!configuredAdmin()) return json(response, 503, {error:'Máy chủ chưa cấu hình ADMIN_USERNAME và ADMIN_PASSWORD.'});
    try {
      const {username, password} = JSON.parse((await readBody(request, 32 * 1024)).toString('utf8'));
      let principal = null;
      if (adminUsernameMatches(username) && secureTextEqual(password, adminPassword)) {
        principal = ownerPrincipal();
      } else {
        const account = subAdminAccounts(readState()).find(item => (
          item?.active !== false
          && secureTextEqual(normaliseSubAdminUsername(item?.username), normaliseSubAdminUsername(username))
        ));
        if (account && verifySubAdminPassword(password, account.passwordHash)) {
          principal = {
            accountId: String(account.id),
            username: normaliseSubAdminUsername(account.username),
            displayName: cleanSubAdminDisplayName(account.displayName, account.username),
            isOwner: false,
            permissions: cleanSubAdminPermissions(account.permissions)
          };
        }
      }
      if (!principal) {
        return json(response, 401, {error:'Tài khoản hoặc mật khẩu chưa đúng.'});
      }
      const token = crypto.randomBytes(32).toString('base64url');
      adminSessions.set(token, {...principal, expiresAt: Date.now() + adminSessionTtlSeconds * 1000});
      response.writeHead(200, {
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store',
        'Set-Cookie':adminCookie(request, token)
      });
      return response.end(JSON.stringify({ok:true, user:publicAdminPrincipal(principal)}));
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể đăng nhập.'});
    }
  }
  if (request.method === 'POST' && pathname === '/api/admin/logout') {
    const token = adminSessionToken(request);
    if (token) adminSessions.delete(token);
    if (token) {
      for (const [state, attempt] of outlookOAuthAttempts.entries()) {
        if (attempt.sessionToken === token) outlookOAuthAttempts.delete(state);
      }
    }
    response.writeHead(200, {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'Set-Cookie':adminCookie(request, '', 0)
    });
    return response.end(JSON.stringify({ok:true}));
  }

  if (request.method === 'GET' && pathname === '/api/admin/outlook/status') {
    if (!requirePermission(request, response, 'customers')) return;
    const config = outlookConfigurationStatus();
    let connection = null;
    let connectionError = '';
    try { connection = await readOutlookTokens(); }
    catch (error) { connectionError = String(error.message || 'Không đọc được thông tin kết nối Outlook.').slice(0, 220); }
    return json(response, 200, {
      configured:config.configured,
      missing:config.missing,
      storage:outlookStorage,
      connected:Boolean(connection?.refreshToken && !connectionError),
      email:connectionError ? '' : String(connection?.email || ''),
      displayName:connectionError ? '' : String(connection?.displayName || ''),
      connectionError
    });
  }
  if (request.method === 'GET' && pathname === '/api/admin/outlook/connect') {
    if (!requireOwner(request, response)) return;
    const config = outlookConfigurationStatus();
    if (!config.configured) return sendOutlookCallbackPage(response, false, `Máy chủ còn thiếu cấu hình: ${config.missing.join(', ')}.`, 503);
    const sessionToken = adminSessionToken(request);
    if (!sessionToken) return sendOutlookCallbackPage(response, false, 'Phiên quản trị đã hết hạn. Hãy đăng nhập lại rồi kết nối Outlook.', 401);
    const now = Date.now();
    for (const [state, attempt] of outlookOAuthAttempts.entries()) {
      if (attempt.expiresAt <= now) outlookOAuthAttempts.delete(state);
    }
    const oauthState = crypto.randomBytes(32).toString('base64url');
    outlookOAuthAttempts.set(oauthState, {sessionToken, expiresAt:now + 10 * 60 * 1000});
    const authorizeUrl = new URL(microsoftEndpoint('authorize'));
    authorizeUrl.search = new URLSearchParams({
      client_id:microsoftClientId,
      response_type:'code',
      redirect_uri:microsoftRedirectUri,
      response_mode:'query',
      scope:'openid profile email offline_access User.Read Mail.Send',
      state:oauthState,
      prompt:'select_account'
    }).toString();
    response.writeHead(302, {'Location':authorizeUrl.href, ...noCacheHeaders});
    return response.end();
  }
  if (request.method === 'GET' && pathname === '/api/admin/outlook/callback') {
    const callbackUrl = new URL(request.url, 'http://localhost');
    const oauthState = String(callbackUrl.searchParams.get('state') || '');
    const attempt = outlookOAuthAttempts.get(oauthState);
    outlookOAuthAttempts.delete(oauthState);
    const session = attempt ? adminSessions.get(attempt.sessionToken) : null;
    if (!attempt || attempt.expiresAt <= Date.now() || !session || session.expiresAt <= Date.now() || !session.isOwner) {
      return sendOutlookCallbackPage(response, false, 'Yêu cầu kết nối không còn hợp lệ. Hãy đóng cửa sổ, đăng nhập lại và thử kết nối Outlook lần nữa.', 400);
    }
    const oauthError = String(callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error') || '').replace(/[\r\n]+/g, ' ').slice(0, 260);
    if (oauthError) return sendOutlookCallbackPage(response, false, `Microsoft chưa cấp quyền: ${oauthError}`, 400);
    const code = String(callbackUrl.searchParams.get('code') || '');
    if (!code) return sendOutlookCallbackPage(response, false, 'Microsoft không trả mã đăng nhập. Hãy thử kết nối lại.', 400);
    try {
      const tokens = await microsoftTokenRequest({
        client_id:microsoftClientId,
        client_secret:microsoftClientSecret,
        grant_type:'authorization_code',
        code,
        redirect_uri:microsoftRedirectUri,
        scope:'openid profile email offline_access User.Read Mail.Send'
      });
      if (!tokens.access_token || !tokens.refresh_token) throw new Error('Microsoft chưa cấp quyền gửi mail lâu dài. Hãy kiểm tra quyền offline_access và Mail.Send trong ứng dụng Microsoft.');
      const profile = await microsoftProfile(tokens.access_token);
      await writeOutlookTokens({
        accessToken:String(tokens.access_token),
        refreshToken:String(tokens.refresh_token),
        expiresAt:Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
        email:profile.email,
        displayName:profile.displayName,
        connectedAt:new Date().toISOString(),
        tenantId:microsoftTenantId
      });
      session.expiresAt = Date.now() + adminSessionTtlSeconds * 1000;
      return sendOutlookCallbackPage(response, true, `Đã kết nối hộp thư ${profile.email || 'Outlook'}.`);
    } catch (error) {
      return sendOutlookCallbackPage(response, false, error.message || 'Không thể lưu kết nối Outlook.', 400);
    }
  }
  if (request.method === 'POST' && pathname === '/api/admin/outlook/disconnect') {
    if (!requireOwner(request, response)) return;
    try {
      await deleteOutlookTokens();
      return json(response, 200, {ok:true});
    } catch (error) {
      return json(response, 500, {error:error.message || 'Không thể ngắt kết nối Outlook.'});
    }
  }
  const outlookOrderConfirmationMatch = request.method === 'POST'
    ? /^\/api\/admin\/orders\/([^/]+)\/confirm-email$/.exec(pathname)
    : null;
  if (outlookOrderConfirmationMatch) {
    return handleOutlookOrderConfirmation(request, response, outlookOrderConfirmationMatch[1]);
  }

  if (request.method === 'GET' && pathname === '/api/admin/accounts') {
    if (!requireOwner(request, response)) return;
    return json(response, 200, {permissions:adminPermissionDefinitions, accounts:accountDirectory(readState())});
  }
  if (request.method === 'POST' && pathname === '/api/admin/accounts') {
    if (!requireOwner(request, response)) return;
    try {
      const payload = JSON.parse((await readBody(request, 32 * 1024)).toString('utf8'));
      const action = String(payload?.action || '').trim();
      const state = readState();
      const accounts = subAdminAccounts(state).map(account => ({...account}));
      const now = new Date().toISOString();

      if (action === 'create') {
        const username = normaliseSubAdminUsername(payload.username);
        const displayName = cleanSubAdminDisplayName(payload.displayName, username);
        const password = String(payload.password || '');
        const permissions = cleanSubAdminPermissions(payload.permissions);
        if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json(response, 400, {error:'Tài khoản chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang (3–40 ký tự).'});
        if (adminUsernameMatches(username) || accounts.some(account => normaliseSubAdminUsername(account.username) === username)) return json(response, 409, {error:'Tên tài khoản này đã tồn tại.'});
        if (password.length < 8 || password.length > 128) return json(response, 400, {error:'Mật khẩu tài khoản con cần từ 8 đến 128 ký tự.'});
        if (!permissions.length) return json(response, 400, {error:'Hãy cấp ít nhất một quyền sử dụng cho tài khoản con.'});
        const account = {
          id: `sub-${crypto.randomBytes(12).toString('hex')}`,
          username,
          displayName,
          passwordHash: hashSubAdminPassword(password),
          permissions,
          active: true,
          createdAt: now,
          updatedAt: now
        };
        accounts.push(account);
        state[adminAccountsStateKey] = accounts;
        await writeState(state);
        return json(response, 201, {ok:true, account:publicSubAdminAccount(account)});
      }

      if (action === 'update') {
        const accountId = String(payload.id || '');
        const index = accounts.findIndex(account => String(account.id) === accountId);
        if (index < 0) return json(response, 404, {error:'Không tìm thấy tài khoản con.'});
        const account = accounts[index];
        const displayName = cleanSubAdminDisplayName(payload.displayName, account.displayName || account.username);
        const permissions = cleanSubAdminPermissions(payload.permissions);
        const password = String(payload.password || '');
        if (!permissions.length) return json(response, 400, {error:'Hãy cấp ít nhất một quyền sử dụng cho tài khoản con.'});
        if (password && (password.length < 8 || password.length > 128)) return json(response, 400, {error:'Mật khẩu mới cần từ 8 đến 128 ký tự.'});
        const updated = {
          ...account,
          displayName,
          permissions,
          active: payload.active !== false,
          updatedAt: now
        };
        if (password) updated.passwordHash = hashSubAdminPassword(password);
        accounts[index] = updated;
        state[adminAccountsStateKey] = accounts;
        await writeState(state);
        revokeSubAdminSessions(accountId);
        return json(response, 200, {ok:true, account:publicSubAdminAccount(updated)});
      }

      return json(response, 400, {error:'Thao tác tài khoản không hợp lệ.'});
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể lưu tài khoản.'});
    }
  }

  const deleteProductMatch = request.method === 'DELETE' ? /^\/api\/products\/([^/]+)$/.exec(pathname) : null;
  if (deleteProductMatch) {
    if (!requirePermission(request, response, 'products')) return;
    const productId = String(deleteProductMatch[1] || '').trim().slice(0, 100);
    if (!productId) return json(response, 400, {error:'Mã sản phẩm không hợp lệ.'});
    const state = readState();
    const serverProducts = Array.isArray(state['aeon-products']) ? state['aeon-products'] : [];
    let browserProducts = [];
    try {
      const payload = JSON.parse((await readBody(request, 5 * 1024 * 1024)).toString('utf8') || '{}');
      browserProducts = Array.isArray(payload.products) ? payload.products : [];
    } catch {
      browserProducts = [];
    }
    const products = serverProducts.length ? serverProducts : withoutDeletedProducts(state, browserProducts);
    const deletedProduct = products.find(product => String(product?.id || '') === productId) || null;
    const tombstones = productTombstones(state);
    tombstones.add(productId);
    state['aeon-products'] = products.filter(product => String(product?.id || '') !== productId);
    state[productTombstoneStateKey] = [...tombstones].slice(-5000);
    await writeState(state, ['aeon-products', productTombstoneStateKey]);
    return json(response, 200, {ok:true, deleted:Boolean(deletedProduct), product:deletedProduct, products:state['aeon-products']});
  }

  if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, stateForRequest(request));
  if (request.method === 'GET' && pathname === '/api/export/customers.xlsx') {
    if (!requirePermission(request, response, 'customers')) return;
    try {
      const workbook = customerWorkbook(readState());
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="danh-sach-khach-hang.xlsx"',
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store'
      });
      return response.end(workbook);
    } catch (error) {
      return json(response, 500, {error: error.message || 'Không thể tạo tệp Excel.'});
    }
  }
  const orderPdfMatch = request.method === 'GET' ? /^\/api\/orders\/([^/]+)\.pdf$/i.exec(pathname) : null;
  if (orderPdfMatch) {
    if (!requirePermission(request, response, 'customers')) return;
    try {
      const orderCode = orderPdfMatch[1];
      const pdf = await orderPdfBuffer(readState(), orderCode);
      const safeCode = String(orderCode).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'don-hang';
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="don-hang-${safeCode}.pdf"`,
        'Content-Length': pdf.length,
        'Cache-Control': 'no-store'
      });
      return response.end(pdf);
    } catch (error) {
      return json(response, error.statusCode || 500, {error:error.message || 'Không thể tạo PDF đơn hàng.'});
    }
  }
  if (request.method === 'GET' && pathname === '/api/template/products.xlsx') {
    try {
      const workbook = productImportTemplateWorkbook();
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': "attachment; filename=\"product-import-template.xlsx\"; filename*=UTF-8''mau-nhap-danh-sach-san-pham.xlsx",
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store'
      });
      return response.end(workbook);
    } catch (error) {
      return json(response, 500, {error: error.message || 'Không thể tạo mẫu Excel.'});
    }
  }
  if (request.method === 'GET' && pathname === '/api/export/products.xlsx') {
    try {
      const workbook = await productCatalogWorkbook(readState());
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': "attachment; filename=\"product-catalog.xlsx\"; filename*=UTF-8''danh-muc-san-pham.xlsx",
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store'
      });
      return response.end(workbook);
    } catch (error) {
      return json(response, 500, {error: error.message || 'Không thể tạo danh sách sản phẩm Excel.'});
    }
  }
  if (request.method === 'GET' && pathname === '/api/export/catalog.pdf') {
    try {
      const pdf = await productCatalogPdfBuffer(readState());
      response.writeHead(200, {
        'Content-Type':'application/pdf',
        'Content-Disposition':"attachment; filename=\"black-friday-catalog.pdf\"; filename*=UTF-8''catalog-black-friday-2026.pdf",
        'Content-Length':pdf.length,
        'Cache-Control':'no-store'
      });
      return response.end(pdf);
    } catch (error) {
      return json(response, 500, {error:error.message || 'Không thể tạo catalog PDF.'});
    }
  }
  if (request.method === 'POST' && pathname === '/api/state') {
    try {
      const {key, value} = JSON.parse((await readBody(request)).toString('utf8'));
      const allowedKeys = new Set(['aeon-products','aeon-ui','aeon-layout','aeon-brands','aeon-customers','aeon-orders']);
      if (!allowedKeys.has(key)) return json(response, 400, {error:'Không thể lưu loại dữ liệu này.'});
      const state = readState();
      if (key === 'aeon-products' && !requirePermission(request, response, 'products')) return;
      if (key === 'aeon-layout') {
        if (!requirePermission(request, response, 'interface')) return;
        const requested = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const current = publicLayoutForState(state);
        const desktopColumns = Number(requested.productColumns);
        const mobileColumns = Number(requested.productColumnsMobile);
        state[key] = {
          ...canonicalLayout,
          ...current,
          ...requested,
          productColumns: [0, 1, 2, 3, 4, 5, 6].includes(desktopColumns) ? desktopColumns : current.productColumns,
          productColumnsMobile: [0, 1, 2].includes(mobileColumns) ? mobileColumns : current.productColumnsMobile,
          storefrontRevision: canonicalLayout.storefrontRevision
        };
      }
      if (key === 'aeon-brands' && !requirePermission(request, response, 'brands')) return;
      if (key === 'aeon-ui') {
        const principal = adminPrincipal(request);
        if (!principal) {
          json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
          return;
        }
        if (!principalHasPermission(principal, 'interface')) {
          if (!principalHasPermission(principal, 'quotes')) {
            json(response, 403, {error:'Tài khoản chưa được cấp quyền nội dung giao diện hoặc file báo giá.'});
            return;
          }
          if (!quoteFileOnlyUiChange(state[key], value)) {
            json(response, 403, {error:'Tài khoản này chỉ được phép thay đổi file báo giá.'});
            return;
          }
        }
      }
      if (key === 'aeon-products') {
        const products = Array.isArray(value) ? value : [];
        // An authenticated product save/import is an explicit re-add. Release
        // tombstones for IDs present in that submitted catalogue so deleting a
        // catalogue and importing the same Excel file can restore every item.
        const restoredIds = new Set(products.map(product => String(product?.id || '').trim()).filter(Boolean));
        const tombstones = productTombstones(state);
        state[productTombstoneStateKey] = [...tombstones].filter(id => !restoredIds.has(id));
        state[key] = products;
      } else if (key === 'aeon-ui') {
        const requested = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        state[key] = {...canonicalStorefrontState['aeon-ui'], ...(state[key] || {}), ...requested,
          storefrontRevision:canonicalStorefrontState['aeon-ui'].storefrontRevision};
      } else if (key !== 'aeon-layout') {
        state[key] = value;
      }
      await writeState(state, key === 'aeon-products' ? [key, productTombstoneStateKey] : [key]);
      return json(response, 200, {ok:true});
    } catch (error) { return json(response, 400, {error:error.message || 'Không thể lưu dữ liệu.'}); }
  }

  if (request.method === 'POST' && pathname === '/api/google-sheet/orders') {
    try {
      const body = JSON.parse((await readBody(request, 256 * 1024)).toString('utf8'));
      const payload = googleSheetOrderPayload(body);
      const result = await sendOrderToGoogleSheet(payload);
      return json(response, 200, {ok:true, orderCode:payload.orderCode, googleSheet:result});
    } catch (error) {
      return json(response, 502, {ok:false, error:error.message || 'Không thể đồng bộ đơn hàng sang Google Sheet.'});
    }
  }

  if (request.method === 'POST' && pathname === '/api/upload') {
    const principal = adminPrincipal(request);
    if (!principal) {
      json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
      return;
    }
    if (!principalHasPermission(principal, 'products') && !principalHasPermission(principal, 'interface')) {
      json(response, 403, {error:'Tài khoản chưa được cấp quyền tải ảnh sản phẩm hoặc giao diện.'});
      return;
    }
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const match = /^data:(image\/(?:png|jpeg|webp|gif)|image\/svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
      if (!match || !uploadImageTypes.has(match?.[1])) return json(response, 400, {error:'Chỉ hỗ trợ ảnh PNG, JPG, WEBP, GIF hoặc SVG.'});
      const content = Buffer.from(match[2], 'base64');
      if (!content.length || content.length > maxUploadBytes) return json(response, 413, {error:'Ảnh phải nhỏ hơn hoặc bằng 10 MB.'});
      if (!isValidUploadedImage(match[1], content)) return json(response, 400, {error:'Tệp ảnh không hợp lệ hoặc không an toàn.'});
      const requestedName = path.basename(String(body.filename || 'image'));
      const base = path.basename(requestedName, path.extname(requestedName)).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'image';
      const filename = `${Date.now()}-${base}${imageExtensions[match[1]]}`;
      fs.writeFileSync(path.join(uploadDir, filename), content, {flag:'wx'});
      return json(response, 201, {url:`/assets/uploads/${filename}`});
    } catch (error) { return json(response, 400, {error:error.message || 'Không thể tải ảnh lên.'}); }
  }

  if (request.method === 'POST' && pathname === '/api/upload-quote') {
    if (!requirePermission(request, response, 'quotes')) return;
    try {
      const body = JSON.parse((await readBody(request, maxQuoteUploadBytes)).toString('utf8'));
      const filename = path.basename(String(body.filename || 'bao-gia'));
      const {buffer} = dataUrlBuffer(body.dataUrl);
      if (buffer.length > maxQuoteUploadBytes) return json(response, 413, {error:'Tệp báo giá phải nhỏ hơn hoặc bằng 20 MB.'});

      const kind = quoteFileKind(filename);
      if (!kind) return json(response, 400, {error:'Chỉ hỗ trợ tệp Excel (.xlsx, .xls) hoặc PDF (.pdf).'});
      if (!isValidQuoteFile(kind, filename, buffer)) return json(response, 400, {error:'Tệp báo giá không đúng định dạng hoặc đã bị hỏng.'});

      const extension = path.extname(filename).toLowerCase();
      const base = path.basename(filename, extension).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'bao-gia';
      const storedFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}${extension}`;
      fs.writeFileSync(path.join(quoteUploadDir, storedFilename), buffer, {flag:'wx'});
      return json(response, 201, {url:`/assets/uploads/quotes/${storedFilename}`, kind, filename:storedFilename});
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể tải tệp báo giá lên.'});
    }
  }

  if (request.method === 'POST' && pathname === '/api/import-products') {
    if (!requirePermission(request, response, 'products')) return;
    try {
      const body = JSON.parse((await readBody(request, maxImportBytes)).toString('utf8'));
      const filename = path.basename(String(body.filename || 'catalogue'));
      const {mimeType, buffer} = dataUrlBuffer(body.dataUrl);
      if (buffer.length > maxImportBytes) return json(response, 413, {error:'Tệp phải nhỏ hơn hoặc bằng 15 MB.'});
      const kind = kindFromFile(filename, mimeType);
      if (!kind || !isValidImportFile(kind, filename, buffer)) return json(response, 400, {error:'Tệp không đúng định dạng được hỗ trợ.'});
      const analysis = await analyseProductFile({filename, mimeType, buffer});
      return json(response, 200, {ok:true, filename, ...analysis});
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể phân tích tệp này.'});
    }
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  if (['/.aeon-store.json','/.aeon-outlook.json','/.env'].some(hiddenFile => requested === hiddenFile || requested.startsWith(`${hiddenFile}.`))) { response.writeHead(403); return response.end('Forbidden'); }
  const filePath = localAssetPath(requested);
  if (!filePath) { response.writeHead(403); return response.end('Forbidden'); }
  if (request.method === 'GET' && requested === '/index.html') {
    try {
      const content = storefrontHtml(request);
      response.writeHead(200, {
        'Content-Type':'text/html; charset=utf-8',
        // Preserve cookies/local storage but discard any obsolete CSS/JS cache.
        'Clear-Site-Data':'"cache"',
        ...noCacheHeaders
      });
      return response.end(content);
    } catch {
      response.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
      return response.end('Server error');
    }
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500, {'Content-Type':'text/plain; charset=utf-8'}); return response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error'); }
    // Production can retain an older checked-out CSS file. Append the fit lock
    // from the running server so both old and new storefront HTML stay correct.
    if (path.basename(filePath) === 'storefront-product-ux.css') {
      content = Buffer.concat([content, Buffer.from(productImageFitCss, 'utf8')]);
    }
    response.writeHead(200, {'Content-Type':types[path.extname(filePath).toLowerCase()] || 'application/octet-stream', ...noCacheHeaders});
    response.end(content);
  });
}).listen(port, host, () => console.log(`AEON BlackFriday is available on http://${host}:${port}`));
