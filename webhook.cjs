const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

const SECRET = process.env.WEBHOOK_SECRET || 'change-me-please';
const PORT = process.env.PORT || 9000;
const PROJECT_DIR = '/Users/seunghyeonmaegmini/classroom-tools';

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const sig = req.headers['x-hub-signature-256'];
    const hmac = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

    if (sig !== hmac) {
      res.writeHead(401);
      return res.end('Unauthorized');
    }

    let payload;
    try { payload = JSON.parse(body); } catch { payload = {}; }

    if (payload.ref !== 'refs/heads/main') {
      res.writeHead(200);
      return res.end('Ignored (not main branch)');
    }

    res.writeHead(200);
    res.end('Build triggered');

    console.log(`[${new Date().toISOString()}] Push detected — pulling and building...`);
    exec(
      `cd ${PROJECT_DIR} && git pull && npm run build`,
      (err, stdout, stderr) => {
        if (err) {
          console.error('Build failed:', stderr);
        } else {
          console.log('Build success:', stdout.slice(-200));
        }
      },
    );
  });
});

server.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
