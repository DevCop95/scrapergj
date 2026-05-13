const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const INPUT_FILES = [
    'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv',
    'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv',
    'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv'
];

function generateQueries(name, address) {
    const queries = [];
    const addressParts = address.split(',').map(s => s.trim());
    const mainStreet = addressParts[0] || '';
    const neighborhood = addressParts[1] || '';

    // Basic patterns
    queries.push(`${name} ${address} Guadalajara`);
    queries.push(`${name} ${mainStreet} Guadalajara`);
    if (neighborhood) {
        queries.push(`${name} ${neighborhood} Guadalajara`);
    }

    // City variations (Zapopan if in address, otherwise Guadalajara)
    const city = address.toLowerCase().includes('zapopan') ? 'Zapopan' : 'Guadalajara';
    queries.push(`${name} ${city} Jalisco`);

    // Simplified name + location
    const simpleName = name.replace(/^(Tacos|Tortas|Menudería)\s+/i, '');
    if (simpleName !== name && mainStreet) {
        queries.push(`${simpleName} ${mainStreet} ${city}`);
    }

    return queries;
}

const normalize = (str) => str.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, ' ').trim();

async function tryFindBusiness(businessName, queries) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

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

            // Check if direct place (no list)
            const h1 = await page.locator('h1.DUwDvf, h1.fontHeadlineLarge').first();
            const feed = page.locator('div[role="feed"]');
            const isList = await feed.isVisible();

            if (!isList && await h1.isVisible()) {
                // Direct result
                const title = await h1.innerText();
                const targetNorm = normalize(businessName);
                const pageNorm = normalize(title);
                const targetWords = targetNorm.split(' ').filter(w => w.length > 2);
                const matched = targetWords.filter(w => pageNorm.includes(w));
                const ratio = targetWords.length > 0 ? matched.length / targetWords.length : 0;

                if (ratio >= 0.4 || pageNorm.includes(targetNorm) || targetNorm.includes(pageNorm)) {
                    console.log(`  ✅ DIRECT HIT: "${title}" (${Math.round(ratio*100)}%)`);
                    const url = page.url();
                    await browser.close();
                    return url.includes('/place/') ? url : null;
                }
            }

            if (isList) {
                // Check results in list
                const results = page.locator('div[role="article"]');
                const count = await results.count();
                const targetNorm = normalize(businessName);
                const targetWords = targetNorm.split(' ').filter(w => w.length > 2);

                for (let i = 0; i < Math.min(count, 5); i++) {
                    const text = await results.nth(i).innerText();
                    const normalizedText = normalize(text);

                    const matched = targetWords.filter(w => normalizedText.includes(w));
                    const ratio = targetWords.length > 0 ? matched.length / targetWords.length : 0;

                    if (ratio >= 0.5 || normalizedText.includes(targetNorm)) {
                        // Click this one
                        const link = results.nth(i).locator('a[href*="/maps/place/"]').first();
                        if (await link.isVisible()) {
                            await link.click();
                            await page.waitForURL(/\/maps\/place\//, { timeout: 10000 }).catch(() => {});
                            await page.waitForTimeout(2000);

                            // Verify H1
                            const pageTitle = await page.evaluate(() => {
                                const h = document.querySelector('h1.DUwDvf') || document.querySelector('h1.fontHeadlineLarge');
                                return h ? h.innerText.trim() : '';
                            });

                            const pageNorm2 = normalize(pageTitle);
                            const matched2 = targetWords.filter(w => pageNorm2.includes(w));
                            const ratio2 = targetWords.length > 0 ? matched2.length / targetWords.length : 0;

                            if (ratio2 >= 0.4) {
                                console.log(`  ✅ LIST MATCH: "${pageTitle}" (${Math.round(ratio2*100)}%)`);
                                const url = page.url();
                                await browser.close();
                                return url.includes('/place/') ? url : null;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }

    await browser.close();
    return null;
}

async function fixMissing() {
    for (const file of INPUT_FILES) {
        if (!fs.existsSync(file)) {
            console.log(`\n⚠️ Skipping ${file} (not found)`);
            continue;
        }

        console.log(`\n📂 Processing ${file}...`);
        const rows = [];
        await new Promise((resolve) => {
            fs.createReadStream(file).pipe(csv()).on('data', (d) => rows.push(d)).on('end', resolve);
        });

        let updated = 0;
        for (const row of rows) {
            const needsUrl = !row['📍 Google Maps'] || row['📍 Google Maps'] === 'N/A';
            if (!needsUrl) continue;

            const name = row['Negocio'];
            const address = row['Dirección'];
            console.log(`\n🔍 ${name} (${address})`);

            const queries = generateQueries(name, address);
            const url = await tryFindBusiness(name, queries);

            if (url) {
                console.log(`  → ${url.substring(0, 80)}...`);
                row['📍 Google Maps'] = url;
                updated++;
            } else {
                console.log(`  ❌ Not found - keeping N/A`);
            }

            await new Promise(r => setTimeout(r, 1500));
        }

        if (updated > 0) {
            const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));
            const writer = createCsvWriter({ path: file, header: headers });
            await writer.writeRecords(rows);
            console.log(`\n✅ ${file}: updated ${updated} entries`);
        } else {
            console.log(`\n⚪ ${file}: no updates needed`);
        }
    }
    console.log('\n✅ Done.');
}

fixMissing();
