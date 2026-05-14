const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const INPUT_FILES = [
    'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv',
    'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv',
    'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv'
];

async function scrapeReviewCount(mapsUrl, page) {
    try {
        if (!mapsUrl || mapsUrl === 'N/A' || !mapsUrl.includes('/maps/')) {
            return null;
        }

        console.log(`  Opening Maps...`);
        await page.goto(mapsUrl, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(7000); // Wait for Maps dynamic content

        const reviewData = await page.evaluate(() => {
            let reviewCount = 0;

            // Strategy 1: Search full page text for rating pattern "X.X (Y)" where Y is review count
            const bodyText = document.body.innerText;

            // Pattern: "4.7 (1,234)" or "4.7 (1234 reseñas)"
            const ratingPattern = /[\d,\.]+\s*estrellas?\s*\((\d[\d,\.]+)/gi;
            let match = bodyText.match(ratingPattern);
            if (match) {
                const nums = match[0].match(/\((\d[\d,\.]+)/);
                if (nums) {
                    reviewCount = parseInt(nums[1].replace(/[,\.]/g, ''));
                }
            }

            // Pattern: "(1,234 reseñas)" or "(1,234)"
            if (reviewCount === 0) {
                const reviewPatterns = [
                    /\((\d[\d,\.]+)\s*reseñas?\)/gi,
                    /\((\d[\d,\.]+)\s*reviews?\)/gi,
                    /\((\d[\d,\.]+)\)/g
                ];

                for (const pattern of reviewPatterns) {
                    const matches = [...bodyText.matchAll(pattern)];
                    for (const m of matches) {
                        const num = parseInt(m[1].replace(/[,\.]/g, ''));
                        if (!isNaN(num) && num > reviewCount && num >= 10 && num < 1000000) {
                            reviewCount = num;
                        }
                    }
                }
            }

            // Strategy 2: Find elements with aria-labels containing ratings
            if (reviewCount === 0) {
                const allElements = document.querySelectorAll('[aria-label]');
                for (const el of allElements) {
                    const label = el.getAttribute('aria-label') || '';

                    // "4.7 estrellas con 1,234 reseñas"
                    const patterns = [
                        /(\d[\d,\.]+)\s*reseñas?/i,
                        /(\d[\d,\.]+)\s*reviews?/i,
                        /\((\d[\d,\.]+)\)/
                    ];

                    for (const pattern of patterns) {
                        const m = label.match(pattern);
                        if (m) {
                            const num = parseInt(m[1].replace(/[,\.]/g, ''));
                            if (!isNaN(num) && num > reviewCount && num >= 10 && num < 1000000) {
                                reviewCount = num;
                            }
                        }
                    }
                }
            }

            // Get rating too
            let rating = null;
            const ratingSelectors = [
                'div[role="img"][aria-label*="estrella"]',
                'div[role="img"][aria-label*="star"]',
                'span[aria-label*="estrella"]'
            ];

            for (const selector of ratingSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    const ariaLabel = el.getAttribute('aria-label') || '';
                    const match = ariaLabel.match(/([\d,\.]+)\s*estrella/i);
                    if (match) {
                        rating = parseFloat(match[1].replace(',', '.'));
                        break;
                    }
                }
            }

            return { reviewCount, rating };
        });

        return reviewData;
    } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        return null;
    }
}

async function scrapeAllReviews() {
    const browser = await chromium.launch({
        headless: false, // Use headed mode to avoid detection
        channel: 'chromium',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage'
        ]
    });

    // Create page pool (3 pages)
    const pool = [];
    for (let i = 0; i < 3; i++) {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'es-MX'
        });

        // Add stealth scripts
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
            await new Promise(r => setTimeout(r, 200));
        }
    }

    function releasePage(pageObj) {
        pageObj.busy = false;
    }

    for (const file of INPUT_FILES) {
        if (!fs.existsSync(file)) {
            console.log(`\n⚠️ Skipping ${file} (not found)`);
            continue;
        }

        console.log(`\n📂 Processing ${file}...`);
        const rows = [];
        await new Promise((resolve) => {
            fs.createReadStream(file)
                .pipe(csv())
                .on('data', (data) => rows.push(data))
                .on('end', resolve);
        });

        let scrapedCount = 0;
        for (const row of rows) {
            const needsScrape = !row.reviewCount || row.reviewCount === '0';

            if (needsScrape && row['📍 Google Maps'] && row['📍 Google Maps'] !== 'N/A') {
                console.log(`\n🔍 ${row['Negocio']}`);

                const pageObj = await getFreePage();
                const data = await scrapeReviewCount(row['📍 Google Maps'], pageObj.page);
                releasePage(pageObj);

                if (data && data.reviewCount > 0) {
                    row.reviewCount = data.reviewCount.toString();
                    console.log(`  ✅ ${data.reviewCount.toLocaleString()} reviews`);
                    scrapedCount++;
                } else {
                    row.reviewCount = row.reviewCount || '0';
                    console.log(`  ⚠️ No review count found`);
                }

                await new Promise(r => setTimeout(r, 2000));
            } else if (!row.reviewCount) {
                row.reviewCount = '0';
            }
        }

        // Sort by reviewCount
        rows.sort((a, b) => {
            const aReviews = parseInt(a.reviewCount || 0);
            const bReviews = parseInt(b.reviewCount || 0);
            if (bReviews !== aReviews) return bReviews - aReviews;
            return parseFloat(b['⭐'] || 0) - parseFloat(a['⭐'] || 0);
        });

        // Mark top 10
        rows.forEach((row, i) => {
            row.isTop10 = i < 10 ? 'true' : 'false';
        });

        console.log(`\n🏆 Top 10 by review count:`);
        rows.slice(0, 10).forEach((row, i) => {
            const reviews = parseInt(row.reviewCount || 0);
            console.log(`${i + 1}. ${row['Negocio']}: ${reviews.toLocaleString()} reviews - ⭐${row['⭐']}`);
        });

        // Write back
        if (rows.length > 0) {
            const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));
            const csvWriter = createCsvWriter({
                path: file,
                header: headers
            });
            await csvWriter.writeRecords(rows);
            console.log(`\n✅ Updated ${file} (${scrapedCount} new review counts)`);
        }
    }

    await browser.close();
    console.log('\n✅ All reviews scraped.');
}

scrapeAllReviews();
