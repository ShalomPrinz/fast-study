const http = require('http');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');

const server = http.createServer((req, res) => {
    // Allow the Chrome Extension to talk to this server
    res.setHeader('Access-Control-Allow-Origin', 'chrome-extension://kebkiehjoihdofnobkbifjcihnifibdo');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/download') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const curlCmd = data.command;

                // Basic security check: Make sure it's actually a curl command
                if (!curlCmd || !curlCmd.startsWith('curl')) {
                    res.writeHead(400);
                    res.end('Invalid command');
                    return;
                }

                console.log('\n📥 Received new video from Chrome!');
                console.log(`🚀 Starting download in: ${DOWNLOAD_DIR}`);

                // Execute the cURL command in the background
                // 'cwd' stands for Current Working Directory (forces it to save there)
                exec(curlCmd, { cwd: DOWNLOAD_DIR, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`❌ Download Failed: ${error.message}`);
                        return;
                    }
                    console.log('✅ Download Complete and saved!');
                });

                res.writeHead(200);
                res.end(JSON.stringify({ status: 'Downloading in background...' }));
            } catch (e) {
                res.writeHead(500);
                res.end('Server Error');
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

// Start listening on port 3052
const PORT = 3052;
server.listen(PORT, () => {
    console.log(`\n==========================================`);
    console.log(`🎧 Node Auto-Downloader is actively listening!`);
    console.log(`📁 Saving all videos to: ${DOWNLOAD_DIR}`);
    console.log(`Leave this terminal window open/minimized.`);
    console.log(`==========================================\n`);
});