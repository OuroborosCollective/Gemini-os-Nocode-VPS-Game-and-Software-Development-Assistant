import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Client } from 'ssh2';
import { Octokit } from 'octokit';
import path from 'path';
import fs from 'fs/promises';

const __dirname = process.cwd();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const SKILLS_FILE = path.join(__dirname, 'learned_skills.json');
  const SSH_KEYS_FILE = path.join(__dirname, 'ssh_keys.json');

  // Initialize files if not exists
  try {
    await fs.access(SKILLS_FILE);
  } catch {
    await fs.writeFile(SKILLS_FILE, JSON.stringify([]));
  }

  try {
    await fs.access(SSH_KEYS_FILE);
  } catch {
    await fs.writeFile(SSH_KEYS_FILE, JSON.stringify([]));
  }

  // Store connections and installer state in memory
  const vpsConnections = new Map<string, { client: Client; config: any }>();
  const githubClients = new Map<string, Octokit>();
  let installerState = { status: 'idle', logs: '', lastRun: null as string | null };

  // --- SSH API ---
  app.get('/api/ssh/installer', (req, res) => {
    res.json(installerState);
  });

  app.post('/api/ssh/connect', (req, res) => {
    const { host, port, username, password, privateKey } = req.body;
    const conn = new Client();
    
    conn.on('ready', () => {
      vpsConnections.set('default', { client: conn, config: { host, port, username } });
      res.json({ status: 'connected', host });
    }).on('error', (err) => {
      res.status(500).json({ error: err.message });
    }).connect({
      host,
      port: port || 22,
      username,
      password,
      privateKey,
      readyTimeout: 15000
    });
  });

  app.get('/api/ssh/keys', async (req, res) => {
    try {
      const data = await fs.readFile(SSH_KEYS_FILE, 'utf-8');
      res.json(JSON.parse(data));
    } catch (err) {
      res.status(500).json({ error: 'Failed to read keys' });
    }
  });

  app.post('/api/ssh/keys', async (req, res) => {
    try {
      const { name, key } = req.body;
      const data = await fs.readFile(SSH_KEYS_FILE, 'utf-8');
      const keys = JSON.parse(data);
      const newKey = { id: Date.now().toString(), name, key, isDefault: keys.length === 0 };
      keys.push(newKey);
      await fs.writeFile(SSH_KEYS_FILE, JSON.stringify(keys, null, 2));
      res.json(newKey);
    } catch (err) {
      res.status(500).json({ error: 'Failed to save key' });
    }
  });

  app.delete('/api/ssh/keys/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const data = await fs.readFile(SSH_KEYS_FILE, 'utf-8');
      let keys = JSON.parse(data);
      keys = keys.filter((k: any) => k.id !== id);
      await fs.writeFile(SSH_KEYS_FILE, JSON.stringify(keys, null, 2));
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete key' });
    }
  });

  app.post('/api/ssh/keys/default', async (req, res) => {
    try {
      const { id } = req.body;
      const data = await fs.readFile(SSH_KEYS_FILE, 'utf-8');
      let keys = JSON.parse(data);
      keys = keys.map((k: any) => ({ ...k, isDefault: k.id === id }));
      await fs.writeFile(SSH_KEYS_FILE, JSON.stringify(keys, null, 2));
      res.json({ status: 'updated' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update default key' });
    }
  });

  app.post('/api/ssh/exec', (req, res) => {
    const { command } = req.body;
    const conn = vpsConnections.get('default')?.client;

    if (!conn) {
      return res.status(400).json({ error: 'No VPS connected' });
    }

    conn.exec(command, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      
      let out = '';
      let errorOut = '';
      stream.on('close', (code: number, signal: string) => {
        res.json({ code, signal, stdout: out, stderr: errorOut });
      }).on('data', (data: any) => {
        out += data.toString();
      }).stderr.on('data', (data: any) => {
        errorOut += data.toString();
      });
    });
  });

  app.post('/api/ssh/verify', (req, res) => {
    const conn = vpsConnections.get('default')?.client;
    if (!conn) return res.status(400).json({ error: 'No VPS connected' });

    const verifyScript = `
      echo "--- VERSION CHECK ---"
      node -v || echo "Node: Missing"
      python3 --version || echo "Python: Missing"
      go version || echo "Go: Missing"
      java -version 2>&1 | head -n 1 || echo "Java: Missing"
      php -v | head -n 1 || echo "PHP: Missing"
      rustc --version || echo "Rust: Missing"
      g++ --version | head -n 1 || echo "C++: Missing"
      git --version || echo "Git: Missing"
      echo "--- END ---"
    `;

    conn.exec(verifyScript, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      let out = '';
      stream.on('close', () => res.json({ report: out }))
            .on('data', (d) => out += d.toString())
            .stderr.on('data', (d) => out += d.toString());
    });
  });

  // --- VPS OS Installer ---
  app.post('/api/ssh/install-os', (req, res) => {
    const conn = vpsConnections.get('default')?.client;
    if (!conn) return res.status(400).json({ error: 'No VPS connected' });

    installerState = { status: 'running', logs: '', lastRun: new Date().toISOString() };

    const installScript = `
      export DEBIAN_FRONTEND=noninteractive
      sudo apt-get update -y
      sudo apt-get install -y curl git build-essential python3 python3-pip python3-venv golang-go openjdk-17-jdk php-cli rustc g++
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
      mkdir -p ~/.gemini/skills
      mkdir -p ~/.gemini/tools
      echo "Gemini OS VPS Agent & Polyglot Stack (Node, Py, Go, Java, PHP, Rust, C++) Installed" > ~/.gemini_os_installed
    `;

    conn.exec(installScript, (err, stream) => {
      if (err) {
        installerState.status = 'failed';
        installerState.logs += `\nError initiating: ${err.message}`;
        return res.status(500).json({ error: err.message });
      }
      
      stream.on('close', (code: number) => {
        installerState.status = code === 0 ? 'completed' : 'failed';
        installerState.logs += `\nProcess finished with code ${code}`;
      }).on('data', (data: any) => {
        installerState.logs += data.toString();
      }).stderr.on('data', (d: any) => {
        installerState.logs += d.toString();
      });

      res.json({ status: 'Installation started' });
    });
  });

  // --- Deep/Global Scan ---
  app.post('/api/ssh/deep-scan', (req, res) => {
    const { path: scanPath } = req.body;
    const conn = vpsConnections.get('default')?.client;
    if (!conn) return res.status(400).json({ error: 'No VPS connected' });

    const scanScript = `
      echo "--- SCAN START ---"
      echo "PATH: ${scanPath || '/'}"
      echo "--- FILES ---"
      find "${scanPath || '.'}" -maxdepth 2 -not -path '*/.*' | sed 's|^./||'
      echo "--- PKGS ---"
      find "${scanPath || '.'}" -maxdepth 2 -name "package.json" -o -name "requirements.txt" -o -name "go.mod"
      echo "--- END ---"
    `;

    conn.exec(scanScript, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      let out = '';
      stream.on('close', () => res.json({ report: out }))
            .on('data', (d) => out += d.toString())
            .stderr.on('data', (d) => out += d.toString());
    });
  });

  app.post('/api/ssh/global-scan', (req, res) => {
    const conn = vpsConnections.get('default')?.client;
    if (!conn) return res.status(400).json({ error: 'No VPS connected' });

    const globalScanScript = `
      echo "--- GLOBAL INTELLIGENCE SCAN ---"
      echo "Searching for AI Skills/Tools..."
      find ~ /var/www -name "learned_skills.json" -o -name "*.py" -o -path "*/.gemini/skills/*" 2>/dev/null | grep -v "node_modules" | head -n 50
      echo "--- END ---"
    `;

    conn.exec(globalScanScript, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      let out = '';
      stream.on('close', () => res.json({ report: out }))
            .on('data', (d) => out += d.toString())
            .stderr.on('data', (d) => out += d.toString());
    });
  });

  // --- GitHub API ---
  app.post('/api/github/connect', (req, res) => {
    const { token } = req.body;
    try {
      const octokit = new Octokit({ auth: token });
      githubClients.set('default', octokit);
      res.json({ status: 'connected' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/github/repos', async (req, res) => {
    const octokit = githubClients.get('default');
    if (!octokit) return res.status(400).json({ error: 'GitHub not connected' });

    try {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- VPS File API ---
  app.get('/api/ssh/file', async (req, res) => {
    const { path: filePath } = req.query;
    const conn = vpsConnections.get('default')?.client;
    if (!conn || !filePath) return res.status(400).json({ error: 'Missing connection or path' });

    conn.exec(`cat "${filePath}"`, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      let out = '';
      stream.on('close', () => res.json({ content: out }))
            .on('data', (d) => out += d.toString());
    });
  });

  app.post('/api/ssh/file', async (req, res) => {
    const { path: filePath, content } = req.body;
    const conn = vpsConnections.get('default')?.client;
    if (!conn || !filePath) return res.status(400).json({ error: 'Missing connection or path' });

    conn.exec(`cat > "${filePath}" <<'GEMINI_EOF'\n${content}\nGEMINI_EOF`, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      stream.on('close', () => res.json({ status: 'success' }));
    });
  });

  // --- Learn Skill API ---
  app.get('/api/skills', async (req, res) => {
    try {
      const data = await fs.readFile(SKILLS_FILE, 'utf-8');
      res.json(JSON.parse(data));
    } catch (e) {
      res.json([]);
    }
  });

  app.post('/api/skills', async (req, res) => {
    const { name, content } = req.body;
    try {
      const data = JSON.parse(await fs.readFile(SKILLS_FILE, 'utf-8'));
      data.push({ name, content, learnedAt: new Date().toISOString() });
      await fs.writeFile(SKILLS_FILE, JSON.stringify(data, null, 2));
      res.json({ status: 'Skill learned successfully' });
    } catch (e) {
      res.status(500).json({ error: 'Failed to learn skill' });
    }
  });

  // --- Health API ---
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      vpsConnected: vpsConnections.has('default'),
      githubConnected: githubClients.has('default'),
      timestamp: new Date().toISOString()
    });
  });

  // --- Static/Vite ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
