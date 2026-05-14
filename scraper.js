const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

function parseNetscapeCookies(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const cookies = [];
    content.split('\n').forEach(line => {
        if (!line.trim() || line.startsWith('#')) return;
        const parts = line.split('\t');
        if (parts.length < 7) return;

        const domain = parts[0];
        if (!domain.includes('google')) return;

        const name = parts[5];
        const value = parts[6].trim();
        if (!name || !value) return;
        if (name.includes('OSID') || name.startsWith('__Host-')) return;

        const expires = parseInt(parts[4]);
        cookies.push({
            name,
            value,
            domain,
            path: parts[2] || '/',
            expires: expires > 0 ? expires : -1,
            httpOnly: parts[3] === 'TRUE',
            secure: parts[1] === 'TRUE',
            sameSite: 'Lax'
        });
    });
    return cookies;
}

const INPUT_FILES = [
    { path: '-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv' },
    { path: '-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv' },
    { path: '-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv' }
];

async function scrapeBusinessDataPlaywright(businessName, address, page) {
    try {
        const normalize = (str) => str.toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .replace(/\s+/g, ' ').trim();

        const targetNorm = normalize(businessName);
        const targetWords = targetNorm.split(' ').filter(w => w.length >= 2);  // Include 2-char words
        const addressNorm = normalize(address);

        async function performSearch(query) {
            console.log(`  Searching: ${query}`);
            const searchQuery = encodeURIComponent(query);
            await page.goto(`https://www.google.com/maps/search/${searchQuery}`, { waitUntil: 'load' });

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
                    const ariaLabel = await results.nth(i).getAttribute('aria-label') || '';
                    const normalizedText = normalize(ariaLabel);

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

            // Wait for panel to load
            await page.waitForSelector('h1.DUwDvf, h1.fontHeadlineLarge', { state: 'visible', timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(3000);

            // Validate: h1 panel must be the business we want
            let panelData = await page.evaluate(() => {
                const h1 = document.querySelector('h1.DUwDvf') || document.querySelector('h1.fontHeadlineLarge');
                const addressEl = document.querySelector('button[data-item-id="address"]') ||
                                 document.querySelector('button[aria-label*="Dirección"]');
                return {
                    title: h1 ? h1.innerText.trim() : '',
                    panelAddress: addressEl ? addressEl.innerText.trim() : ''
                };
            });

            // If empty title, wait more and retry
            if (!panelData.title) {
                await page.waitForTimeout(3000);
                panelData = await page.evaluate(() => {
                    const h1 = document.querySelector('h1.DUwDvf') || document.querySelector('h1.fontHeadlineLarge');
                    const addressEl = document.querySelector('button[data-item-id="address"]') ||
                                     document.querySelector('button[aria-label*="Dirección"]');
                    return {
                        title: h1 ? h1.innerText.trim() : '',
                        panelAddress: addressEl ? addressEl.innerText.trim() : ''
                    };
                });
            }

            const currentNorm = normalize(panelData.title);
            const matchedWords = targetWords.filter(w => currentNorm.includes(w));
            const matchRatio = targetWords.length > 0 ? matchedWords.length / targetWords.length : 0;

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

            // Address validation: relaxed for vague addresses
            let addressMatch = true;
            if (panelData.panelAddress && address && panelData.panelAddress.length > 10) {
                const panelAddrNorm = normalize(panelData.panelAddress);
                const addrWords = addressNorm.split(' ').filter(w => w.length > 3 && !/guadalajara|jalisco|mexico|zona|colonia|cerca/.test(w));
                const addrMatched = addrWords.filter(w => panelAddrNorm.includes(w));
                if (addrWords.length > 0) {
                    addressMatch = addrMatched.length / addrWords.length >= 0.1;  // 10% threshold
                } else {
                    addressMatch = true;  // No specific address words = accept
                }
            }

            // Match: strong name match OR (decent name + address)
            const strongNameMatch = matchRatio >= 0.7 || similarity >= 0.85;
            const decentNameMatch = matchRatio >= 0.5 || similarity >= 0.7 ||
                                   targetNorm.includes(currentNorm) || currentNorm.includes(targetNorm);
            const matched = strongNameMatch || (decentNameMatch && addressMatch);

            return { title: panelData.title, matchRatio, matched, similarity, addressMatch };
        }

        const refinedQuery = `${businessName} ${address}`.toLowerCase().includes('guadalajara') ?
            `${businessName} ${address}` : `${businessName} ${address} Guadalajara`;

        let searchResult = await performSearch(refinedQuery);

        if (!searchResult.matched) {
            console.log(`  ⚠️ First search failed (name: ${searchResult.similarity.toFixed(2)}, addr: ${searchResult.addressMatch}). Retrying...`);
            searchResult = await performSearch(`${businessName} Guadalajara Jalisco`);
        }

        if (!searchResult.matched) {
            console.log(`  ❌ SKIP: "${searchResult.title}" ≠ "${businessName}" (sim: ${searchResult.similarity.toFixed(2)})`);
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

            // Confirm panel is open by checking h1 exists
            const h1 = document.querySelector('h1.DUwDvf') || document.querySelector('h1.fontHeadlineLarge');
            if (!h1) return null;

            // Rating from aria-label
            const ratingElement = document.querySelector('span[role="img"][aria-label*="estrella"]') ||
                                 document.querySelector('span[role="img"][aria-label*="star"]') ||
                                 document.querySelector('div[role="img"][aria-label*="estrella"]');
            let stars = 'N/A';
            if (ratingElement) {
                const ariaLabel = ratingElement.getAttribute('aria-label');
                const match = ariaLabel.match(/([\d,\.]+)\s*estrella/i);
                if (match) stars = match[1].replace(',', '.');
            }

            // Review count - flexible extraction
            let reviewCount = 0;

            // Strategy 1: Buttons with review-related attributes
            const reviewButton = document.querySelector('button[jsaction*="pane.rating"]') ||
                                document.querySelector('button[aria-label*="reseñ"]') ||
                                document.querySelector('button[aria-label*="review"]');
            if (reviewButton) {
                const text = reviewButton.innerText || reviewButton.getAttribute('aria-label') || '';
                const match = text.match(/(\d[\d,\.]+)\s*(reseñas?|reviews?)?/i);
                if (match) {
                    const num = parseInt(match[1].replace(/[,\.]/g, ''));
                    if (!isNaN(num) && num >= 10) reviewCount = num;
                }
            }

            // Strategy 2: aria-labels with review/opinion counts
            if (reviewCount === 0) {
                const allElements = document.querySelectorAll('[aria-label]');
                for (const el of allElements) {
                    const label = el.getAttribute('aria-label') || '';
                    const m = label.match(/(\d[\d,\.]+)\s*(reseñas?|reviews?|opiniones?)/i);
                    if (m) {
                        const num = parseInt(m[1].replace(/[,\.]/g, ''));
                        if (!isNaN(num) && num > reviewCount && num >= 1 && num < 1000000) {
                            reviewCount = num;
                        }
                    }
                }
            }

            // Strategy 3: Scan full page text
            if (reviewCount === 0) {
                const bodyText = document.body.innerText;
                const patterns = [
                    /(\d[\d,\.]+)\s*reseñas?/gi,
                    /(\d[\d,\.]+)\s*reviews?/gi,
                    /(\d[\d,\.]+)\s*opiniones?/gi
                ];

                for (const pattern of patterns) {
                    const matches = [...bodyText.matchAll(pattern)];
                    for (const m of matches) {
                        const num = parseInt(m[1].replace(/[,\.]/g, ''));
                        if (!isNaN(num) && num > reviewCount && num >= 10 && num < 1000000) {
                            reviewCount = num;
                        }
                    }
                }
            }

            const phone = getText('button[data-item-id^="phone:tel:"]') ||
                          getText('button[aria-label^="Teléfono"]') ||
                          getText('button[aria-label*="phone"]');

            const website = getHref('a[data-item-id="authority"]') ||
                            getHref('a[aria-label^="Sitio web"]') ||
                            getHref('a[aria-label*="website"]');

            const hours = getText('div[aria-label*="Horario"]') ||
                          getText('div[aria-label*="Hours"]') ||
                          getText('button[data-item-id^="oh:"]');

            const photoImg = document.querySelector('button[aria-label^="Foto de"] img') ||
                             document.querySelector('button[aria-label^="Photo of"] img') ||
                             document.querySelector('img[src*="lh3.googleusercontent.com"]');

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

async function startRepair(forceAll = false) {
    const browser = await chromium.launch({
        headless: false,
        channel: 'chromium',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage'
        ]
    });

    // Load Google cookies for authenticated session (bypasses "vista limitada")
    const googleCookies = parseNetscapeCookies('./cookies.txt');
    if (googleCookies.length > 0) {
        console.log(`🍪 Loaded ${googleCookies.length} cookies (authenticated mode)`);
    } else {
        console.log('⚠️ No cookies.txt found - running without auth (limited data)');
    }

    const pool = [];
    for (let i = 0; i < 3; i++) {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'es-MX'
        });

        if (googleCookies.length > 0) {
            await context.addCookies(googleCookies);
        }

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {} };
        });

        const page = await context.newPage();

        // Only block images and tracking - NEVER CSS or JS
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot}', route => route.abort());
        await page.route('**/*{google-analytics,googletagmanager,doubleclick,facebook,twitter}*', route => route.abort());

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
        // Clean page state to prevent data contamination between searches
        pageObj.page.goto('about:blank').catch(() => {});
        pageObj.busy = false;
    }

    for (const fileInfo of INPUT_FILES) {
        console.log(`\n📂 Processing ${fileInfo.enriched}...`);

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
            const needsRepair = forceAll || needsPhoto || needsMapsUrl;

            if (needsRepair) {
                console.log(`\n🔍 ${item['Negocio']}`);
                const pageObj = await getFreePage();
                const extra = await scrapeBusinessDataPlaywright(item['Negocio'], item['Dirección'], pageObj.page);
                releasePage(pageObj);

                if (extra) {
                    const updated = { ...item };
                    if (extra.photo && extra.photo !== 'N/A') updated.photo = extra.photo;
                    if (extra.mapsUrl && extra.mapsUrl.includes('/maps/')) {
                        updated['📍 Google Maps'] = extra.mapsUrl;
                        const isPlace = extra.mapsUrl.includes('/place/');
                        console.log(`  ✅ Maps URL${isPlace ? '' : ' (search)'}`);
                    }
                    if (extra.phone && extra.phone !== 'N/A') updated.phone = extra.phone;
                    if (extra.website && extra.website !== 'N/A') updated.website = extra.website;
                    if (extra.hours && extra.hours !== 'N/A') updated.hours = extra.hours;

                    if (extra.stars && extra.stars !== 'N/A') {
                        updated['⭐'] = extra.stars;
                        console.log(`  ✅ Rating: ${extra.stars}★`);
                    }
                    if (extra.reviewCount && extra.reviewCount !== '0') {
                        updated.reviewCount = extra.reviewCount;
                        console.log(`  ✅ Reviews: ${parseInt(extra.reviewCount).toLocaleString()}`);
                    }

                    repairedData.push(updated);
                    repairedCount++;
                } else {
                    console.log(`  ⚠️ Verification failed - keeping existing data`);
                    repairedData.push(item);
                }
                await new Promise(r => setTimeout(r, 1500));
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
            console.log(`\n✅ Updated ${fileInfo.enriched} (${repairedCount} entries)`);
        } else {
            console.log(`\nNo changes for ${fileInfo.enriched}`);
        }
    }

    await browser.close();
    console.log("\n✅ Repair complete.");
}

if (require.main === module) {
    const forceAll = process.argv.includes('--force');
    startRepair(forceAll);
}

module.exports = { scrapeBusinessDataPlaywright };
