/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React, { useState, useEffect, useRef, useCallback } from "react";

interface FileItem {
  path: string;
  type: string;
}

interface BatchFile {
  path: string;
  content: string;
}

interface ChatMessage {
  text: string;
  type: "info" | "error" | "success" | "warning" | "user" | "bot";
}

export const SovereignStudioPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"explorer" | "editor" | "chat">("explorer");
  const [ghPat, setGhPat] = useState("");
  const [geminiKey, setGeminiKey] = useState(process.env.GEMINI_API_KEY || "");
  const [repoOwner, setRepoOwner] = useState("OuroborosCollective");
  const [repoName, setRepoName] = useState("Wasd");
  const [fullTree, setFullTree] = useState<FileItem[]>([]);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [currentFileContent, setCurrentFileContent] = useState("");
  const [currentFilename, setCurrentFilename] = useState("Keine Datei gewählt");
  const [architectInput, setArchitectInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isArchitectActive, setIsArchitectActive] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [isPushing, setIsPushing] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const logToSystem = useCallback((text: string, type: ChatMessage["type"] = "info") => {
    setChatHistory((prev) => [...prev, { text, type }]);
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory]);

  const callGeminiAPI = async (prompt: string, system: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
      }),
    });
    if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  };

  const fetchRepoTree = useCallback(async () => {
    try {
      const headers: HeadersInit = ghPat ? { Authorization: `token ${ghPat}` } : {};
      let response = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/main?recursive=1`,
        { headers }
      );
      if (!response.ok) {
        response = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/master?recursive=1`,
          { headers }
        );
        if (!response.ok) throw new Error("Repo Tree konnte weder von main noch von master geladen werden.");
      }
      const data = await response.json();
      setFullTree(data.tree.filter((item: any) => item.type === "blob"));
    } catch (err: any) {
      logToSystem(`<b>GitHub Ladefehler:</b> ${err.message}. Ist das Repo privat? Dann erst PAT oben eingeben!`, "warning");
    }
  }, [ghPat, repoOwner, repoName, logToSystem]);

  useEffect(() => {
    fetchRepoTree();
  }, []);

  const fetchFileContent = async (path: string) => {
    try {
      const headers: HeadersInit = ghPat ? { Authorization: `token ${ghPat}` } : {};
      let response = await fetch(`https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/${path}`, { headers });
      if (!response.ok) {
        response = await fetch(`https://raw.githubusercontent.com/${repoOwner}/${repoName}/master/${path}`, { headers });
        if (!response.ok) return "";
      }
      return await response.text();
    } catch {
      return "";
    }
  };

  const handleFileSelect = async (path: string) => {
    setCurrentFilename(path);
    setIsLoading(true);
    const content = await fetchFileContent(path);
    setCurrentFileContent(content);
    setIsLoading(false);
    setActiveTab("editor");
  };

  const runArchitect = async () => {
    if (!architectInput.trim()) return;
    setIsArchitectActive(true);
    logToSystem("<b>Architekt analysiert Blueprint...</b><br>Erstelle Projektplan.", "info");
    setActiveTab("chat");

    try {
      const architectSys = `Du bist der Ouroboros Software-Architekt. Deine Aufgabe ist es, einen Text-Blueprint in striktes JSON zu parsen.
      Analysiere das Modul und überlege, welche Dateien erstellt oder modifiziert werden müssen (Logik, UI, Config).
      ANTWORTE AUSSCHLIESSLICH MIT EINEM VALIDEN JSON-ARRAY im folgenden Format, KEIN MARKDOWN, KEIN TEXT:
      [
        { "path": "client/src/...", "task": "Detaillierte Anweisung für den Compiler, was hier programmiert werden soll" }
      ]`;

      const rawPlan = await callGeminiAPI(architectInput, architectSys);
      const cleanPlan = rawPlan.replace(/```json/g, "").replace(/```/g, "").trim();
      const plan = JSON.parse(cleanPlan);

      logToSystem(`<b>Projektplan erstellt:</b><br>${plan.length} Dateien müssen bearbeitet werden. Compiler übernimmt...`, "info");

      const newBatchFiles: BatchFile[] = [];
      for (const step of plan) {
        logToSystem(`⏳ Bearbeite: <code>${step.path}</code>...`, "info");
        setCurrentFilename(step.path);
        const existingCode = await fetchFileContent(step.path);

        const compilerSys = `Du bist ein reiner TypeScript/JavaScript/HTML Compiler. KEINE EMOTIONEN. GIB NUR EXECUTABLE CODE ZURÜCK. KEIN MARKDOWN. GIB IMMER DIE KOMPLETTE DATEI ZURÜCK.`;
        const compilerPrompt = `Datei: ${step.path}\nBisheriger Code:\n${existingCode || "// Neue Datei"}\n\nAufgabe: ${step.task}\n\nAntworte nur mit dem vollständigen Code.`;

        let newCode = await callGeminiAPI(compilerPrompt, compilerSys);
        newCode = newCode.replace(/```typescript\n?/g, "").replace(/```javascript\n?/g, "").replace(/```tsx\n?/g, "").replace(/```html\n?/g, "").replace(/```\n?/g, "").trim();

        newBatchFiles.push({ path: step.path, content: newCode });
        setCurrentFileContent(newCode);
      }
      setBatchFiles(newBatchFiles);
      setCommitMsg(`Architect Deploy: Module Update (${newBatchFiles.length} files)`);
      logToSystem(`🎉 <b>Projekt-Modul lokal generiert!</b><br>Gib oben deinen PAT ein und klicke auf 'API MASS PUSH', um das komplette Projekt live zu schalten.`, "success");
    } catch (err: any) {
      logToSystem(`<b>Kritischer Fehler:</b> ${err.message}`, "error");
    } finally {
      setIsArchitectActive(false);
    }
  };

  const handlePush = async () => {
    if (!ghPat) {
      logToSystem("🚨 <b>Fehler:</b> Bitte gib oben deinen GitHub Personal Access Token (PAT) ein!", "error");
      return;
    }
    if (batchFiles.length === 0) return;

    setIsPushing(true);
    logToSystem("🚀 <b>Starte sicheren Multi-File Commit...</b>", "info");
    setActiveTab("chat");

    try {
      const headers = {
        Authorization: `token ${ghPat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      };

      logToSystem("🔍 [1/5] Suche Branch-Referenz...", "info");
      let branchPath = "heads/main";
      let refRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/${branchPath}`, { headers });

      if (!refRes.ok) {
        branchPath = "heads/master";
        refRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/${branchPath}`, { headers });
        if (!refRes.ok) {
          const err = await refRes.json().catch(() => ({ message: "Unbekannt" }));
          throw new Error(`Branch 'main' oder 'master' nicht gefunden. PAT ungültig oder kein Repo-Zugriff? (API: ${err.message})`);
        }
      }
      const refData = await refRes.json();
      const commitSha = refData.object.sha;

      logToSystem("🌳 [2/5] Lade aktuellen Dateibaum...", "info");
      const commitRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/commits/${commitSha}`, { headers });
      if (!commitRes.ok) {
        const err = await commitRes.json();
        throw new Error(`Konnte letzten Commit nicht laden: ${err.message}`);
      }
      const commitData = await commitRes.json();
      const baseTreeSha = commitData.tree.sha;

      logToSystem("📦 [3/5] Schnüre neues Datenpaket (Tree)...", "info");
      const tree = batchFiles.map((f) => {
        let cleanPath = f.path.replace(/^\/+/, "");
        return {
          path: cleanPath,
          mode: "100644",
          type: "blob",
          content: f.content,
        };
      });

      const newTreeRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/trees`, {
        method: "POST",
        headers,
        body: JSON.stringify({ base_tree: baseTreeSha, tree }),
      });
      if (!newTreeRes.ok) {
        const err = await newTreeRes.json();
        throw new Error(`Tree-Erstellung fehlgeschlagen: ${err.message}`);
      }
      const newTreeData = await newTreeRes.json();

      logToSystem("✍️ [4/5] Signiere Commit...", "info");
      const finalMsg = commitMsg || `Architect Update (${batchFiles.length} files)`;
      const newCommitRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/commits`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: finalMsg,
          tree: newTreeData.sha,
          parents: [commitSha],
        }),
      });
      if (!newCommitRes.ok) {
        const err = await newCommitRes.json();
        throw new Error(`Commit konnte nicht erstellt werden: ${err.message}`);
      }
      const newCommitData = await newCommitRes.json();

      logToSystem("🚀 [5/5] Pushe Commit in Repository...", "info");
      const updateRefRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/${branchPath}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: newCommitData.sha, force: false }),
      });
      if (!updateRefRes.ok) {
        const err = await updateRefRes.json();
        throw new Error(`Push verweigert! ${err.message}`);
      }

      logToSystem(`🟢 <b>GITOPS SUCCESS!</b><br>Alle ${batchFiles.length} Dateien wurden in einem einzigen Commit gepusht!`, "success");
      setBatchFiles([]);
      setCommitMsg("");
      fetchRepoTree();
    } catch (err: any) {
      logToSystem(`🚨 <b>PUSH FEHLGESCHLAGEN:</b> ${err.message}`, "error");
    } finally {
      setIsPushing(false);
    }
  };

  const handleEditorAction = async (action: string, promptText?: string) => {
    if (!currentFileContent && action !== "Auto-README" && action !== "Dockerize" && action !== "CI/CD") return;

    logToSystem(`✨ <b>Führe ${action} aus...</b>`, "info");
    setActiveTab("chat");
    try {
      let sysPrompt = "";
      let userPrompt = `Datei: ${currentFilename}\n\nCode:\n${currentFileContent}`;

      switch (action) {
        case "Analyze":
          sysPrompt = "Du bist ein strenger Senior Code Reviewer. Analysiere den folgenden Code. 1. Nenne kurze Stärken. 2. Liste potenzielle Bugs, Sicherheitslücken oder Performance-Probleme auf. 3. Mache 1-2 konkrete Architektur/Clean-Code Vorschläge. Antworte in kurzem, leicht lesbarem HTML (nutze <b>, <ul>, <li>, <code>). Keine Markdown-Blöcke.";
          break;
        case "Explain":
          sysPrompt = "Du bist ein erfahrener technischer Mentor. Erkläre den folgenden Code in klarem, einfachem Deutsch. Fasse zusammen, was die Datei tut, welche Hauptfunktionen es gibt und wie sie funktionieren. Antworte in gut formatiertem HTML (nutze <b>, <ul>, <li>). Kein Markdown.";
          break;
        case "Refactor":
          sysPrompt = "Du bist ein Clean Code Experte. Refaktorisiere den Code. Optimiere die Performance, verbessere die Lesbarkeit und wende moderne Best Practices (z.B. ES6+, SOLID) an. Verändere nicht die Kernlogik. Gib NUR den vollständigen, optimierten Code zurück (kein Markdown drumherum, nur Raw Code).";
          break;
        case "Auto-Fix":
          sysPrompt = "Du bist ein meisterhafter Debugger. Finde Syntax-Fehler, logische Lücken oder veraltete API-Aufrufe im Code und BEHEBE sie. Verändere nicht die Kern-Architektur, mache den Code nur lauffähig und fehlerfrei. Gib NUR den reparierten Code zurück, absolut kein Markdown, keine Erklärungen.";
          break;
        case "Translate":
          const targetLang = prompt("In welche Programmiersprache soll der Code übersetzt werden? (z.B. Python, Rust, Go)");
          if (!targetLang) return;
          sysPrompt = `Du bist ein Expert Developer. Übersetze den folgenden Code in ${targetLang}. Erhalte die exakte Logik bei. Gib NUR den reinen übersetzten Code zurück, ohne Markdown-Blöcke.`;
          break;
        case "Big-O":
          sysPrompt = "Du bist ein Informatik-Professor. Analysiere die Zeitkomplexität (Time Complexity) und Platzkomplexität (Space Complexity) im Big-O Format für die Hauptfunktionen im folgenden Code. Gib an, wo der Flaschenhals liegt und wie man ihn optimieren könnte. Antworte in kurzem, gut lesbarem HTML (nutze <b>, <code>, <ul>, <li>). Kein Markdown.";
          break;
        case "Diagram":
          sysPrompt = "Du bist ein Software-Architekt. Erstelle ein Mermaid.js Diagramm (Flowchart oder Class Diagram), das den Ablauf und die Struktur des folgenden Codes visuell darstellt. Gib NUR den Mermaid-Code zurück, eingebettet in einem Markdown-Block: ```mermaid\n[DEIN CODE]\n```";
          break;
        case "Security":
          sysPrompt = "Du bist ein erfahrener White-Hat Hacker und Cyber-Security Experte. Analysiere den folgenden Code auf gängige Schwachstellen (z.B. OWASP Top 10, Injection, XSS, ungesicherte APIs, Secrets im Code). Gib konkrete Warnungen und Lösungsvorschläge. Antworte in kurzem, gut lesbarem HTML (nutze <b>, <code>, <ul class='list-disc pl-4'>, <li>). Kein Markdown.";
          break;
        case "Mock Data":
          sysPrompt = "Du bist ein Backend-Entwickler. Analysiere den Code und generiere dazu passende, extrem realistische Mock-Daten als JSON-Array mit 5 detaillierten Objekten. Gib AUSSCHLIESSLICH das nackte JSON zurück, ohne Markdown-Fences drumherum.";
          break;
        case "A11y":
          sysPrompt = "Du bist ein Experte für Web Accessibility (WCAG). Analysiere den folgenden Code auf Barrierefreiheit. Prüfe auf fehlende ARIA-Labels, schlechte Kontraste, Tastaturnavigation und Alt-Texte. Gib konkrete Verbesserungsvorschläge. Antworte in kurzem, gut lesbarem HTML (nutze <b>, <code>, <ul class='list-disc pl-4'>, <li>). Kein Markdown.";
          break;
        case "i18n":
          sysPrompt = "Du bist ein Frontend-Architekt. Analysiere den Code und extrahiere alle hartcodierten, nutzersichtbaren Texte (Strings). Generiere eine JSON-Datei mit Key-Value-Paaren (Keys in UPPER_SNAKE_CASE, Values sind die Originaltexte). Gib AUSSCHLIESSLICH das validierte JSON zurück, absolut kein Markdown drumherum.";
          break;
        case "cURL API":
          sysPrompt = "Du bist ein API-Spezialist. Analysiere diesen Code auf API-Endpunkte. Generiere ein strukturiertes Markdown-Dokument mit realistischen, kopierbaren `curl`-Befehlen zum Testen dieser Endpunkte. Gib NUR Markdown zurück, ohne Fences drumherum.";
          break;
        case "Tailwind":
          sysPrompt = "Du bist ein Frontend UI/UX Experte. Konvertiere das Styling dieses Codes in moderne Tailwind CSS Utility-Klassen. Ändere nicht die Kernlogik. Gib NUR den vollständigen, umgeschriebenen Code zurück (kein Markdown drumherum).";
          break;
        case "Dockerize":
          const paths = fullTree.slice(0, 100).map(f => f.path).join('\n');
          userPrompt = `Dateibaum:\n${paths}\n\nAktuelle Datei (${currentFilename}):\n${currentFileContent.substring(0, 1500)}`;
          sysPrompt = "Du bist ein DevOps Engineer. Analysiere die Dateipfade und den Code, um den Tech-Stack zu erraten. Generiere ein professionelles, multi-stage, produktionsbereites 'Dockerfile'. Gib AUSSCHLIESSLICH den Inhalt des Dockerfiles zurück, ohne Markdown-Fences drumherum.";
          break;
        case "SEO Audit":
          sysPrompt = "Du bist ein SEO-Experte. Analysiere diesen Code auf SEO-Best-Practices. Prüfe auf fehlende Meta-Tags, Title-Tags, semantisches HTML, Alt-Attribute und Open Graph Daten. Antworte in kurzem, gut lesbarem HTML (nutze <b>, <code>, <ul class='list-disc pl-4'>, <li>). Kein Markdown.";
          break;
        case "SQL Schema":
          sysPrompt = "Du bist ein Database Administrator. Analysiere den Code und generiere das entsprechende SQL-Schema (PostgreSQL) mit CREATE TABLE Statements, korrekten Datentypen, Primary Keys und Foreign Keys. Gib AUSSCHLIESSLICH den rohen SQL-Code zurück, ohne Markdown-Fences drumherum.";
          break;
        case "TS Types":
          sysPrompt = "Du bist ein TypeScript-Experte. Analysiere das übergebene JSON, JavaScript oder die ungetypten Strukturen und generiere strikte, professionell benannte TypeScript Interfaces und Types dafür. Gib AUSSCHLIESSLICH den rohen TypeScript-Code zurück, ohne Markdown-Fences drumherum.";
          break;
        case "CI/CD":
          const treePaths = fullTree.slice(0, 100).map(f => f.path).join('\n');
          userPrompt = `Dateibaum:\n${treePaths}`;
          sysPrompt = "Du bist ein DevOps Architekt. Analysiere den Dateibaum, um den Tech-Stack zu erkennen. Schreibe eine professionelle GitHub Actions CI/CD Pipeline (`main.yml`), die den Code auscheckt, Abhängigkeiten installiert, Tests ausführt und das Projekt baut. Gib AUSSCHLIESSLICH den rohen YAML-Code zurück, ohne Markdown-Fences.";
          break;
        case "Tutorial":
          sysPrompt = "Du bist ein Developer Advocate und Tech-Blogger. Schreibe ein gut strukturiertes Markdown-Tutorial, das den übergebenen Code Schritt für Schritt erklärt. Gib AUSSCHLIESSLICH Markdown-Text zurück.";
          break;
        case "Docs":
          sysPrompt = "Du bist ein Senior Developer. Füge dem folgenden Code professionelle JSDoc/Docstrings und hilfreiche Inline-Kommentare hinzu. Verändere NICHTS an der Logik. Gib NUR den vollständigen, kommentierten Code zurück (kein Markdown, nur reiner Code).";
          break;
        case "Tests":
          sysPrompt = "Du bist ein QA Engineer. Schreibe ausführliche Unit-Tests (Jest/Mocha Stil) für den folgenden Code. Gib NUR den vollständigen Test-Code zurück (kein Markdown drumherum, nur Raw Code).";
          break;
        case "Auto-README":
          const allPaths = fullTree.slice(0, 100).map(f => f.path).join('\n');
          userPrompt = `Dateibaum:\n${allPaths}`;
          sysPrompt = "Du bist ein technischer Projektmanager. Generiere basierend auf der Liste der Dateipfade eine professionelle 'README.md' für dieses Projekt auf Deutsch. Antworte NUR mit dem Inhalt der README.md Datei, ohne Markdown Code-Fences drumherum.";
          break;
        case "Smart Commit":
          sysPrompt = "Du bist ein Git-Experte. Generiere EINE EINZIGE präzise, professionelle 'Conventional Commit' Message (max 70 Zeichen) basierend auf der Liste der geänderter Dateien. Gib NUR die Commit Message zurück.";
          const changesSummary = batchFiles.map(f => `Datei: ${f.path}\nSnippet: ${f.content.substring(0, 100)}...`).join("\n\n");
          userPrompt = `Geänderte Dateien:\n${changesSummary}`;
          break;
        default:
          return;
      }

      const response = await callGeminiAPI(userPrompt, sysPrompt);

      const htmlActions = ["Analyze", "Explain", "Big-O", "Security", "A11y", "SEO Audit"];
      if (htmlActions.includes(action)) {
        logToSystem(`<div class="text-[11px]"><b>${action}: <code>${currentFilename}</code></b><br><br>${response}</div>`, "success");
      } else if (action === "Smart Commit") {
        setCommitMsg(response.trim().replace(/["']/g, ""));
        logToSystem("✨ Commit-Message generiert.", "success");
      } else {
        const cleanContent = response.replace(/```[a-z]*\n?/gi, "").replace(/```\n?/g, "").trim();

        let newPath = currentFilename;
        if (action === "Diagram") newPath = currentFilename.split('.').slice(0,-1).join('.') + '-diagram.md';
        else if (action === "Mock Data") newPath = currentFilename.split('.').slice(0,-1).join('.') + '_mock.json';
        else if (action === "i18n") newPath = currentFilename.split('.').slice(0,-1).join('.') + '_i18n.json';
        else if (action === "cURL API") newPath = currentFilename.split('.').slice(0,-1).join('.') + '_endpoints.md';
        else if (action === "Dockerize") newPath = 'Dockerfile';
        else if (action === "SQL Schema") newPath = currentFilename.split('.').slice(0,-1).join('.') + '_schema.sql';
        else if (action === "TS Types") newPath = currentFilename.split('.').slice(0,-1).join('.') + '_types.ts';
        else if (action === "CI/CD") newPath = '.github/workflows/main.yml';
        else if (action === "Tutorial") newPath = currentFilename.split('.').slice(0,-1).join('.') + '_tutorial.md';
        else if (action === "Tests") {
          const parts = currentFilename.split('.');
          const ext = parts.pop();
          newPath = parts.join('.') + '.test.' + ext;
        } else if (action === "Auto-README") newPath = 'README.md';

        setCurrentFilename(newPath);
        setCurrentFileContent(cleanContent);
        setBatchFiles((prev) => {
          const idx = prev.findIndex((f) => f.path === newPath);
          if (idx >= 0) {
            const newBatch = [...prev];
            newBatch[idx] = { ...newBatch[idx], content: cleanContent };
            return newBatch;
          }
          return [...prev, { path: newPath, content: cleanContent }];
        });
        logToSystem(`✨ <code>${newPath}</code> via ${action} generiert/aktualisiert und zur Queue hinzugefügt!`, "success");
      }
    } catch (e: any) {
      logToSystem(`Fehler bei ${action}: ${e.message}`, "error");
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const userText = chatInput;
    setChatInput("");
    const sanitizedUserText = userText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    setChatHistory((prev) => [...prev, { text: `<b>Du:</b><br>${sanitizedUserText}`, type: "user" }]);

    try {
      const sysPrompt = "Du bist der Ouroboros Architect, ein hochintelligenter KI-Pair-Programmer. Antworte präzise, hilfsbereit und fokussiert auf Fragen des Entwicklers. Formatiere deine Antwort in einfachem HTML (nutze <b>, <i>, <code>, <ul>, <br>). Verwende KEIN Markdown, nur echtes HTML.";
      let context = currentFileContent ? `[Kontext - Aktuell geöffnete Datei: ${currentFilename}]\nCode Ausschnitt:\n${currentFileContent.substring(0, 1000)}\n\n` : "";
      const response = await callGeminiAPI(context + "User Frage: " + userText, sysPrompt);
      setChatHistory((prev) => [...prev, { text: `<b>✨ Architect:</b><br><div class="mt-1">${response}</div>`, type: "bot" }]);
    } catch (e: any) {
      logToSystem("Chat API Fehler: " + e.message, "error");
    }
  };

  const expandIdea = async () => {
    if(!architectInput.trim()) return;
    logToSystem("✨ <b>Erweitere Blueprint Idee...</b>", "info");
    try {
        const sysPrompt = "Du bist ein erfahrener Software Architekt. Der User gibt dir eine kurze Idee. Erweitere diese in eine detaillierte technische Spezifikation in wenigen Sätzen, die exakt beschreibt, welche Features, UI-Elemente und Logik-Komponenten gebaut werden sollen. Keine Begrüßungen.";
        const response = await callGeminiAPI(architectInput, sysPrompt);
        setArchitectInput(response);
        logToSystem("✨ Blueprint erfolgreich detailliert.", "success");
    } catch(e: any) {
        logToSystem("Fehler beim Erweitern: " + e.message, "error");
    }
  };

  const voiceExplain = async () => {
      if(!currentFileContent) return;
      logToSystem(`✨ <b>Generiere Audio-Erklärung für ${currentFilename}...</b>`, "info");
      try {
          const textPrompt = `Fasse den Zweck der Datei ${currentFilename} in maximal 3 kurzen Sätzen prägnant auf Deutsch zusammen. Formuliere es so, als würdest du es jemandem flüssig vorlesen.`;
          const scriptSys = "Du bist ein KI-Assistent. Antworte nur mit dem vorzulesenden Text, ohne Markdown.";
          const spokenText = await callGeminiAPI(textPrompt + `\n\nCode:\n${currentFileContent.substring(0, 2000)}`, scriptSys);

          logToSystem(`<i>🎙️ " ${spokenText} "</i>`, "info");

          const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-tts:generateContent?key=${geminiKey}`;
          const ttsResponse = await fetch(ttsUrl, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  contents: [{ parts: [{ text: spokenText }] }],
                  generationConfig: {
                      responseModalities: ["AUDIO"],
                      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
                  },
                  model: "gemini-2.0-flash-exp-tts"
              })
          });

          if (!ttsResponse.ok) throw new Error("TTS API Fehler");
          const ttsData = await ttsResponse.json();
          const base64Audio = ttsData.candidates[0].content.parts[0].inlineData.data;

          const binaryString = window.atob(base64Audio);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

          const sampleRate = 24000;
          const wavBuffer = new ArrayBuffer(44 + bytes.byteLength);
          const view = new DataView(wavBuffer);

          const writeString = (v: DataView, offset: number, str: string) => { for (let i=0; i<str.length; i++) v.setUint8(offset+i, str.charCodeAt(i)); };

          writeString(view, 0, 'RIFF');
          view.setUint32(4, 36 + bytes.byteLength, true);
          writeString(view, 8, 'WAVE');
          writeString(view, 12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          writeString(view, 36, 'data');
          view.setUint32(40, bytes.byteLength, true);

          new Uint8Array(wavBuffer, 44).set(bytes);

          const audioBlob = new Blob([view], { type: 'audio/wav' });
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audio.play();
      } catch(e: any) {
          logToSystem("Fehler bei Audio-Generierung: " + e.message, "error");
      }
  };

  const renderFileTree = () => {
    return fullTree.map((file) => (
      <div
        key={file.path}
        className={`flex items-center gap-2 p-2 text-xs cursor-pointer hover:bg-stone-100 ${
          currentFilename === file.path ? "bg-purple-50 text-purple-700 font-bold border-l-4 border-purple-600" : "text-stone-600"
        }`}
        onClick={() => handleFileSelect(file.path)}
      >
        <span className="shrink-0 text-stone-400">📄</span>
        <span className="truncate">{file.path}</span>
      </div>
    ));
  };

  const renderEditorContent = () => {
    if (isLoading) return <div className="p-4 text-stone-500 italic">Lade Datei...</div>;
    if (!currentFileContent) return <div className="p-4 text-stone-500 italic">// Bereit für Architekten-Aufträge...</div>;
    return currentFileContent.split("\n").map((line, idx) => (
      <div key={idx} className="flex gap-3 mb-0.5 font-mono text-[11px]">
        <span className="w-8 text-right text-stone-500 select-none border-r border-stone-800 pr-2">{idx + 1}</span>
        <span className="text-stone-300 whitespace-pre">{line}</span>
      </div>
    ));
  };

  return (
    <div className="flex flex-col h-full bg-stone-50 font-sans overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-white border-b border-stone-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
        <div>
          <h1 className="text-sm font-bold tracking-tight">SOVEREIGN<span className="text-purple-600">_STUDIO</span></h1>
          <div className="text-[9px] font-bold text-purple-600 uppercase tracking-widest">Architect Edition v2.0</div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="Gemini API Key"
            className="text-xs px-2 py-1 border border-stone-300 rounded w-32 md:w-48 focus:outline-none focus:border-purple-500"
          />
          <input
            type="password"
            value={ghPat}
            onChange={(e) => setGhPat(e.target.value)}
            placeholder="GitHub PAT"
            className="text-xs px-2 py-1 border border-stone-300 rounded w-32 md:w-48 focus:outline-none focus:border-purple-500"
          />
          {isArchitectActive && (
            <div className="text-[10px] font-bold text-purple-600 flex items-center gap-1">
              <span className="animate-ping w-1.5 h-1.5 bg-purple-500 rounded-full"></span> AGENT SCHWARM AKTIV...
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar / Explorer */}
        <div className={`flex-col bg-white border-r border-stone-200 w-full lg:w-80 shrink-0 ${activeTab === "explorer" ? "flex" : "hidden lg:flex"}`}>
          <div className="p-3 bg-stone-100 border-b border-stone-200 text-[10px] font-bold uppercase text-stone-500 flex justify-between">
            <span>📁 Projekt: {repoName}</span>
            <div className="flex gap-2">
                <button onClick={() => handleEditorAction("Auto-README")} className="hover:text-purple-600">✨ Auto-README</button>
                <button onClick={fetchRepoTree} className="hover:text-stone-800">🔄 Refresh</button>
            </div>
          </div>

          {/* Blueprint Input */}
          <div className="p-3 bg-purple-50 border-b border-purple-200 shrink-0">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-[11px] font-bold text-purple-800">⚡ ARCHITECT BLUEPRINT</h3>
                <button onClick={expandIdea} className="text-[9px] font-bold bg-purple-200 text-purple-800 px-2 py-0.5 rounded hover:bg-purple-300 transition-colors shadow-sm">✨ Expand Idea</button>
            </div>
            <textarea
              rows={4}
              value={architectInput}
              onChange={(e) => setArchitectInput(e.target.value)}
              className="w-full p-2 text-[11px] border border-purple-200 rounded focus:outline-none focus:border-purple-500 resize-none shadow-inner"
              placeholder="Baue Modul X: Feature Y..."
            ></textarea>
            <button
              onClick={runArchitect}
              disabled={isArchitectActive}
              className="mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded text-[11px] font-bold uppercase shadow-sm transition-colors disabled:opacity-50"
            >
              Projekt Generieren
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {renderFileTree()}
          </div>
        </div>

        {/* Editor Area */}
        <div className={`flex-col flex-1 min-w-0 bg-stone-100/30 ${activeTab === "editor" ? "flex" : "hidden lg:flex"}`}>
          <div className="h-10 bg-stone-50 border-b border-stone-200 flex items-center justify-between px-4 shrink-0 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-2 whitespace-nowrap py-1">
              <span className="text-[11px] font-mono text-stone-600 italic mr-2 truncate max-w-[150px]">{currentFilename}</span>
              <button onClick={() => handleEditorAction("Analyze")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold">✨ Analyze</button>
              <button onClick={() => handleEditorAction("Explain")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold">✨ Explain</button>
              <button onClick={voiceExplain} className="shrink-0 text-[10px] bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200 font-bold">✨ Voice Explain</button>
              <button onClick={() => handleEditorAction("Translate")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold">✨ Translate</button>
              <button onClick={() => handleEditorAction("Refactor")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold">✨ Refactor</button>
              <button onClick={() => handleEditorAction("Auto-Fix")} className="shrink-0 text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 font-bold">✨ Auto-Fix</button>
              <button onClick={() => handleEditorAction("Big-O")} className="shrink-0 text-[10px] bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 font-bold">✨ Big-O</button>
              <button onClick={() => handleEditorAction("Diagram")} className="shrink-0 text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-200 font-bold">✨ Diagram</button>
              <button onClick={() => handleEditorAction("Security")} className="shrink-0 text-[10px] bg-orange-100 text-orange-700 px-2 py-1 rounded hover:bg-orange-200 font-bold">✨ Security</button>
              <button onClick={() => handleEditorAction("Mock Data")} className="shrink-0 text-[10px] bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200 font-bold">✨ Mock Data</button>
              <button onClick={() => handleEditorAction("A11y")} className="shrink-0 text-[10px] bg-teal-100 text-teal-700 px-2 py-1 rounded hover:bg-teal-200 font-bold">✨ A11y</button>
              <button onClick={() => handleEditorAction("i18n")} className="shrink-0 text-[10px] bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200 font-bold">✨ i18n</button>
              <button onClick={() => handleEditorAction("cURL API")} className="shrink-0 text-[10px] bg-cyan-100 text-cyan-700 px-2 py-1 rounded hover:bg-cyan-200 font-bold">✨ cURL API</button>
              <button onClick={() => handleEditorAction("Tailwind")} className="shrink-0 text-[10px] bg-sky-100 text-sky-700 px-2 py-1 rounded hover:bg-sky-200 font-bold">✨ Tailwind</button>
              <button onClick={() => handleEditorAction("Dockerize")} className="shrink-0 text-[10px] bg-slate-100 text-slate-700 px-2 py-1 rounded hover:bg-slate-200 font-bold">✨ Dockerize</button>
              <button onClick={() => handleEditorAction("SEO Audit")} className="shrink-0 text-[10px] bg-fuchsia-100 text-fuchsia-700 px-2 py-1 rounded hover:bg-fuchsia-200 font-bold">✨ SEO Audit</button>
              <button onClick={() => handleEditorAction("SQL Schema")} className="shrink-0 text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200 font-bold">✨ SQL Schema</button>
              <button onClick={() => handleEditorAction("TS Types")} className="shrink-0 text-[10px] bg-lime-100 text-lime-700 px-2 py-1 rounded hover:bg-lime-200 font-bold">✨ TS Types</button>
              <button onClick={() => handleEditorAction("CI/CD")} className="shrink-0 text-[10px] bg-rose-100 text-rose-700 px-2 py-1 rounded hover:bg-rose-200 font-bold">✨ CI/CD</button>
              <button onClick={() => handleEditorAction("Tutorial")} className="shrink-0 text-[10px] bg-violet-100 text-violet-700 px-2 py-1 rounded hover:bg-violet-200 font-bold">✨ Tutorial</button>
              <button onClick={() => handleEditorAction("Docs")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold">✨ Docs</button>
              <button onClick={() => handleEditorAction("Tests")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold">✨ Tests</button>
            </div>
          </div>

          <div className="flex-1 p-2 lg:p-4 overflow-hidden flex flex-col">
            <div className="bg-[#0c0a09] flex-1 rounded-xl shadow-inner relative overflow-hidden flex flex-col p-3 overflow-y-auto custom-scrollbar">
               {renderEditorContent()}
            </div>
          </div>

          {/* Batch Commit Bar */}
          <div className="h-16 border-t border-purple-200 px-4 flex items-center justify-between bg-purple-50 shrink-0 gap-4">
            <div className="truncate flex-1">
              <h4 className="text-[10px] font-black text-purple-700 uppercase">GitOps Warteschlange</h4>
              <p className="text-[10px] text-purple-600 italic truncate mb-1">{batchFiles.length} Dateien bereit für Massen-Commit.</p>
              <div className="flex gap-2 items-center">
                <input
                    type="text"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="Commit Nachricht..."
                    className="text-[10px] w-full px-2 py-1 border border-purple-200 rounded bg-white focus:outline-none"
                    disabled={batchFiles.length === 0}
                />
                <button onClick={() => handleEditorAction("Smart Commit")} disabled={batchFiles.length === 0} className="shrink-0 text-[11px] bg-purple-200 text-purple-800 px-2 py-1 rounded hover:bg-purple-300 font-bold disabled:opacity-50 shadow-sm transition-colors">✨</button>
              </div>
            </div>
            <button
              onClick={handlePush}
              disabled={batchFiles.length === 0 || isPushing}
              className={`shrink-0 px-4 py-2 rounded-lg font-bold text-[10px] uppercase transition-all ${
                batchFiles.length > 0 ? "bg-purple-600 text-white hover:bg-purple-700" : "bg-stone-300 text-stone-500 cursor-not-allowed"
              }`}
            >
              {isPushing ? "Pushing..." : "🚀 API MASS PUSH"}
            </button>
          </div>
        </div>

        {/* Chat Log */}
        <div className={`flex-col bg-white border-l border-stone-200 w-full lg:w-80 shrink-0 ${activeTab === "chat" ? "flex" : "hidden lg:flex"}`}>
          <div className="p-3 bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-800 flex items-center gap-2 shrink-0">
            <span className="text-purple-600">✨</span> SYSTEM LOG
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white text-[11px] custom-scrollbar">
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`p-3 rounded-xl border leading-normal ${
                  msg.type === "user" ? "bg-purple-100 border-purple-200 text-purple-800 ml-4 rounded-tr-none" :
                  msg.type === "bot" ? "bg-stone-50 border-stone-200 text-stone-700 mr-4 rounded-tl-none" :
                  msg.type === "error" ? "bg-red-50 border-red-200 text-red-800 rounded-tl-none" :
                  msg.type === "success" ? "bg-green-50 border-green-200 text-green-800 rounded-tl-none" :
                  msg.type === "warning" ? "bg-orange-50 border-orange-200 text-orange-800 rounded-tl-none" :
                  "bg-stone-100 border-stone-200 text-stone-700 rounded-tl-none"
                }`}
                dangerouslySetInnerHTML={{ __html: msg.text }}
              />
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-3 bg-stone-50 border-t border-stone-200 shrink-0 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
              placeholder="Frag den Architekten..."
              className="flex-1 text-[11px] px-2 py-1.5 border border-stone-300 rounded focus:outline-none focus:border-purple-500"
            />
            <button onClick={handleSendChat} className="bg-purple-600 text-white px-3 py-1.5 rounded text-[11px] font-bold hover:bg-purple-700 transition-colors">✨</button>
          </div>
        </div>
      </main>

      {/* Mobile Nav */}
      <nav className="h-14 bg-white border-t border-stone-200 flex items-center justify-around shrink-0 lg:hidden">
        <button onClick={() => setActiveTab("explorer")} className={`flex flex-col items-center gap-1 w-1/3 ${activeTab === "explorer" ? "text-purple-600" : "text-stone-400"}`}>
          <span className="text-lg">📁</span><span className="text-[9px] uppercase font-bold">Planung</span>
        </button>
        <button onClick={() => setActiveTab("editor")} className={`flex flex-col items-center gap-1 w-1/3 ${activeTab === "editor" ? "text-purple-600" : "text-stone-400"}`}>
          <span className="text-lg">💻</span><span className="text-[9px] uppercase font-bold">Code</span>
        </button>
        <button onClick={() => setActiveTab("chat")} className={`flex flex-col items-center gap-1 w-1/3 ${activeTab === "chat" ? "text-purple-600" : "text-stone-400"}`}>
          <span className="text-lg">✨</span><span className="text-[9px] uppercase font-bold">Log</span>
        </button>
      </nav>

      <style dangerouslySetInnerHTML={{ __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 4px; }
      `}} />
    </div>
  );
};
