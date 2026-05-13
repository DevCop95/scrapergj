const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const INPUT_FILES = [
    { path: '-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv' },
    { path: '-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv' },
    { path: '-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv', enriched: 'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv' }
];

async function scrapeBusinessDataRobust(businessName, address) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    try {
        // Refine search query
        const refinedQuery = `${businessName} ${address}`.includes('Guadalajara') ? 
            `${businessName} ${address}` : `${businessName} ${address} Guadalajara Jalisco`;
        
        const searchQuery = encodeURIComponent(refinedQuery);
        await page.goto(`https://www.google.com/maps/search/${searchQuery}`, { waitUntil: 'networkidle2' });

        // Check if we are in a results list or direct profile
        const isList = await page.evaluate(() => {
            return !!document.querySelector('div[role="feed"]');
        });

        if (isList) {
            // Click the first result
            await page.click('a[href*="/maps/place/"]');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }

        const data = await page.evaluate(() => {
            const getText = (selector) => document.querySelector(selector)?.innerText || 'N/A';
            const getHref = (selector) => document.querySelector(selector)?.getAttribute('href') || 'N/A';
            
            // Multiple photo selectors
            const photoImg = document.querySelector('button[aria-label^="Foto de"] img') || 
                             document.querySelector('img[src*="lh3.googleusercontent.com"]') ||
                             document.querySelector('img[src*="streetviewpixels"]');
            
            const photo = photoImg ? photoImg.getAttribute('src') : 'N/A';

            return {
                phone: getText('button[data-item-id^="phone:tel:"]'),
                hours: getText('div[aria-label*="Horario"]'),
                website: getHref('a[data-item-id="authority"]'),
                photo: photo,
                plusCode: getText('button[aria-label^="Plus Code"]')
            };
        });

        await browser.close();
        return data;
    } catch (error) {
        console.error(`Error scraping ${businessName}:`, error.message);
        await browser.close();
        return null;
    }
}

async function startRepair() {
    for (const fileInfo of INPUT_FILES) {
        const results = [];
        console.log(`Checking for missing data in ${fileInfo.enriched}...`);

        if (!fs.existsSync(fileInfo.enriched)) {
            console.log(`Enriched file not found, skipping: ${fileInfo.enriched}`);
            continue;
        }

        await new Promise((resolve) => {
            fs.createReadStream(fileInfo.enriched)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', async () => {
                    const repairedData = [];
                    let repairedCount = 0;

                    for (const item of results) {
                        // Only repair if photo is N/A or empty
                        if (!item.photo || item.photo === 'N/A') {
                            console.log(`Retrying image for: ${item['Negocio']}`);
                            const extra = await scrapeBusinessDataRobust(item['Negocio'], item['Dirección']);
                            if (extra && extra.photo !== 'N/A') {
                                console.log(`✅ Found image for: ${item['Negocio']}`);
                                repairedData.push({ ...item, ...extra });
                                repairedCount++;
                            } else {
                                repairedData.push(item);
                            }
                            await new Promise(r => setTimeout(r, 2000));
                        } else {
                            repairedData.push(item);
                        }
                    }

                    if (repairedCount > 0) {
                        const headers = Object.keys(repairedData[0]).map(k => ({ id: k, title: k }));
                        const csvWriter = createCsvWriter({
                            path: fileInfo.enriched, // Overwrite with repaired data
                            header: headers
                        });
                        await csvWriter.writeRecords(repairedData);
                        console.log(`Updated ${fileInfo.enriched} with ${repairedCount} new images.`);
                    } else {
                        console.log(`No new images found for ${fileInfo.enriched}`);
                    }
                    resolve();
                });
        });
    }
    console.log("Repair process completed.");
}

startRepair();
