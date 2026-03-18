const fs = require('fs');
const content = fs.readFileSync('c:/Users/Alberto Tingzon/requisition-system/src/views/RequisitionDetailView.vue', 'utf8');
const lines = content.split('\n');

let braceCount = 0;
lines.forEach((line, index) => {
  const opens = (line.match(/{/g) || []).length;
  const closes = (line.match(/}/g) || []).length;
  braceCount += opens;
  braceCount -= closes;
  if (braceCount < 0) {
    console.log(`NEGATIVE BALANCE at line ${index + 1}: ${braceCount} | Content: ${line.trim()}`);
    // Don't reset, let's see where it goes back to 0
  }
});
console.log(`Final brace balance: ${braceCount}`);
