const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const MISSING = [
    { name: 'Anita Li', address: 'Av. México 2903, Vallarta Nte', file: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', queries: ['Anita Li tacos Av México 2903 Guadalajara', 'Anita Li restaurante Vallarta Norte Guadalajara', 'Anita Li Guadalajara tacos'] },
    { name: 'Taquería Orinoco', address: 'Av. Libertad 1890, Americana', file: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', queries: ['Taquería Orinoco Libertad Guadalajara', 'Orinoco tacos Americana Guadalajara', 'Taqueria Orinoco Av Libertad 1890'] },
    { name: 'Tacos Los Parados', address: 'Av. Aztecas, Zapopan', file: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', queries: ['Tacos Los Parados Aztecas Zapopan', 'Los Parados tacos Zapopan Jalisco', 'Tacos Los Parados Guadalajara'] },
    { name: 'Tacos Los Migueles', address: 'Av. Patria, Zapopan', file: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', queries: ['Tacos Los Migueles Patria Zapopan', 'Los Migueles tacos Zapopan', 'Tacos Migueles Av Patria Guadalajara'] },
    { name: 'Tacos Los Sauces', address: 'Jardines de la Paz', file: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', queries: ['Tacos Los Sauces Jardines de la Paz Guadalajara', 'Los Sauces tacos Guadalajara Jalisco', 'Tacos Sauces Jardines Paz'] },
    { name: 'Tacos Los Pioneros', address: 'Av. Copérnico, Zapopan', file: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', queries: ['Tacos Los Pioneros Copérnico Zapopan', 'Los Pioneros tacos Zapopan', 'Tacos Pioneros Av Copernico Guadalajara'] },
    { name: 'Tortas Enrique Perro', address: 'Carr. a Tesistán, Zapopan', file: 'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv', queries: ['Tortas Enrique Perro Tesistán Zapopan', 'Enrique Perro tortas ahogadas Zapopan', 'Tortas Enrique Perro Guadalajara'] },
    { name: 'Tortas Los Cuñados', address: 'Av. Patria, Zapopan', file: 'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv', queries: ['Tortas Los Cuñados Patria Zapopan', 'Los Cuñados tortas ahogadas Zapopan', 'Tortas Cuñados Av Patria Guadalajara'] },
    { name: 'Menudería La Estancia (Univa)', address: 'Cerca de Av. Tepeyac', file: 'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv', queries: ['Menudería La Estancia Univa Zapopan', 'La Estancia menudo Tepeyac Zapopan', 'Menuderia Estancia Univa Guadalajara'] },
    { name: 'Menudería San Juan', address: 'Barrio de Analco', file: 'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv', queries: ['Menudería San Juan Analco Guadalajara', 'San Juan menudo Barrio Analco', 'Menuderia San Juan Guadalajara Jalisco'] }
];

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
    for (const biz of MISSING) {
        console.log(`\n🔍 ${biz.name} (${biz.address})`);
        const url = await tryFindBusiness(biz.name, biz.queries);

        if (url) {
            console.log(`  → ${url.substring(0, 80)}...`);
            // Update CSV
            const rows = [];
            await new Promise((resolve) => {
                fs.createReadStream(biz.file).pipe(csv()).on('data', (d) => rows.push(d)).on('end', resolve);
            });

            const idx = rows.findIndex(r => r['Negocio'] === biz.name);
            if (idx !== -1) {
                rows[idx]['📍 Google Maps'] = url;
                const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));
                const writer = createCsvWriter({ path: biz.file, header: headers });
                await writer.writeRecords(rows);
                console.log(`  ✅ CSV updated`);
            }
        } else {
            console.log(`  ❌ Not found - keeping N/A`);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    console.log('\nDone.');
}

fixMissing();
