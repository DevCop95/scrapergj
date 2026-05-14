const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const INPUT_FILES = [
    { path: '-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv' },
    { path: '-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv' },
    { path: '-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv' }
];

async function scrapeBusinessDataPlaywright(businessName, address, page) {
    
    try {
        const normalize = (str) => str.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, ' ').trim();

        const targetNorm = normalize(businessName);
        const targetWords = targetNorm.split(' ').filter(w => w.length > 2);

        async function performSearch(query) {
            console.log(`Searching for: ${query}`);
            const searchQuery = encodeURIComponent(query);
            await page.goto(`https://www.google.com/maps/search/${searchQuery}`, { waitUntil: 'load' });

            const searchInstead = page.locator('button:has-text("Search instead for")');
            if (await searchInstead.isVisible()) {
                await searchInstead.click();
                await page.waitForLoadState('networkidle');
            }

            try {
                await Promise.race([
                    page.waitForSelector('div[role="feed"]', { timeout: 5000 }),
                    page.waitForSelector('h1.DUwDvf, h1.fontHeadlineLarge', { timeout: 5000 })
                ]);
            } catch (e) {}

            const feed = page.locator('div[role="feed"]');
            if (await feed.isVisible()) {
                const results = page.locator('div[role="article"] a[href*="/maps/place/"]');
                const count = await results.count();
                
                let bestMatchIndex = -1;
                let bestScore = 0;

                for (let i = 0; i < Math.min(count, 10); i++) {
                    const text = await results.nth(i).innerText();
                    const normalizedText = normalize(text);

                    let score = 0;
                    for (const word of targetWords) {
                        if (normalizedText.includes(word)) score += 5;
                    }
                    
                    if (normalizedText === targetNorm || normalizedText.includes(targetNorm)) score += 10;
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatchIndex = i;
                    }
                }

                if (bestMatchIndex !== -1 && bestScore >= 5) {
                    await results.nth(bestMatchIndex).click();
                    await page.waitForURL(/\/maps\/place\//, { timeout: 10000 }).catch(() => {});
                }
            }
            
            await page.waitForTimeout(2000);
            const currentTitle = await page.evaluate(() => {
                const h1 = document.querySelector('h1.DUwDvf') || document.querySelector('h1.fontHeadlineLarge');
                return h1 ? h1.innerText.trim() : '';
            });
            
            const currentNorm = normalize(currentTitle);
            const matchedWords = targetWords.filter(w => currentNorm.includes(w));
            const matchRatio = targetWords.length > 0 ? matchedWords.length / targetWords.length : 0;

            // Levenshtein distance for short names
            const levenshtein = (a, b) => {
                const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
                for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
                for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
                for (let j = 1; j <= b.length; j++) {
                    for (let i = 1; i <= a.length; i++) {
                        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                        matrix[j][i] = Math.min(
                            matrix[j][i - 1] + 1,
                            matrix[j - 1][i] + 1,
                            matrix[j - 1][i - 1] + cost
                        );
                    }
                }
                return matrix[b.length][a.length];
            };

            const distance = levenshtein(targetNorm, currentNorm);
            const maxLen = Math.max(targetNorm.length, currentNorm.length);
            const similarity = 1 - distance / maxLen;

            // Match if: high word overlap OR high similarity OR exact substring match
            const matched = matchRatio >= 0.6 || similarity >= 0.75 ||
                           targetNorm.includes(currentNorm) || currentNorm.includes(targetNorm);

            return { title: currentTitle, matchRatio, matched };
        }

        const refinedQuery = `${businessName} ${address}`.toLowerCase().includes('guadalajara') ? 
            `${businessName} ${address}` : `${businessName} ${address} Guadalajara`;
        
        let searchResult = await performSearch(refinedQuery);

        if (!searchResult.matched) {
            console.log(`  ⚠️ Name mismatch with address search. Trying name-only search...`);
            searchResult = await performSearch(`${businessName} Guadalajara Jalisco`);
        }

        if (!searchResult.matched) {
            console.log(`  ⚠️ SKIP: "${searchResult.title}" doesn't match "${businessName}"`);
            return null;
        }

        console.log(`  ✓ Verified: "${searchResult.title}"`);

        const data = await page.evaluate(() => {
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : 'N/A';
            };
            const getHref = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.getAttribute('href') : 'N/A';
            };

            // Extract rating (stars)
            const ratingElement = document.querySelector('span[role="img"][aria-label*="estrella"]') ||
                                 document.querySelector('span[role="img"][aria-label*="star"]') ||
                                 document.querySelector('div[role="img"][aria-label*="estrella"]');
            let stars = 'N/A';
            if (ratingElement) {
                const ariaLabel = ratingElement.getAttribute('aria-label');
                const match = ariaLabel.match(/([\d,\.]+)\s*estrella/i);
                if (match) stars = match[1].replace(',', '.');
            }

            // Extract review count
            const reviewButton = document.querySelector('button[jsaction*="pane.rating"]') ||
                                document.querySelector('button[aria-label*="reseñ"]') ||
                                document.querySelector('button[aria-label*="review"]');
            let reviewCount = 0;
            if (reviewButton) {
                const text = reviewButton.innerText || reviewButton.getAttribute('aria-label') || '';
                const match = text.match(/\((\d[\d,\.]+)\)/);
                if (match) reviewCount = parseInt(match[1].replace(/[,\.]/g, ''));
            }

            const phone = getText('button[data-item-id^="phone:tel:"]') ||
                          getText('button[aria-label^="Teléfono"]') ||
                          getText('button[aria-label*="phone"]') ||
                          getText('div[data-tooltip="Copiar el número de teléfono"]');

            const website = getHref('a[data-item-id="authority"]') ||
                            getHref('a[aria-label^="Sitio web"]') ||
                            getHref('a[aria-label*="website"]');

            const hours = getText('div[aria-label*="Horario"]') ||
                          getText('div[aria-label*="Hours"]') ||
                          getText('button[data-item-id^="oh:"]');

            const photoImg = document.querySelector('button[aria-label^="Foto de"] img') ||
                             document.querySelector('button[aria-label^="Photo of"] img') ||
                             document.querySelector('img[src*="lh3.googleusercontent.com"]') ||
                             document.querySelector('img[src*="streetviewpixels"]') ||
                             document.querySelector('div.Z67Byc img');

            let photo = 'N/A';
            if (photoImg) {
                photo = photoImg.getAttribute('src');
                if (photo && photo.includes('lh3.googleusercontent.com')) {
                    photo = photo.replace(/=w\d+-h\d+/, '=w1000-h1000');
                }
            }

            return {
                mapsUrl: window.location.href,
                phone: phone,
                hours: hours,
                website: website,
                photo: photo,
                plusCode: getText('button[aria-label^="Plus Code"]'),
                stars: stars,
                reviewCount: reviewCount.toString()
            };
        });

        return data;
    } catch (error) {
        console.error(`Error scraping ${businessName}:`, error.message);
        return null;
    }
}

