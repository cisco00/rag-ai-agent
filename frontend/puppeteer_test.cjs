const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        page.on('console', msg => {
            console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
        });
        
        page.on('pageerror', err => {
            console.log('PAGE ERROR:', err.toString());
        });
        
        page.on('error', err => {
            console.log('CRASH ERROR:', err.toString());
        });
        
        console.log("Navigating to http://localhost:5174");
        await page.goto('http://localhost:5174', { waitUntil: 'load' });
        
        console.log("Waiting a bit...");
        await new Promise(r => setTimeout(r, 2000));
        
        await browser.close();
        console.log("Done.");
    } catch(e) {
        console.error("Puppeteer Script Failed:", e);
    }
})();
