const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {analyseProductFile} = require('../product-import');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'catalog-standard.xlsx');

async function main() {
  const result = await analyseProductFile({
    filename:path.basename(source),
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:fs.readFileSync(source)
  });
  if (result.warnings.length || !result.candidates.length) throw new Error(`Excel chưa hợp lệ: ${result.warnings.join('; ')}`);
  const ids = new Set();
  const products = result.candidates.map((item, index) => {
    if (!item.name || !(Number(item.price) > 0) || !item.image) throw new Error(`Sản phẩm ${index + 1} thiếu tên, giá hoặc ảnh.`);
    const sourceId = String(item.id || '').trim();
    const identity = `${item.sku || ''}|${item.brand || ''}|${item.name || ''}`;
    const id = sourceId || `excel-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
    if (ids.has(id)) throw new Error(`ID sản phẩm bị trùng: ${id}`);
    ids.add(id);
    return {
      id,
      name:item.name,
      price:Number(item.price),
      originalPrice:Number(item.originalPrice) || 0,
      brand:item.brand || '',
      description:item.description || 'Thông tin sản phẩm sẽ được cập nhật.',
      sku:item.sku || '',
      label:item.label || '',
      weight:item.weight || '',
      ingredients:item.ingredients || '',
      image:item.image,
      images:item.images || [item.image],
      variantLabel:item.variants?.length ? item.variantLabel || 'Phân loại' : '',
      variants:item.variants || [],
      bg:'#e9c38b',
      box:'#8f1834',
      productGroup:item.productGroup || '',
      promotionProductName:item.promotionProductName || '',
      promotionProductValue:item.promotionProductValue || '',
      promotionProductImage:item.promotionProductImage || '',
      dealSlotsTotal:Number(item.dealSlotsTotal) > 0 ? Number(item.dealSlotsTotal) : 20,
      dealSlotsRemaining:Number(item.dealSlotsRemaining) || 0
    };
  });
  for (const filename of ['.aeon-store.seed.json', '.aeon-public-bootstrap.json']) {
    const target = path.join(root, filename);
    const state = JSON.parse(fs.readFileSync(target, 'utf8'));
    state['aeon-products'] = products;
    fs.writeFileSync(target, JSON.stringify(state, null, 2) + '\n');
  }
  const dataPath = path.join(root, 'data.js');
  const dataSource = fs.readFileSync(dataPath, 'utf8');
  const prefix = 'const AEON_DEFAULT_PRODUCTS = ';
  if (!dataSource.startsWith(prefix)) throw new Error('Không tìm thấy danh mục mặc định trong data.js.');
  const arrayEnd = dataSource.indexOf('\n];', prefix.length);
  if (arrayEnd < 0) throw new Error('Không tìm thấy cuối danh mục mặc định trong data.js.');
  fs.writeFileSync(dataPath, `${prefix}${JSON.stringify(products, null, 2)};${dataSource.slice(arrayEnd + 3)}`);
  console.log(`Danh mục chuẩn: ${products.length} sản phẩm từ ${path.basename(source)}.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
