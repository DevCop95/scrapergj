const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const INPUT_FILES = [
    'enriched_-Negocio-Direccin--PrecioMXN-Especialidad-GoogleMa.csv',
    'enriched_-Negocio-Direccin--PrecioMXN-Observaciones-GoogleM.csv',
    'enriched_-Negocio-Direccin--PrecioMXN-Perfildecliente-Googl.csv'
];

async function extractReviewCounts() {
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

        let extracted = 0;
        for (const row of rows) {
            const detail = row['📝 Especialidad'] || row['📝 Observaciones'] || row['📝 Perfil de cliente'] || '';

            // Extract review count from detail field
            const patterns = [
                /(\d[\d,\.]+)[+\s]*(reseñ|votos|review|opiniones)/gi,
                /más\s+de\s+(\d[\d,\.]+)/gi,
                /(\d[\d,\.]+)\s*\+/g
            ];

            let maxReviews = 0;
            for (const pattern of patterns) {
                const matches = detail.matchAll(pattern);
                for (const match of matches) {
                    const numStr = match[1].replace(/[,\.]/g, '');
                    const num = parseInt(numStr);
                    if (!isNaN(num) && num > maxReviews && num < 1000000) { // sanity check
                        maxReviews = num;
                    }
                }
            }

            // Update if found and not already set
            if (maxReviews > 0 && (!row.reviewCount || row.reviewCount === '0')) {
                row.reviewCount = maxReviews.toString();
                console.log(`  ✅ ${row['Negocio']}: ${maxReviews.toLocaleString()} reviews`);
                extracted++;
            } else if (!row.reviewCount) {
                row.reviewCount = '0';
            }
        }

        // Sort by reviewCount (most reviews first), then rating
        rows.sort((a, b) => {
            const aReviews = parseInt(a.reviewCount || 0);
            const bReviews = parseInt(b.reviewCount || 0);
            if (bReviews !== aReviews) return bReviews - aReviews;
            return parseFloat(b['⭐'] || 0) - parseFloat(a['⭐'] || 0);
        });

        // Mark top 10 by reviewCount
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
            console.log(`\n✅ Updated ${file} (${extracted} review counts extracted)`);
        }
    }

    console.log('\n✅ Review extraction complete.');
}

extractReviewCounts();
