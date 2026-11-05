// Stable storefront settings for static GitHub/Netlify deployments.
// Product data deliberately stays in the API state so a visual update can
// never replace the current product catalogue or product images.
const canonicalStorefrontState = {
  "aeon-ui": {
    "storefrontRevision": "blackfriday-20261104-v7",
    "eyebrow": "BLACK FRIDAY 2026",
    "title": "BlackFriday",
    "intro": "BlackFriday 2026, Top sản phẩm có giá ưu đãi đặc biệt.",
    "heroDisplayMode": "image-only",
    "promotionTitle": "Thông Tin Chiết Khấu",
    "promotionText": "Ưu đãi Black Friday từ 25/11 đến 01/12/2026.<br>• Giá đặc biệt cho sản phẩm được chọn.<br>• Số lượng có hạn tại từng điểm bán.<br>• Không áp dụng đồng thời với các chương trình khác.",
    "collectionTitle": "Deal hot\nBlack Friday.",
    "collectionNote": "Sản phẩm minh họa có thể thay nhanh bằng file Excel trong trang quản trị.",
    "heroImage": "/assets/black-friday-hero.svg",
    "heroPreviewVersion": "blackfriday-20261103",
    "logoText": "AEON",
    "logoSubtitle": "",
    "logoImage": "",
    "logoMode": "text",
    "quoteExcelUrl": "",
    "campaignSchedule": "25/11 – 01/12/2026",
    "quotePdfUrl": ""
  },
  "aeon-layout": {
    "storefrontRevision": "blackfriday-20261104-v7",
    "heroTitleSize": 35,
    "heroIntroSize": 13,
    "bannerAspectRatio": 1.5,
    "heroButtonAlign": "left",
    "productTitleSize": 12,
    "productButtonAlign": "left",
    "checkoutButtonAlign": "stretch",
    "accentColor": "#e21d3f",
    "accentDarkColor": "#9e102a",
    "pageBackgroundColor": "#080808",
    "sectionBackgroundColor": "#15100f",
    "textColor": "#fffaf4",
    "headerHeight": 60,
    "heroHeight": 0,
    "sectionSpacing": 0,
    "productImageHeight": 0,
    "productColumns": 4,
    "productColumnsMobile": 2,
    "fontFamily": "aeon-default",
    "logoSize": 18
  }
};
if (typeof window !== 'undefined') window.AEON_DEPLOYED_STOREFRONT_STATE = canonicalStorefrontState;
if (typeof module !== 'undefined' && module.exports) module.exports = canonicalStorefrontState;
