const puppeteer = require('puppeteer');

async function fixOrinoco() {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    try {
        // Force the search to be VERY specific to Guadalajara
        const query = "Taquería Orinoco Libertad Guadalajara"; 
        console.log(`Searching for: ${query}`);
        const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        // Wait a bit for results
        await new Promise(r => setTimeout(r, 4000));
        await page.screenshot({ path: 'debug_orinoco_fix.png' });

        const results = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
            return links.map(a => ({
                text: a.innerText,
                href: a.href
            })).filter(item => item.text.toLowerCase().includes('guadalajara') || item.text.toLowerCase().includes('libertad'));
        });

        console.log('Filtered Results:', JSON.stringify(results, null, 2));

        if (results.length > 0) {
            console.log('Clicking the best match...');
            await page.goto(results[0].href, { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 3000));
            
            const photo = await page.evaluate(() => {
                const img = document.querySelector('img[src*="googleusercontent.com/p/"]');
                return img ? img.src : 'N/A';
            });
            console.log('FOUND PHOTO:', photo);
        }

        await browser.close();
    } catch (error) {
        console.error('Fix failed:', error);
        await browser.close();
    }
}

fixOrinoco();
