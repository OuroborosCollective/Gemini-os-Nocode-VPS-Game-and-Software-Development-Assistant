import express from "express";
import { Client } from "ssh2";
import { Octokit } from "octokit";
import path from "path";
import fs from "fs/promises";

const __dirname = process.cwd();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const dataDir = process.env.NODE_ENV === "production" ? "/tmp" : __dirname;
  const SKILLS_FILE = path.join(dataDir, "learned_skills.json");
  const SSH_KEYS_FILE = path.join(dataDir, "ssh_keys.json");
  const VPS_CONNECTIONS_FILE = path.join(dataDir, "vps_connections.json");
  const DISCOVERED_PATHS_FILE = path.join(dataDir, "discovered_paths.json");

  // Initialize files if not exists
  const initFile = async (file: string, defaultData: any) => {
    try {
      await fs.access(file);
    } catch {
      try {
        await fs.writeFile(file, JSON.stringify(defaultData));
      } catch (err) {
        console.error(
          `Failed to initialize ${file} (this is normal if storage is read-only):`,
          err,
        );
      }
    }
  };

  await initFile(SKILLS_FILE, []);
  await initFile(SSH_KEYS_FILE, []);
  await initFile(VPS_CONNECTIONS_FILE, []);
  await initFile(DISCOVERED_PATHS_FILE, []);

  // Store connections and installer state in memory
  const vpsConnections = new Map<string, { client: Client; config: any }>();
  const githubClients = new Map<string, Octokit>();
  let installerState = {
    status: "idle",
    logs: "",
    lastRun: null as string | null,
  };
  let scanState = {
    status: "idle",
    progress: 0,
    logs: "",
    report: "",
    lastUpdate: null as string | null,
    projects: [] as any[],
    skillsFound: [] as string[],
    discoveredPaths: [] as string[],
  };

  // --- VPS Connections API ---
  app.get("/api/vps/connections", async (req, res) => {
    try {
      const data = await fs.readFile(VPS_CONNECTIONS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (err) {
      res.status(500).json({ error: "Failed to read connections" });
    }
  });

  app.post("/api/vps/connections", async (req, res) => {
    try {
      const { host, port, username, keyName, password } = req.body;
      const data = await fs.readFile(VPS_CONNECTIONS_FILE, "utf-8");
      const connections = JSON.parse(data);
      const newConn = {
        id: Date.now().toString(),
        host,
        port,
        username,
        keyName,
        password: password ? !!password : undefined, // Don't store plain text password
      };
      connections.push(newConn);
      await fs.writeFile(VPS_CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
      res.json(newConn);
    } catch (err) {
      res.status(500).json({ error: "Failed to save connection" });
    }
  });

  // --- SSH API ---
  app.get("/api/ssh/installer", (req, res) => {
    res.json(installerState);
  });

  app.get("/api/ssh/scan-status", (req, res) => {
    res.json(scanState);
  });

  app.post("/api/ssh/connect", (req, res) => {
    const { host, port, username, password, privateKey } = req.body;
    console.log(`Connecting to ${host}:${port} as ${username}`);
    
    if (!host || !username || (!password && !privateKey)) {
      return res.status(400).json({ error: "Missing required connection fields: host, username, and password or privateKey" });
    }

    const conn = new Client();

    conn
      .on("ready", () => {
        vpsConnections.set("default", {
          client: conn,
          config: { host, port, username },
        });
        res.json({ status: "connected", host });
      })
      .on("error", (err) => {
        console.error("SSH Connection Error:", err);
        res.status(500).json({ error: err.message });
      })
      .connect({
        host,
        port: port || 22,
        username,
        password,
        privateKey,
        readyTimeout: 15000,
      });
  });

  app.get("/api/ssh/keys", async (req, res) => {
    try {
      const data = await fs.readFile(SSH_KEYS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (err) {
      res.status(500).json({ error: "Failed to read keys" });
    }
  });

  app.post("/api/ssh/keys", async (req, res) => {
    try {
      const { name, key } = req.body;
      const data = await fs.readFile(SSH_KEYS_FILE, "utf-8");
      const keys = JSON.parse(data);
      const newKey = {
        id: Date.now().toString(),
        name,
        key,
        isDefault: keys.length === 0,
      };
      keys.push(newKey);
      await fs.writeFile(SSH_KEYS_FILE, JSON.stringify(keys, null, 2));
      res.json(newKey);
    } catch (err) {
      res.status(500).json({ error: "Failed to save key" });
    }
  });

  app.delete("/api/ssh/keys/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const data = await fs.readFile(SSH_KEYS_FILE, "utf-8");
      let keys = JSON.parse(data);
      const wasDefault = keys.find((k: any) => k.id === id)?.isDefault;
      keys = keys.filter((k: any) => k.id !== id);
      if (wasDefault && keys.length > 0) {
        keys[0].isDefault = true;
      }
      await fs.writeFile(SSH_KEYS_FILE, JSON.stringify(keys, null, 2));
      res.json({ status: "deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete key" });
    }
  });

  app.post("/api/ssh/keys/default", async (req, res) => {
    try {
      const { id } = req.body;
      const data = await fs.readFile(SSH_KEYS_FILE, "utf-8");
      let keys = JSON.parse(data);
      keys = keys.map((k: any) => ({ ...k, isDefault: k.id === id }));
      await fs.writeFile(SSH_KEYS_FILE, JSON.stringify(keys, null, 2));
      res.json({ status: "updated" });
    } catch (err) {
      res.status(500).json({ error: "Failed to update default key" });
    }
  });

  app.post("/api/ssh/exec", (req, res) => {
    const { command } = req.body;
    const conn = vpsConnections.get("default")?.client;

    if (!conn) {
      return res.status(400).json({ error: "No VPS connected" });
    }

    conn.exec(command, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });

      let out = "";
      let errorOut = "";
      stream
        .on("close", (code: number, signal: string) => {
          res.json({ code, signal, stdout: out, stderr: errorOut });
        })
        .on("data", (data: any) => {
          out += data.toString();
        })
        .stderr.on("data", (data: any) => {
          errorOut += data.toString();
        });
    });
  });

  app.post("/api/ssh/check", (req, res) => {
    const conn = vpsConnections.get("default")?.client;
    res.json({ connected: !!conn });
  });

  app.post("/api/ssh/verify", (req, res) => {
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });

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
      let out = "";
      stream
        .on("close", () => res.json({ report: out }))
        .on("data", (d) => (out += d.toString()))
        .stderr.on("data", (d) => (out += d.toString()));
    });
  });

  // --- VPS OS Installer ---
  app.post("/api/ssh/install-os", (req, res) => {
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });

    installerState = {
      status: "running",
      logs: "",
      lastRun: new Date().toISOString(),
    };

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
        installerState.status = "failed";
        installerState.logs += `\nError initiating: ${err.message}`;
        return res.status(500).json({ error: err.message });
      }

      stream
        .on("close", (code: number) => {
          installerState.status = code === 0 ? "completed" : "failed";
          installerState.logs += `\nProcess finished with code ${code}`;
        })
        .on("data", (data: any) => {
          installerState.logs += data.toString();
        })
        .stderr.on("data", (d: any) => {
          installerState.logs += d.toString();
        });

      res.json({ status: "Installation started" });
    });
  });

  // --- Migration ---
  app.post("/api/vps/migrate-skills", async (req, res) => {
    const { filePath } = req.body;
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });
    if (!filePath)
      return res.status(400).json({ error: "No file path provided" });

    try {
      let remoteContent = "";
      await new Promise((resolve, reject) => {
        conn.exec(`cat "${filePath}"`, (err, stream) => {
          if (err) return reject(err);
          stream.on("data", (data: Buffer) => {
            remoteContent += data.toString();
          });
          stream.on("close", resolve);
          stream.stderr.on("data", (data: Buffer) => {
            console.error("Migration Error:", data.toString());
          });
        });
      });

      const remoteSkills = JSON.parse(remoteContent);
      if (!Array.isArray(remoteSkills))
        throw new Error("Invalid skills format");

      const localContent = await fs.readFile(SKILLS_FILE, "utf-8");
      const localSkills = JSON.parse(localContent);

      const mergedSkills = [...localSkills];
      remoteSkills.forEach((rs: any) => {
        if (!mergedSkills.find((ls: any) => ls.title === rs.title)) {
          mergedSkills.push(rs);
        }
      });

      await fs.writeFile(SKILLS_FILE, JSON.stringify(mergedSkills, null, 2));
      res.json({
        success: true,
        count: remoteSkills.length,
        total: mergedSkills.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Deep/Global Scan ---
  app.get("/api/ssh/discovered-paths", async (req, res) => {
    try {
      const data = await fs.readFile(DISCOVERED_PATHS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch {
      res.json([]);
    }
  });

  app.post("/api/ssh/deep-scan", (req, res) => {
    const { path: scanPath } = req.body;
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });

    scanState = {
      ...scanState,
      status: "scanning",
      progress: 10,
      logs: "Initializing deep scan...",
      report: "",
      lastUpdate: new Date().toISOString(),
    };

    const targetPath = scanPath || ".";
    const scanScript = `
      echo "--- SCAN START ---"
      echo "TARGET_PATH: ${targetPath}"
      echo "##PROGRESS:15##"
      
      # Find potential project roots
      echo "DEBUG: Scanning path ${targetPath} for project roots..."
      PROJECTS=$(find "${targetPath}" -maxdepth 10 \( -name "package.json" -o -name "requirements.txt" -o -name "go.mod" -o -name "pom.xml" -o -name "index.html" -o -name "project.json" -o -name ".git" -o -name "*.tmp" \) -printf '%h\n' 2>&1 | grep -v "node_modules" | sort -u | head -n 200)
      echo "DEBUG: Found projects: $PROJECTS"
      echo "##PROGRESS:30##"

      # Also find skills in this specific path
      find "${targetPath}" -maxdepth 10 -name "learned_skills.json" 2>/dev/null | sed 's/^/##SKILL_FILE:/' | sed 's/$/##/'
      
      if [ -z "$PROJECTS" ]; then
        echo "No structured projects detected. Listing raw files..."
        find "${targetPath}" -maxdepth 3 2>/dev/null | grep -v "node_modules" | head -n 200
      else
        PROJ_COUNT=$(echo "$PROJECTS" | wc -l)
        CURRENT_PROJ=0
        for proj in $PROJECTS; do
          CURRENT_PROJ=$((CURRENT_PROJ + 1))
          P=$((30 + (60 * CURRENT_PROJ / PROJ_COUNT)))
          echo "##PROGRESS:$P##"
          
          # Extract dependencies
          DEPS='{}'
          if [ -f "$proj/package.json" ]; then
            DEPS=$(cat "$proj/package.json" | python3 -c 'import sys, json; print(json.dumps(json.load(sys.stdin).get("dependencies", {})))')
          elif [ -f "$proj/requirements.txt" ]; then
            DEPS=$(cat "$proj/requirements.txt" | python3 -c 'import sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip() and not line.startswith("#")]))')
          elif [ -f "$proj/go.mod" ]; then
            # Simple go.mod parsing
            DEPS=$(grep "^require " "$proj/go.mod" | awk '{print $2, $3}' | python3 -c 'import sys, json; print(json.dumps(dict(line.split() for line in sys.stdin if line.strip())))')
          fi

          echo "##PROJECT_DATA:{\"path\":\"$proj\", \"deps\":$DEPS}##"
          
          echo "Scanning: $proj"
          echo "=== PROJECT: $proj ==="
          
          echo "[File Breakdown]"
          find "$proj" -maxdepth 3 -type f -name "*.*" 2>/dev/null | grep -v "node_modules" | rev | cut -d. -f1 | rev | sort | uniq -c | sort -nr | head -n 12
          
          echo "[Detected Entry Points]"
          find "$proj" -maxdepth 2 \( -name "server.js" -o -name "app.js" -o -name "main.py" -o -name "app.py" -o -name "index.js" -o -name "main.go" -o -name "index.html" -o -name "main.tsx" -o -name "App.tsx" -o -name "index.ts" -o -name "server.ts" \) 2>/dev/null
          
          echo "-----------------------"
        done
      fi
      echo "--- END ---"
    `;

    conn.exec(scanScript, (err, stream) => {
      if (err) {
        scanState.status = "failed";
        scanState.logs += `\nError initiating: ${err.message}`;
        return res.status(500).json({ error: err.message });
      }

      let out = "";
      stream
        .on("close", (code: number) => {
          scanState.status = code === 0 ? "completed" : "failed";
          scanState.report = out;
          scanState.progress = 100;
          scanState.logs =
            code === 0 ? "Scan completed" : `Scan finished with code ${code}`;
        })
        .on("data", (d) => {
          const data = d.toString();
          out += data;
          const lines = data.split("\n").filter((l) => l.trim().length > 0);
          for (const line of lines) {
            const progMatch = line.match(/##PROGRESS:(\d+)##/);
            const skillMatch = line.match(/##SKILL_FILE:(.+)##/);
            const projMatch = line.match(/##PROJECT_DATA:(.+)##/);

            if (progMatch) {
              scanState.progress = parseInt(progMatch[1]);
            } else if (skillMatch) {
              if (!scanState.skillsFound.includes(skillMatch[1])) {
                scanState.skillsFound.push(skillMatch[1]);
                scanState.logs = `AI Skill detected in deep scan: ${skillMatch[1]}`;
              }
            } else if (projMatch) {
              try {
                scanState.projects.push(JSON.parse(projMatch[1]));
              } catch (e) {
                console.error("Failed to parse project data", e);
              }
            } else if (
              !line.startsWith("---") &&
              !line.startsWith("TARGET_PATH")
            ) {
              scanState.logs = line;
            }
          }
        })
        .stderr.on("data", (d) => {
          scanState.logs += `\nERROR: ${d.toString().split("\n")[0]}`;
        });

      res.json({ status: "Deep scan started" });
    });
  });

  app.post("/api/ssh/global-scan", async (req, res) => {
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });

    scanState = {
      ...scanState,
      status: "scanning",
      progress: 5,
      logs: "Beginning global intelligence scan...",
      report: "",
      lastUpdate: new Date().toISOString(),
      skillsFound: [],
      discoveredPaths: [],
    };

    let SEARCH_PATHS = ["~", "/home", "/var/www", "/opt", "/tmp", "/root"];
    try {
      const data = await fs.readFile(DISCOVERED_PATHS_FILE, "utf-8");
      const discovered = JSON.parse(data);
      SEARCH_PATHS = Array.from(new Set([...SEARCH_PATHS, ...discovered]));
    } catch (e) {}

    const globalScanScript = `
      echo "--- GLOBAL INTELLIGENCE SCAN ---"
      echo "SEARCH_PATHS: ${SEARCH_PATHS.join(" ")}"
      echo "##PROGRESS:10##"
      
      # Domain Discovery
      echo "##PROGRESS:15##"
      echo "Scanning web server configs..."
      for conf in /etc/nginx/sites-enabled/* /etc/nginx/nginx.conf /etc/apache2/sites-enabled/* /etc/apache2/apache2.conf; do
        if [ -f "$conf" ]; then
          ROOTS=$(grep -E "^\\s*(root|DocumentRoot)" "$conf" | awk '{print $2}' | sed 's/;//' | sed 's/"//g')
          for r in $ROOTS; do
            if [ -d "$r" ]; then
              echo "##DOMAIN_PATH:$r##"
            fi
          done
        fi
      done

      PATHS="${SEARCH_PATHS.join(" ")}"
      for p in $PATHS; do
        if [ -d "$p" ]; then
          echo "##SCANNING_PATH:$p##"
          
          # AI Skills Detection
          find "$p" -maxdepth 6 -name "learned_skills.json" 2>/dev/null | sed 's/^/##SKILL_FILE:/' | sed 's/$/##/'

          # Identify project roots
          echo "DEBUG: Scanning path $p"
          PROJS=$(find "$p" -maxdepth 10 \( -name "package.json" -o -name "requirements.txt" -o -name "go.mod" -o -name "project.json" -o -name ".git" -o -name "*.tmp" \) -printf '%h\n' 2>&1 | tee /tmp/scan_debug.log | grep -v "node_modules" | sort -u | head -n 100)
          echo "DEBUG: Found projects: $PROJS"
          for proj in $PROJS; do
            echo ">>> DETECTED: $proj"
            
            # Extract dependencies
            DEPS='{}'
            if [ -f "$proj/package.json" ]; then
              DEPS=$(cat "$proj/package.json" | python3 -c 'import sys, json; print(json.dumps(json.load(sys.stdin).get("dependencies", {})))' || echo "{}")
            elif [ -f "$proj/requirements.txt" ]; then
              DEPS=$(cat "$proj/requirements.txt" | python3 -c 'import sys, json; print(json.dumps({line.strip().split("==")[0]: "" for line in sys.stdin if line.strip() and not line.startswith("#")}))' || echo "{}")
            elif [ -f "$proj/go.mod" ]; then
              DEPS=$(grep "^require " "$proj/go.mod" | awk '{print $2, "v" $3}' | python3 -c 'import sys, json; print(json.dumps(dict(line.split() for line in sys.stdin if line.strip())))' || echo "{}")
            fi
            
            # Construct and output project data safely
            python3 -c '
import sys, json
proj = sys.argv[1]
deps_str = sys.argv[2]
try:
    deps = json.loads(deps_str)
except:
    deps = {}
data = {"path": proj, "deps": deps}
sys.stdout.write(f"##PROJECT_DATA:{json.dumps(data)}##\n")
' "$proj" "$DEPS"
            
            # Quick stat
            find "$proj" -maxdepth 3 -type f 2>/dev/null | grep -v "node_modules" | rev | cut -d. -f1 | rev | sort | uniq -c | sort -nr | head -n 8 | xargs echo "Files:"
            # Entry points
            find "$proj" -maxdepth 3 \( -name "server.js" -o -name "app.js" -o -name "main.py" -o -name "index.html" -o -name "index.ts" -o -name "server.ts" -o -name "App.tsx" \) 2>/dev/null | head -n 10 | xargs echo "Entries:"
          done
        fi
      done
      echo "--- END ---"
    `;

    conn.exec(globalScanScript, (err, stream) => {
      if (err) {
        scanState.status = "failed";
        scanState.logs += `\nError initiating: ${err.message}`;
        return res.status(500).json({ error: err.message });
      }

      let out = "";
      const pathCount = SEARCH_PATHS.length;
      let currentPathIndex = 0;

      stream
        .on("close", async (code: number) => {
          scanState.status = code === 0 ? "completed" : "failed";
          scanState.report = out;
          scanState.progress = 100;
          scanState.logs =
            code === 0
              ? "Global scan completed"
              : `Global scan finished with code ${code}`;

          // Persist discovered paths
          if (scanState.discoveredPaths.length > 0) {
            try {
              const data = await fs.readFile(DISCOVERED_PATHS_FILE, "utf-8");
              const existing = JSON.parse(data);
              const updated = Array.from(
                new Set([...existing, ...scanState.discoveredPaths]),
              );
              await fs.writeFile(
                DISCOVERED_PATHS_FILE,
                JSON.stringify(updated, null, 2),
              );
            } catch (e) {
              console.error("Failed to persist discovered paths", e);
            }
          }
        })
        .on("data", (d) => {
          const data = d.toString();
          out += data;
          const lines = data.split("\n").filter((l) => l.trim().length > 0);
          for (const line of lines) {
            const progMatch = line.match(/##PROGRESS:(\d+)##/);
            const pathMatch = line.match(/##SCANNING_PATH:(.+)##/);
            const domainMatch = line.match(/##DOMAIN_PATH:(.+)##/);
            const skillMatch = line.match(/##SKILL_FILE:(.+)##/);
            const projMatch = line.match(/##PROJECT_DATA:(.+)##/);

            if (progMatch) {
              scanState.progress = parseInt(progMatch[1]);
            } else if (domainMatch) {
              if (!scanState.discoveredPaths.includes(domainMatch[1])) {
                scanState.discoveredPaths.push(domainMatch[1]);
                scanState.logs = `Discovered domain path: ${domainMatch[1]}`;
              }
            } else if (skillMatch) {
              if (!scanState.skillsFound.includes(skillMatch[1])) {
                scanState.skillsFound.push(skillMatch[1]);
                scanState.logs = `AI Skill detected: ${skillMatch[1]}`;
              }
            } else if (projMatch) {
              try {
                scanState.projects.push(JSON.parse(projMatch[1]));
              } catch (e) {
                console.error("Failed to parse project data", e);
              }
            } else if (pathMatch) {
              currentPathIndex++;
              scanState.progress = Math.min(
                95,
                20 + Math.floor((currentPathIndex / pathCount) * 75),
              );
              scanState.logs = `Scanning: ${pathMatch[1]}`;
            } else if (
              !line.startsWith("---") &&
              !line.startsWith("SEARCH_PATHS")
            ) {
              scanState.logs = line;
            }
          }
        })
        .stderr.on("data", (d) => {
          scanState.logs += `\nERROR: ${d.toString().split("\n")[0]}`;
        });

      res.json({ status: "Global scan started" });
    });
  });

  app.post("/api/ssh/save-path", async (req, res) => {
    const { path: newPath } = req.body;
    if (!newPath) return res.status(400).json({ error: "No path provided" });
    try {
      const data = await fs.readFile(DISCOVERED_PATHS_FILE, "utf-8");
      const existing = JSON.parse(data);
      if (!existing.includes(newPath)) {
        existing.push(newPath);
        await fs.writeFile(
          DISCOVERED_PATHS_FILE,
          JSON.stringify(existing, null, 2),
        );
      }
      res.json({ status: "success", path: newPath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- GitHub API ---
  app.post("/api/github/connect", (req, res) => {
    const { token } = req.body;
    try {
      const octokit = new Octokit({ auth: token });
      githubClients.set("default", octokit);
      res.json({ status: "connected" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/github/repos", async (req, res) => {
    const octokit = githubClients.get("default");
    if (!octokit)
      return res.status(400).json({ error: "GitHub not connected" });

    try {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/github/stash", (req, res) => {
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });
    conn.exec('git stash', (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      stream.on('close', () => res.json({ status: 'success' }));
    });
  });

  app.post("/api/github/stash-pop", (req, res) => {
    const conn = vpsConnections.get("default")?.client;
    if (!conn) return res.status(400).json({ error: "No VPS connected" });
    conn.exec('git stash pop', (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      stream.on('close', () => res.json({ status: 'success' }));
    });
  });

  // --- VPS File API ---
  app.get("/api/ssh/ls", async (req, res) => {
    const { path: dirPath } = req.query;
    const conn = vpsConnections.get("default")?.client;
    if (!conn || !dirPath)
      return res.status(400).json({ error: "Missing connection or path" });

    // ls -p adds a / to directories
    // ls -lh adds size
    const cmd = `ls -p1Ah --group-directories-first "${dirPath}"`;
    conn.exec(cmd, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      let out = "";
      stream
        .on("close", () => {
          const items = out
            .split("\n")
            .filter(Boolean)
            .map((item) => {
              const name = item.replace(/\/$/, "");
              const isDir = item.endsWith("/");
              const cleanDirPath = (dirPath as string).endsWith("/") 
                ? (dirPath as string) 
                : (dirPath as string) + "/";
              return {
                name,
                isDirectory: isDir,
                path: cleanDirPath + name,
              };
            });
          res.json(items);
        })
        .on("data", (d) => (out += d.toString()));
    });
  });

  app.get("/api/ssh/file", async (req, res) => {
    const { path: filePath, base64: isBase64 } = req.query;
    const conn = vpsConnections.get("default")?.client;
    if (!conn || !filePath)
      return res.status(400).json({ error: "Missing connection or path" });

    const cmd =
      isBase64 === "true" ? `base64 -w 0 "${filePath}"` : `cat "${filePath}"`;
    conn.exec(cmd, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      let out = "";
      stream
        .on("close", () =>
          res.json({ content: out, isBase64: isBase64 === "true" }),
        )
        .on("data", (d) => (out += d.toString()));
    });
  });

  app.post("/api/ssh/file/action", async (req, res) => {
    const { action, path: targetPath, newPath, content } = req.body;
    const conn = vpsConnections.get("default")?.client;
    if (!conn || !targetPath)
      return res.status(400).json({ error: "Missing connection or path" });

    let cmd = "";
    switch (action) {
      case "delete":
        cmd = `rm -rf "${targetPath}"`;
        break;
      case "rename":
        cmd = `mv "${targetPath}" "${newPath}"`;
        break;
      case "mkdir":
        cmd = `mkdir -p "${targetPath}"`;
        break;
      case "copy":
        cmd = `cp -r "${targetPath}" "${newPath}"`;
        break;
      case "move":
        cmd = `mv "${targetPath}" "${newPath}"`;
        break;
      default:
        return res.status(400).json({ error: "Invalid action" });
    }

    conn.exec(cmd, (err, stream) => {
      if (err) return res.status(500).json({ error: err.message });
      stream.on("close", (code) =>
        res.json({ status: code === 0 ? "success" : "failed", code }),
      );
    });
  });

  app.post("/api/ssh/file", async (req, res) => {
    const { path: filePath, content } = req.body;
    const conn = vpsConnections.get("default")?.client;
    if (!conn || !filePath)
      return res.status(400).json({ error: "Missing connection or path" });

    // Use a unique sentinel to avoid collisions
    const sentinel = `GEMINI_EOF_${Date.now()}`;
    conn.exec(
      `cat > "${filePath}" <<'${sentinel}'\n${content}\n${sentinel}`,
      (err, stream) => {
        if (err) return res.status(500).json({ error: err.message });
        stream.on("close", () => res.json({ status: "success" }));
      },
    );
  });

  // --- Learn Skill API ---
  app.get("/api/skills", async (req, res) => {
    try {
      const data = await fs.readFile(SKILLS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (e) {
      res.json([]);
    }
  });

  app.post("/api/skills", async (req, res) => {
    const { name, content } = req.body;
    try {
      const data = JSON.parse(await fs.readFile(SKILLS_FILE, "utf-8"));
      data.push({ name, content, learnedAt: new Date().toISOString() });
      await fs.writeFile(SKILLS_FILE, JSON.stringify(data, null, 2));
      res.json({ status: "Skill learned successfully" });
    } catch (e) {
      res.status(500).json({ error: "Failed to learn skill" });
    }
  });

  // --- Health API ---
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      vpsConnected: vpsConnections.has("default"),
      githubConnected: githubClients.has("default"),
      timestamp: new Date().toISOString(),
    });
  });

  // --- Static/Vite ---
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION AT:", promise, "REASON:", reason);
});

startServer().catch((err) => {
  console.error("FATAL SERVER ERROR:", err);
  process.exit(1);
});
