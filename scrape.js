import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));

  await page.goto("http://localhost:3000/tender-analyzer");
  await page.waitForTimeout(5000);
  const bodyText = await page.evaluate(() => document.body.innerHTML);
  console.log("HTML:", bodyText.substring(0, 500));
  await browser.close();
})();


