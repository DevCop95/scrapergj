const puppeteer = require('puppeteer');

async function getWorkingPhoto(businessName, address) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    try {
        const query = `${businessName} ${address} Guadalajara Mexico`;
        const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        await page.goto(url, { waitUntil: 'networkidle2' });

        // If list, click first
        const isList = await page.evaluate(() => !!document.querySelector('div[role="feed"]'));
        if (isList) {
            await page.click('a[href*="/maps/place/"]');
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        }

        await new Promise(r => setTimeout(r, 5000));

        const photo = await page.evaluate(() => {
            // Find the main image
            const img = document.querySelector('button[aria-label^="Foto de"] img') || 
                        document.querySelector('img[src*="googleusercontent.com/p/"]') ||
                        document.querySelector('img[src*="streetviewpixels"]');
            return img ? img.src : null;
        });

        await browser.close();
        return photo;
    } catch (e) {
        await browser.close();
        return null;
    }
}

async function run() {
    const orinoco = await getWorkingPhoto('Taquería Orinoco', 'Av. Libertad 1890, Americana');
    const enrique = await getWorkingPhoto('Tortas Enrique Perro', 'Carr. a Tesistán, Zapopan');
    
    console.log('ORINOCO_URL:', orinoco);
    console.log('ENRIQUE_URL:', enrique);
}

run();
