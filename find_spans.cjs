const fs = require('fs');
const content = fs.readFileSync('c:/Users/Alberto Tingzon/requisition-system/src/views/RequisitionDetailView.vue', 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  const openCount = (line.match(/<span\b[^>]*>/gi) || []).length;
  const closeCount = (line.match(/<\/span>/gi) || []).length;
  if (openCount !== closeCount) {
    console.log(`Line ${index + 1}: open=${openCount}, close=${closeCount} | Content: ${line.trim()}`);
  }
});
