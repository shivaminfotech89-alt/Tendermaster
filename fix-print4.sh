sed -i 's/footerHtml = \`<div style="height: 150px;"><\/div>\`;/footerHtml = \`<div style="height: 180px;"><\/div>\`;/g' src/pages/ProjectDetails.tsx
sed -i 's/<div class="content">/<div class="content" style="padding-bottom: 20px;">/g' src/pages/ProjectDetails.tsx
