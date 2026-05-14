const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const INPUT_FILES = [
    { path: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv' },
    { path: 'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv' },
    { path: 'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv' }
];

async function enrichTopBusiness(mapsUrl, page) {
    try {
        if (!mapsUrl || mapsUrl === 'N/A' || !mapsUrl.includes('/maps/place/')) {
            return null;
        }

        console.log(`  Opening: ${mapsUrl.substring(0, 60)}...`);
        await page.goto(mapsUrl, { waitUntil: 'load', timeout: 15000 });
        await page.waitForTimeout(3000);

        const extraData = await page.evaluate(() => {
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : null;
            };

            // Review count - try multiple selectors
            const reviewSelectors = [
                'button[aria-label*="reseña"]',
                'button[aria-label*="review"]',
                'div[role="img"][aria-label*="estrella"]',
                'button[jsaction*="pane.rating"]',
                'span[aria-label*="estrella"]'
            ];

            let reviewCount = 0;
            let reviewText = null;

            for (const selector of reviewSelectors) {
                reviewText = getText(selector);
                if (reviewText) {
                    // Try different patterns
                    let match = reviewText.match(/(\d[\d,\.]*)\s*(reseñ|review)/i);
                    if (!match) {
                        // Try pattern like "4.7 (1,234)"
                        match = reviewText.match(/\((\d[\d,\.]*)\)/);
                    }
                    if (!match) {
                        // Try pattern like "1,234 reviews"
                        match = reviewText.match(/(\d[\d,\.]*)/);
                    }

                    if (match) {
                        const numStr = match[1].replace(/[,\.]/g, '');
                        const num = parseInt(numStr);
                        if (!isNaN(num) && num > 0) {
                            reviewCount = num;
                            break;
                        }
                    }
                }
            }

            // Fallback: check page text content for review count
            if (reviewCount === 0) {
                const bodyText = document.body.innerText;
                const patterns = [
                    /(\d[\d,\.]+)\s*reseñas/i,
                    /(\d[\d,\.]+)\s*reviews/i,
                    /\((\d[\d,\.]+)\)\s*reseñ/i
                ];
                for (const pattern of patterns) {
                    const match = bodyText.match(pattern);
                    if (match) {
                        const num = parseInt(match[1].replace(/[,\.]/g, ''));
                        if (!isNaN(num) && num > 10) { // at least 10 to be valid
                            reviewCount = num;
                            break;
                        }
                    }
                }
            }

            // Full hours
            const hoursButton = document.querySelector('button[data-item-id^="oh:"]');
            let fullHours = 'N/A';
            if (hoursButton) {
                const table = document.querySelector('table[aria-label*="Horario"]') ||
                             document.querySelector('table[aria-label*="Hours"]');
                if (table) {
                    const rows = Array.from(table.querySelectorAll('tr'));
                    fullHours = rows.map(r => {
                        const cells = r.querySelectorAll('td');
                        if (cells.length >= 2) {
                            return `${cells[0].innerText}: ${cells[1].innerText}`;
                        }
                        return '';
                    }).filter(Boolean).join(' | ');
                }
            }

            // Price level ($, $$, $$$)
            const priceLevel = getText('span[aria-label*="Precio"]') ||
                              getText('span[aria-label*="Price"]') ||
                              'N/A';

            // Category/type
            const category = getText('button[jsaction*="category"]') || 'N/A';

            return {
                reviewCount,
                fullHours,
                priceLevel,
                category
            };
        });

        return extraData;
    } catch (error) {
        console.error(`  Error enriching: ${error.message}`);
        return null;
    }
}

async function enrichTop10() {
    const browser = await chromium.launch({
        headless: true,
        channel: 'chromium'
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const fileInfo of INPUT_FILES) {
        if (!fs.existsSync(fileInfo.path)) {
            console.log(`\n⚠️ Skipping ${fileInfo.path} (not found)`);
            continue;
        }

        console.log(`\n📂 Processing ${fileInfo.path}...`);
        const rows = [];
        await new Promise((resolve) => {
            fs.createReadStream(fileInfo.path)
                .pipe(csv())
                .on('data', (data) => rows.push(data))
                .on('end', resolve);
        });

        // Sort by reviewCount (most reviews = most clients), then by rating
        rows.sort((a, b) => {
            const aReviews = parseInt(a['reviewCount'] || 0);
            const bReviews = parseInt(b['reviewCount'] || 0);
            if (bReviews !== aReviews) return bReviews - aReviews;
            return parseFloat(b['⭐'] || 0) - parseFloat(a['⭐'] || 0);
        });
        const top10 = rows.slice(0, 10);

        console.log(`\n🏆 Top 10 businesses by review count (most clients):`);
        top10.forEach((row, i) => {
            const reviews = parseInt(row['reviewCount'] || 0);
            console.log(`${i + 1}. ${row['Negocio']} - ${reviews.toLocaleString()} reviews - ⭐${row['⭐']}`);
        });

        let enrichedCount = 0;
        for (const row of top10) {
            const needsEnrich = !row.reviewCount || row.reviewCount === '0' || !row.fullHours;
            if (needsEnrich) {
                console.log(`\n🔍 Enriching: ${row['Negocio']}`);
                const extra = await enrichTopBusiness(row['📍 Google Maps'], page);

                if (extra) {
                    row.reviewCount = extra.reviewCount || row.reviewCount || '0';
                    row.fullHours = extra.fullHours || row.fullHours || 'N/A';
                    row.priceLevel = extra.priceLevel || row.priceLevel || 'N/A';
                    row.category = extra.category || row.category || 'N/A';
                    row.isTop10 = 'true'; // Mark as top 10
                    console.log(`  ✅ Reviews: ${extra.reviewCount}`);
                    enrichedCount++;
                } else {
                    row.isTop10 = 'true'; // Mark even if enrichment failed
                }
                await new Promise(r => setTimeout(r, 2000));
            } else {
                row.isTop10 = 'true';
            }
        }

        // Update CSV with new fields
        if (rows.length > 0) {
            // Add new columns if they don't exist
            const firstRow = rows[0];
            if (!firstRow.reviewCount) firstRow.reviewCount = '0';
            if (!firstRow.fullHours) firstRow.fullHours = 'N/A';
            if (!firstRow.priceLevel) firstRow.priceLevel = 'N/A';
            if (!firstRow.category) firstRow.category = 'N/A';
            if (!firstRow.isTop10) firstRow.isTop10 = 'false';

            // Fill missing values for non-top10
            rows.forEach(row => {
                if (!row.isTop10 || row.isTop10 === 'false') {
                    row.reviewCount = row.reviewCount || '0';
                    row.fullHours = row.fullHours || 'N/A';
                    row.priceLevel = row.priceLevel || 'N/A';
                    row.category = row.category || 'N/A';
                    row.isTop10 = 'false';
                }
            });

            const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));
            const csvWriter = createCsvWriter({
                path: fileInfo.path,
                header: headers
            });
            await csvWriter.writeRecords(rows);
            console.log(`\n✅ Updated ${fileInfo.path} (${enrichedCount} top 10 enriched)`);
        }
    }

    await browser.close();
    console.log('\n✅ Top 10 enrichment complete.');
}

if (require.main === module) {
    enrichTop10();
}

module.exports = { enrichTopBusiness };
