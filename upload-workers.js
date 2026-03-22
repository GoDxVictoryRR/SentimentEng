const fs = require('fs');
const path = require('path');

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoiZ3VpIiwidiI6IjAuMC4wIiwidSI6ImdCaVpyTEhWUnVpanAvNkRVeXdYTnc9PSIsInV1IjoieFVydERJdmZUeGlGTkxPcWtPK3puQT09IiwiaWF0IjoxNzcyMjEzNjg5fQ.fkd7CPURn3ItT1Wv72_Mc4KdArkr4Aq1xbXkh0QkLt4";

async function uploadFile(localPath, remoteName) {
    console.log(`Uploading ${localPath} to ${remoteName}...`);
    const content = fs.readFileSync(localPath);

    // First, try standard Puter API upload endpoint
    const formData = new FormData();
    formData.append('file', new Blob([content]), remoteName);
    formData.append('path', '/puter-worker');
    formData.append('overwrite', 'true');

    try {
        const res = await fetch('https://api.puter.com/drive/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`
            },
            body: formData
        });

        console.log(`Status for ${remoteName}:`, res.status);
        const text = await res.text();
        console.log('Response:', text);
    } catch (e) {
        console.error('Error uploading', remoteName, e);
    }
}

async function uploadWorkers() {
    const workerDir = path.join(__dirname, 'puter-worker');
    const files = ['manager.js', 'pipeline.js', 'fetcher.js'];

    // First ensure the directory exists 
    try {
        await fetch('https://api.puter.com/drive/mkdir', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: '/puter-worker' })
        });
    } catch (e) { } // ignore if exists

    for (const file of files) {
        await uploadFile(path.join(workerDir, file), file);
    }
}

uploadWorkers();