async function startRepair() {
    // Create browser pool (5 pages)
    const browser = await chromium.launch({
        headless: true,
        channel: 'chromium',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage'
        ]
    });
    const pool = [];
    for (let i = 0; i < 5; i++) {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'es-MX'
        });

        // Anti-detection stealth
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {} };
        });

        const page = await context.newPage();
        pool.push({ page, busy: false });
    }

    async function getFreePage() {
        while (true) {
            const freePage = pool.find(p => !p.busy);
            if (freePage) {
                freePage.busy = true;
                return freePage;
            }
            await new Promise(r => setTimeout(r, 100));
        }
    }

    function releasePage(pageObj) {
        pageObj.busy = false;
    }

    for (const fileInfo of INPUT_FILES) {
        const results = [];
        console.log(`Checking for missing data in ${fileInfo.enriched}...`);

        if (!fs.existsSync(fileInfo.enriched)) {
            console.log(`Enriched file not found, skipping: ${fileInfo.enriched}`);
            continue;
        }

        const dataRows = [];
        await new Promise((resolve) => {
            fs.createReadStream(fileInfo.enriched)
                .pipe(csv())
                .on('data', (data) => dataRows.push(data))
                .on('end', resolve);
        });

        const repairedData = [];
        let repairedCount = 0;

        for (const item of dataRows) {
            const needsPhoto = !item.photo || item.photo === 'N/A';
            const needsMapsUrl = !item['📍 Google Maps'] || item['📍 Google Maps'] === 'N/A'; 

            if (needsPhoto || needsMapsUrl) {
                console.log(`Enriching: ${item['Negocio']}`);
                const pageObj = await getFreePage();
                const extra = await scrapeBusinessDataPlaywright(item['Negocio'], item['Dirección'], pageObj.page);
                releasePage(pageObj);

                if (extra) {
                    const updated = { ...item };
                    if (extra.photo && extra.photo !== 'N/A') updated.photo = extra.photo;
                    if (extra.mapsUrl) {
                        updated['📍 Google Maps'] = extra.mapsUrl;
                        console.log(`  ✅ Maps URL verified`);
                    }
                    if (extra.phone && extra.phone !== 'N/A') updated.phone = extra.phone;
                    if (extra.website && extra.website !== 'N/A') updated.website = extra.website;
                    if (extra.hours && extra.hours !== 'N/A') updated.hours = extra.hours;

                    repairedData.push(updated);
                    repairedCount++;
                } else {
                    // Verification failed - keep existing data (might be transient failure)
                    console.log(`  ⚠️ Verification failed for: ${item['Negocio']} - keeping existing data`);
                    repairedData.push(item);
                }
                await new Promise(r => setTimeout(r, 1000));
            } else {
                repairedData.push(item);
            }
        }

        if (repairedCount > 0) {
            const headers = Object.keys(repairedData[0]).map(k => ({ id: k, title: k }));
            const csvWriter = createCsvWriter({
                path: fileInfo.enriched,
                header: headers
            });
            await csvWriter.writeRecords(repairedData);
            console.log(`Updated ${fileInfo.enriched} with ${repairedCount} new entries.`);
        } else {
            console.log(`No new data found for ${fileInfo.enriched}`);
        }
    }

    // Clean up browser pool
    await browser.close();
    console.log("Repair process completed.");
}

if (require.main === module) {
    startRepair();
}

module.exports = { scrapeBusinessDataPlaywright };
