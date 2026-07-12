const puppeteer = require('puppeteer');
const path = require('path');

async function snapshot() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
  
  console.log('Navigating...');
  await page.goto('https://hackastat.eu/en/player-rapm/', { waitUntil: 'networkidle2', timeout: 120000 });
  
  console.log('Taking screenshot...');
  await page.screenshot({ path: path.join(__dirname, 'rapm_screenshot.png') });
  
  console.log('Dumping HTML...');
  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, 'rapm_page.html'), html);
  
  await browser.close();
  console.log('Done.');
}

snapshot().catch(console.error);
