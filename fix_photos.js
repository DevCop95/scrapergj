const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const normalize = (str) => str.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, ' ').trim();

async function findPhoto(businessName, address) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const queries = [
        `${businessName} ${address} Guadalajara Jalisco`,
        `${businessName} Guadalajara`,
        `${businessName} tacos Guadalajara Jalisco`
    ];

    for (const query of queries) {
        try {
            console.log(`  Trying: "${query}"`);
            await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'load' });

            try {
                await Promise.race([
                    page.waitForSelector('div[role="feed"]', { timeout: 8000 }),
                    page.waitForSelector('h1.DUwDvf', { timeout: 8000 }),
                    page.waitForSelector('h1.fontHeadlineLarge', { timeout: 8000 })
                ]);
            } catch (e) {}

            const feed = page.locator('div[role="feed"]');
            const isList = await feed.isVisible();

            if (isList) {
                const results = page.locator('div[role="article"]');
                const count = await results.count();
                const targetNorm = normalize(businessName);
                const targetWords = targetNorm.split(' ').filter(w => w.length > 2);

                for (let i = 0; i < Math.min(count, 5); i++) {
                    const text = await results.nth(i).innerText();
                    const normalizedText = normalize(text);
                    const matched = targetWords.filter(w => normalizedText.includes(w));
                    const ratio = targetWords.length > 0 ? matched.length / targetWords.length : 0;

                    if (ratio >= 0.5) {
                        const link = results.nth(i).locator('a[href*="/maps/place/"]').first();
                        if (await link.isVisible()) {
                            await link.click();
                            await page.waitForURL(/\/maps\/place\//, { timeout: 10000 }).catch(() => {});
                            await page.waitForTimeout(3000);
                            break;
                        }
                    }
                }
            } else {
                await page.waitForTimeout(3000);
            }

            // Verify name
            const pageTitle = await page.evaluate(() => {
                const h = document.querySelector('h1.DUwDvf') || document.querySelector('h1.fontHeadlineLarge');
                return h ? h.innerText.trim() : '';
            });

            const targetNorm = normalize(businessName);
            const pageNorm = normalize(pageTitle);
            const targetWords = targetNorm.split(' ').filter(w => w.length > 2);
            const matched = targetWords.filter(w => pageNorm.includes(w));
            const ratio = targetWords.length > 0 ? matched.length / targetWords.length : 0;

            if (ratio < 0.4) continue;

            // Extract photo
            const photo = await page.evaluate(() => {
                const img = document.querySelector('button[aria-label^="Foto de"] img') ||
                            document.querySelector('button[aria-label^="Photo of"] img') ||
                            document.querySelector('img[src*="lh3.googleusercontent.com"]') ||
                            document.querySelector('div.Z67Byc img');
                if (!img) return null;
                let src = img.getAttribute('src');
                if (src && src.includes('lh3.googleusercontent.com')) {
                    src = src.replace(/=w\d+-h\d+/, '=w800-h800');
                }
                return src;
            });

            const mapsUrl = page.url();

            if (photo && photo.includes('googleusercontent.com')) {
                // Validate photo URL with HEAD request
                try {
                    const response = await page.evaluate(async (url) => {
                        const res = await fetch(url, { method: 'HEAD' });
                        return res.ok;
                    }, photo);

                    if (response) {
                        console.log(`  ✅ Found photo for: "${pageTitle}" (${Math.round(ratio*100)}%)`);
                        await browser.close();
                        return { photo, mapsUrl: mapsUrl.includes('/place/') ? mapsUrl : null };
                    } else {
                        console.log(`  ⚠️ Photo URL returned ${response} for: "${pageTitle}"`);
                    }
                } catch (e) {
                    console.log(`  ⚠️ Photo validation failed: ${e.message}`);
                }
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }

    await browser.close();
    return null;
}

async function fixAllPhotos() {
    const files = [
        'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv',
        'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv',
        'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv'
    ];

    for (const file of files) {
        const rows = [];
        await new Promise((resolve) => {
            fs.createReadStream(file).pipe(csv()).on('data', (d) => rows.push(d)).on('end', resolve);
        });

        let updated = 0;
        for (const row of rows) {
            if (!row.photo || row.photo === 'N/A') {
                console.log(`\n🔍 ${row['Negocio']} (${row['Dirección']})`);
                const result = await findPhoto(row['Negocio'], row['Dirección']);
                if (result) {
                    row.photo = result.photo;
                    if (result.mapsUrl && (!row['📍 Google Maps'] || row['📍 Google Maps'] === 'N/A')) {
                        row['📍 Google Maps'] = result.mapsUrl;
                        console.log(`  ✅ Maps URL also updated`);
                    }
                    updated++;
                } else {
                    console.log(`  ❌ No verified photo found`);
                }
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        if (updated > 0) {
            const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));
            const writer = createCsvWriter({ path: file, header: headers });
            await writer.writeRecords(rows);
            console.log(`\n✅ Updated ${file} with ${updated} photos`);
        } else {
            console.log(`\nNo updates for ${file}`);
        }
    }
    console.log('\nDone.');
}

fixAllPhotos();
