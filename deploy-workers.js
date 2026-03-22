const fs = require('fs');
const path = require('path');

const TOKEN = fs.readFileSync(
    path.join(process.env.APPDATA, 'puter-cli-nodejs', 'Config', 'config.json'), 'utf8'
);
const config = JSON.parse(TOKEN);
const token = config.profiles[0].token;

async function uploadFile(localPath, remotePath) {
    const content = fs.readFileSync(localPath);
    const fileName = path.basename(remotePath);
    const dirPath = '/' + path.dirname(remotePath).replace(/\\/g, '/');

    console.log(`Uploading ${fileName} to ${dirPath}...`);

    // Use the batch write endpoint with proper JSON content
    const body = JSON.stringify({
        op: 'write',
        path: dirPath + '/' + fileName,
        dedupe_name: false,
        overwrite: true,
    });

    // Try direct write first
    try {
        const boundary = '----PuterUpload' + Date.now();
        const disposition = `form-data; name="file"; filename="${fileName}"`;

        // Build multipart body manually
        let multipart = '';
        multipart += `--${boundary}\r\n`;
        multipart += `Content-Disposition: form-data; name="operation"\r\n\r\n`;
        multipart += `write\r\n`;
        multipart += `--${boundary}\r\n`;
        multipart += `Content-Disposition: form-data; name="path"\r\n\r\n`;
        multipart += `${dirPath}\r\n`;
        multipart += `--${boundary}\r\n`;
        multipart += `Content-Disposition: form-data; name="overwrite"\r\n\r\n`;
        multipart += `true\r\n`;
        multipart += `--${boundary}\r\n`;
        multipart += `Content-Disposition: form-data; name="dedupe_name"\r\n\r\n`;
        multipart += `false\r\n`;
        multipart += `--${boundary}\r\n`;
        multipart += `Content-Disposition: ${disposition}\r\n`;
        multipart += `Content-Type: application/javascript\r\n\r\n`;

        const bodyStart = Buffer.from(multipart, 'utf-8');
        const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
        const fullBody = Buffer.concat([bodyStart, content, bodyEnd]);

        const res = await fetch('https://api.puter.com/batch', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: fullBody,
        });

        const text = await res.text();
        console.log(`  Status: ${res.status}`);
        console.log(`  Response: ${text.slice(0, 300)}`);
        return res.ok;
    } catch (e) {
        console.error(`  Error: ${e.message}`);
        return false;
    }
}

async function main() {
    const workerDir = path.join(__dirname, 'puter-worker');
    const files = ['manager.js', 'fetcher.js', 'pipeline.js'];

    for (const f of files) {
        const ok = await uploadFile(path.join(workerDir, f), `puter-worker/${f}`);
        if (!ok) {
            console.log(`  Trying alternative endpoint for ${f}...`);
            // Try the simpler write endpoint
            const content = fs.readFileSync(path.join(workerDir, f), 'utf8');
            try {
                const res2 = await fetch('https://api.puter.com/write', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        path: `/puter-worker/${f}`,
                        content: content,
                        overwrite: true,
                        create_missing_parents: true,
                    }),
                });
                console.log(`  Alt status: ${res2.status} ${await res2.text()}`);
            } catch (e2) {
                console.error(`  Alt error: ${e2.message}`);
            }
        }
    }
}

main().catch(console.error);
