const fs = require('fs');
const content = fs.readFileSync('c:/Users/Alberto Tingzon/requisition-system/src/views/RequisitionDetailView.vue', 'utf8');

const tags = ['div', 'template', 'p', 'li', 'span', 'table', 'section', 'tr', 'td', 'th', 'button', 'svg', 'path', 'circle', 'rect', 'polygon', 'polyline', 'line'];

tags.forEach(tag => {
  const openRegex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRegex = new RegExp(`</${tag}>`, 'gi');
  const openCount = (content.match(openRegex) || []).length;
  const closeCount = (content.match(closeRegex) || []).length;
  console.log(`${tag}: open=${openCount}, close=${closeCount}, diff=${openCount - closeCount}`);
});
