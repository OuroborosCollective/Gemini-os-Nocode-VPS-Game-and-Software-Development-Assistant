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

interface LogEntry {
  text: string;
  type: "info" | "error" | "success" | "warning";
}

interface ArchitectPlanItem {
  path: string;
  task: string;
}

export const ArchitectPanel: React.FC = () => {
  const modelName = "gemini-2.0-flash-exp";
  // In Vite, process.env is replaced by define in config.
  // We use a fallback to empty string if not defined.
  const apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || "";

  const [ghPat, setGhPat] = useState("");
  const [repoOwner, setRepoOwner] = useState("OuroborosCollective");
  const [repoName, setRepoName] = useState("Wasd");

  const [activeTab, setActiveTab] = useState<"explorer" | "editor" | "chat">("explorer");
  const [fullTree, setFullTree] = useState<FileItem[]>([]);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("Keine Datei gewählt");
  const [currentFileContent, setCurrentFileContent] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      text: "<strong>Architect API geladen.</strong><br>Gib oben deinen GitHub PAT ein. Füge einen Blueprint aus deinen PDFs links in das Feld ein. Ich zerlege das Projekt in Einzelschritte, programmiere alle Dateien durch und pushe sie über die REST API als ein großes Modul.",
      type: "info"
    }
  ]);

  const [architectInput, setArchitectInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [isRouting, setIsRouting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isGeneratingCommitMsg, setIsGeneratingCommitMsg] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const logToSystem = (text: string, type: LogEntry["type"] = "info") => {
    // Sanitize basic tags we expect from LLM but prevent others if needed.
    // For now, trusting the internal log generator but using dangerouslySetInnerHTML requires caution.
    setLogs(prev => [...prev, { text, type }]);
    if (type === "error" && window.innerWidth < 1024) {
      setActiveTab("chat");
    }
  };

  const callGeminiAPI = async (prompt: string, system: string, customModel?: string) => {
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set. Please check your environment variables.");
    }
    const targetModel = customModel || modelName;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] }
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Gemini API Error: ${response.status} - ${err.error?.message || "Unknown error"}`);
    }
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  };

  const fetchRepoTree = useCallback(async () => {
    try {
      const headers: HeadersInit = ghPat ? { 'Authorization': `token ${ghPat}` } : {};
      let response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/main?recursive=1`, { headers });

      if (!response.ok) {
        response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/master?recursive=1`, { headers });
        if (!response.ok) throw new Error("Repo Tree konnte weder von main noch von master geladen werden.");
      }

      const data = await response.json();
      const tree = data.tree.filter((item: any) => item.type === "blob").map((item: any) => ({
        path: item.path,
        type: item.type
      }));
      setFullTree(tree);
    } catch (err: any) {
      logToSystem(`<b>GitHub Ladefehler:</b> ${err.message}. Ist das Repo privat? Dann erst PAT oben eingeben!`, "warning");
    }
  }, [ghPat, repoOwner, repoName]);

  useEffect(() => {
    fetchRepoTree();
  }, [fetchRepoTree]);

  const fetchFileContent = async (path: string) => {
    try {
      const headers: HeadersInit = ghPat ? { 'Authorization': `token ${ghPat}` } : {};
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

  const handleSelectFile = async (path: string) => {
    setCurrentFile(path);
    setIsLoadingFile(true);
    setActiveTab("editor");
    const content = await fetchFileContent(path);
    setCurrentFileContent(content);
    setIsLoadingFile(false);
  };

  const runArchitect = async () => {
    if (!architectInput.trim()) return;
    setIsRouting(true);
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
      const plan: ArchitectPlanItem[] = JSON.parse(cleanPlan);

      logToSystem(`<b>Projektplan erstellt:</b><br>${plan.length} Dateien müssen bearbeitet werden. Compiler übernimmt...`, "info");

      const newBatchFiles: BatchFile[] = [...batchFiles];

      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        logToSystem(`⏳ Bearbeite: <code>${step.path}</code>...`, "info");
        setCurrentFile(step.path);
        setIsLoadingFile(true);
        setActiveTab("editor");

        const existingCode = await fetchFileContent(step.path);

        const compilerSys = `Du bist ein reiner TypeScript/JavaScript/HTML Compiler. KEINE EMOTIONEN. GIB NUR EXECUTABLE CODE ZURÜCK. KEIN MARKDOWN. GIB IMMER DIE KOMPLETTE DATEI ZURÜCK.`;
        const compilerPrompt = `Datei: ${step.path}\nBisheriger Code:\n${existingCode || "// Neue Datei"}\n\nAufgabe: ${step.task}\n\nAntworte nur mit dem vollständigen Code.`;

        let newCode = await callGeminiAPI(compilerPrompt, compilerSys);
        newCode = newCode.replace(/```typescript\n?/gi, "").replace(/```javascript\n?/gi, "").replace(/```tsx\n?/gi, "").replace(/```html\n?/gi, "").replace(/```\n?/g, "").trim();

        const existingIdx = newBatchFiles.findIndex(f => f.path === step.path);
        if (existingIdx >= 0) {
            newBatchFiles[existingIdx].content = newCode;
        } else {
            newBatchFiles.push({ path: step.path, content: newCode });
        }

        setCurrentFileContent(newCode);
        setIsLoadingFile(false);
        logToSystem(`✅ <code>${step.path}</code> fertiggestellt.`, "success");
      }

      setBatchFiles(newBatchFiles);
      setCommitMsg(`Architect Deploy: Module Update (${newBatchFiles.length} files)`);
      setActiveTab("chat");
      logToSystem(`🎉 <b>Projekt-Modul lokal generiert!</b><br>Gib oben deinen PAT ein und klicke auf 'API MASS PUSH', um das komplette Projekt live zu schalten.`, "success");

    } catch (err: any) {
      logToSystem(`<b>Kritischer Fehler:</b> ${err.message}`, "error");
    } finally {
      setIsRouting(false);
    }
  };

  const handleMassPush = async () => {
    if (!ghPat.trim()) {
      logToSystem("🚨 <b>Fehler:</b> Bitte gib oben deinen GitHub Personal Access Token (PAT) ein!", "error");
      return;
    }
    if (batchFiles.length === 0) return;

    setIsPushing(true);
    logToSystem("🚀 <b>Starte sicheren Multi-File Commit...</b>", "info");
    setActiveTab("chat");

    try {
      const headers = {
        'Authorization': `token ${ghPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      logToSystem("🔍 [1/5] Suche Branch-Referenz...", "info");
      let branchPath = 'heads/main';
      let refRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/${branchPath}`, { headers });

      if (!refRes.ok) {
        branchPath = 'heads/master';
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
      const tree = batchFiles.map(f => ({
        path: f.path.replace(/^\/+/, ""),
        mode: "100644",
        type: "blob",
        content: f.content
      }));

      const newTreeRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/trees`, {
        method: "POST", headers, body: JSON.stringify({ base_tree: baseTreeSha, tree })
      });
      if (!newTreeRes.ok) {
        const err = await newTreeRes.json();
        throw new Error(`Tree-Erstellung fehlgeschlagen: ${err.message}`);
      }
      const newTreeData = await newTreeRes.json();

      logToSystem("✍️ [4/5] Signiere Commit...", "info");
      const finalMsg = commitMsg || `Architect Update (${batchFiles.length} files)`;
      const newCommitRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/commits`, {
        method: "POST", headers, body: JSON.stringify({
          message: finalMsg,
          tree: newTreeData.sha,
          parents: [commitSha]
        })
      });
      if (!newCommitRes.ok) {
        const err = await newCommitRes.json();
        throw new Error(`Commit konnte nicht erstellt werden: ${err.message}`);
      }
      const newCommitData = await newCommitRes.json();

      logToSystem("🚀 [5/5] Pushe Commit in Repository...", "info");
      const updateRefRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/${branchPath}`, {
        method: "PATCH", headers, body: JSON.stringify({ sha: newCommitData.sha, force: false })
      });
      if (!updateRefRes.ok) {
        const err = await updateRefRes.json();
        throw new Error(`Push verweigert! (API: ${err.message})`);
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

  const handleExpandBlueprint = async () => {
    if (!architectInput.trim()) {
      logToSystem("Bitte gib zuerst ein grobes Stichwort oder eine Idee ein.", "error");
      return;
    }
    logToSystem("✨ <b>Erweitere Blueprint Idee...</b>", "info");
    try {
      const sysPrompt = "Du bist ein erfahrener Software Architekt. Der User gibt dir eine kurze, rudimentäre Idee. Erweitere diese in eine detaillierte technische Spezifikation in wenigen Sätzen. Keine Begrüßungen.";
      const response = await callGeminiAPI(architectInput, sysPrompt);
      setArchitectInput(response);
      logToSystem("✨ Blueprint erfolgreich detailliert.", "success");
    } catch (e: any) {
      logToSystem("Fehler beim Erweitern: " + e.message, "error");
    }
  };

  const handleAIAction = async (action: string, sysPrompt: string, options: { isCodeUpdate?: boolean, newExtension?: string, outputFilename?: string } = {}) => {
    if (!currentFileContent && !options.outputFilename) return;
    logToSystem(`✨ <b>Führe ${action} für ${currentFile}... durch</b>`, "info");
    if (!options.isCodeUpdate) setActiveTab("chat");
    try {
      let response = await callGeminiAPI(`Datei: ${currentFile}\n\nCode:\n${currentFileContent}`, sysPrompt);

      if (options.isCodeUpdate || options.newExtension || options.outputFilename) {
        response = response.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();

        let targetFile = currentFile;
        if (options.outputFilename) {
            targetFile = options.outputFilename;
        } else if (options.newExtension) {
            const parts = currentFile.split('.');
            if (parts.length > 1) parts.pop();
            targetFile = parts.join('.') + `.${options.newExtension}`;
        }

        setCurrentFile(targetFile);
        setCurrentFileContent(response);
        setBatchFiles(prev => {
          const idx = prev.findIndex(f => f.path === targetFile);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], content: response };
            return next;
          }
          return [...prev, { path: targetFile, content: response }];
        });
        setActiveTab("editor");
        logToSystem(`✨ ${action} abgeschlossen und zur Queue hinzugefügt: <code>${targetFile}</code>`, "success");
      } else {
        logToSystem(`<div class="text-[11px]"><b>${action}: <code>${currentFile}</code></b><br><br>${response}</div>`, "success");
      }
    } catch (e: any) {
      logToSystem(`Fehler bei ${action}: ` + e.message, "error");
    }
  };

  const handleVoiceExplain = async () => {
    if (!currentFileContent) return;
    logToSystem(`✨ <b>Generiere Audio-Erklärung für ${currentFile}...</b>`, "info");
    try {
      const textPrompt = `Fasse den Zweck der Datei ${currentFile} in maximal 3 kurzen Sätzen prägnant auf Deutsch zusammen.`;
      const spokenText = await callGeminiAPI(textPrompt + `\n\nCode:\n${currentFileContent.substring(0, 2000)}`, "Du bist ein KI-Assistent. Antworte nur mit dem vorzulesenden Text, ohne Markdown.");
      logToSystem(`<i>🎙️ " ${spokenText} "</i>`, "info");

      const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;
      const ttsResponse = await fetch(ttsUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: spokenText }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
          }
        })
      });

      if (!ttsResponse.ok) throw new Error("TTS API Fehler");
      const ttsData = await ttsResponse.json();
      const base64Audio = ttsData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Keine Audio-Daten erhalten.");

      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

      const sampleRate = 24000;
      const wavBuffer = new ArrayBuffer(44 + bytes.byteLength);
      const view = new DataView(wavBuffer);
      const writeString = (v: DataView, offset: number, str: string) => { for (let i=0; i<str.length; i++) v.setUint8(offset+i, str.charCodeAt(i)); };
      writeString(view, 0, "RIFF");
      view.setUint32(4, 36 + bytes.byteLength, true);
      writeString(view, 8, "WAVE");
      writeString(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, "data");
      view.setUint32(40, bytes.byteLength, true);
      new Uint8Array(wavBuffer, 44).set(bytes);

      const audioBlob = new Blob([view], { type: "audio/wav" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play();
    } catch (e: any) {
      logToSystem("Fehler bei Audio-Generierung: " + e.message, "error");
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const userText = chatInput;
    setChatInput("");
    setLogs(prev => [...prev, { text: `<b>Du:</b><br>${userText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`, type: "info" }]);

    try {
      const sysPrompt = "Du bist der Ouroboros Architect, ein hochintelligenter KI-Pair-Programmer. Antworte präzise, hilfsbereit und fokussiert. Formatiere deine Antwort in einfachem HTML (nutze <b>, <i>, <code>, <ul>, <br>). Verwende KEIN Markdown.";
      let context = "";
      if (currentFileContent && currentFile !== "Keine Datei gewählt") {
        context = `[Kontext - Aktuell geöffnete Datei: ${currentFile}]\nCode Ausschnitt:\n${currentFileContent.substring(0, 1000)}\n\n`;
      }
      const response = await callGeminiAPI(context + "User Frage: " + userText, sysPrompt);
      setLogs(prev => [...prev, { text: `<b>✨ Architect:</b><br><div class="mt-1">${response}</div>`, type: "info" }]);
    } catch (e: any) {
      logToSystem("Chat API Fehler: " + e.message, "error");
    }
  };

  const handleSmartCommit = async () => {
    if (batchFiles.length === 0) return;
    logToSystem("✨ <b>Generiere Smart Commit-Message...</b>", "info");
    setIsGeneratingCommitMsg(true);

    try {
      const sysPrompt = "Du bist ein Git-Experte. Generiere EINE EINZIGE präzise, professionelle 'Conventional Commit' Message (max 70 Zeichen) basierend auf der Liste der geänderten Dateien. Gib NUR die Commit Message zurück, sonst nichts. Beispiel: 'feat: add user authentication module'";
      const changesSummary = batchFiles.map(f => `Datei: ${f.path}\nSnippet: ${f.content.substring(0, 100)}...`).join("\n\n");

      const response = await callGeminiAPI(`Geänderte Dateien:\n${changesSummary}`, sysPrompt);
      setCommitMsg(response.trim().replace(/["']/g, ""));
      logToSystem("✨ Commit-Message aus Code-Änderungen generiert.", "success");
    } catch (e: any) {
      logToSystem("Fehler bei Msg-Generierung: " + e.message, "error");
    } finally {
      setIsGeneratingCommitMsg(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50 font-sans text-stone-900 overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-white border-b border-stone-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-50">
        <div>
          <h1 className="text-sm font-bold tracking-tight">SOVEREIGN<span className="text-purple-600">_STUDIO</span></h1>
          <div className="text-[9px] font-bold text-purple-600 uppercase tracking-widest">Architect Edition v2.0</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-0.5">
            <input
              type="text"
              value={repoOwner}
              onChange={e => setRepoOwner(e.target.value)}
              placeholder="Repo Owner"
              className="text-[8px] px-1.5 py-0.5 border border-stone-200 rounded w-32 focus:outline-none focus:border-purple-500"
            />
            <input
              type="text"
              value={repoName}
              onChange={e => setRepoName(e.target.value)}
              placeholder="Repo Name"
              className="text-[8px] px-1.5 py-0.5 border border-stone-200 rounded w-32 focus:outline-none focus:border-purple-500"
            />
          </div>
          <input
            type="password"
            value={ghPat}
            onChange={e => setGhPat(e.target.value)}
            placeholder="GitHub PAT"
            className="text-xs px-2 py-1 border border-stone-300 rounded w-40 focus:outline-none focus:border-purple-500"
          />
          {isRouting && (
            <div className="text-[10px] font-bold text-purple-600 flex items-center gap-1">
              <span className="animate-ping w-1.5 h-1.5 bg-purple-500 rounded-full"></span> AGENT SCHWARM AKTIV...
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Tab 1: Explorer & Architect */}
        <div className={`app-view lg:w-[320px] shrink-0 ${activeTab === "explorer" ? "flex" : "hidden lg:flex"} flex-col h-full border-r border-stone-200`}>
          <div className="p-3 bg-stone-100 border-b border-stone-200 text-[10px] font-bold uppercase text-stone-500 flex justify-between shrink-0">
            <span>📁 Projekt: {repoName}</span>
            <div className="flex gap-2">
              <button onClick={() => handleAIAction("Auto-README", "Generiere eine professionelle README.md. Antworte NUR mit dem Inhalt.", { outputFilename: "README.md" })} className="hover:text-purple-600 transition-colors">✨ Auto-README</button>
              <button onClick={fetchRepoTree} className="hover:text-stone-800">🔄 Refresh</button>
            </div>
          </div>

          <div className="p-3 bg-purple-50 border-b border-purple-200 shrink-0">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-[11px] font-bold text-purple-800">⚡ ARCHITECT BLUEPRINT</h3>
              <button onClick={handleExpandBlueprint} className="text-[9px] font-bold bg-purple-200 text-purple-800 px-2 py-0.5 rounded hover:bg-purple-300 transition-colors shadow-sm">✨ Expand Idea</button>
            </div>
            <textarea
              value={architectInput}
              onChange={e => setArchitectInput(e.target.value)}
              rows={4}
              className="w-full p-2 text-[11px] border border-purple-200 rounded focus:outline-none focus:border-purple-500 resize-none shadow-inner"
              placeholder="Kopiere Modul-Texte aus dem PDF hierher..."
            />
            <button
              onClick={runArchitect}
              disabled={isRouting}
              className="mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded text-[11px] font-bold uppercase shadow-sm transition-colors disabled:opacity-50"
            >
              {isRouting ? "Generiere..." : "Projekt Generieren"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white custom-scrollbar">
            {fullTree.length === 0 ? (
              <div className="p-4 text-xs italic text-stone-400">Lade Repository...</div>
            ) : (
              fullTree.map(file => (
                <div
                  key={file.path}
                  onClick={() => handleSelectFile(file.path)}
                  className={`architect-file-tree-item ${currentFile === file.path ? "active-file" : ""}`}
                >
                  <span className="shrink-0 text-stone-400">📄</span>
                  <span className="truncate">{file.path}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tab 2: Editor & Batch Queue */}
        <div className={`app-view flex-1 min-w-0 ${activeTab === "editor" ? "flex" : "hidden lg:flex"} flex-col h-full bg-stone-50`}>
          <div className="h-10 bg-stone-50 border-b border-stone-200 flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar whitespace-nowrap pb-1">
              <span className="text-[11px] font-mono text-stone-600 italic mr-2 truncate max-w-[150px]">{currentFile}</span>
              {currentFile !== "Keine Datei gewählt" && (
                <>
                  <button onClick={() => handleAIAction("Review", "Senior Code Reviewer. Analysiere Bugs/Security. HTML.")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold shadow-sm transition-all">✨ Analyze</button>
                  <button onClick={() => handleAIAction("Explain", "Mentor. Erkläre Code. HTML.")} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold shadow-sm transition-all">✨ Explain</button>
                  <button onClick={handleVoiceExplain} className="shrink-0 text-[10px] bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200 font-bold shadow-sm transition-all">✨ Voice Explain</button>
                  <button onClick={() => {
                      const lang = prompt("Zielsprache (python, rust, go, javascript, typescript)?");
                      if (lang) handleAIAction("Translate", `Übersetze nach ${lang}. NUR CODE.`, { newExtension: lang });
                  }} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold shadow-sm transition-all">✨ Translate</button>
                  <button onClick={() => handleAIAction("Refactor", "Clean Code. Refaktorisiere. NUR CODE.", { isCodeUpdate: true })} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold shadow-sm transition-all">✨ Refactor</button>
                  <button onClick={() => handleAIAction("Auto-Fix", "Debugge und behebe Fehler. NUR CODE.", { isCodeUpdate: true })} className="shrink-0 text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 font-bold shadow-sm transition-all">✨ Auto-Fix</button>
                  <button onClick={() => handleAIAction("Big-O", "Analysiere Time/Space Complexity. HTML.")} className="shrink-0 text-[10px] bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 font-bold shadow-sm transition-all">✨ Big-O</button>
                  <button onClick={() => handleAIAction("Diagram", "Erstelle Mermaid Diagramm in Markdown. NUR MARKDOWN.", { newExtension: "md" })} className="shrink-0 text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-200 font-bold shadow-sm transition-all">✨ Diagram</button>
                  <button onClick={() => handleAIAction("Security", "Security Experte. OWASP Scan. HTML.")} className="shrink-0 text-[10px] bg-orange-100 text-orange-700 px-2 py-1 rounded hover:bg-orange-200 font-bold shadow-sm transition-all">✨ Security</button>
                  <button onClick={() => handleAIAction("Mock Data", "Generiere 5 Mock-Objekte als JSON. NUR JSON.", { newExtension: "json" })} className="shrink-0 text-[10px] bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200 font-bold shadow-sm transition-all">✨ Mock Data</button>
                  <button onClick={() => handleAIAction("A11y", "WCAG Experte. Prüfe A11y. HTML.")} className="shrink-0 text-[10px] bg-teal-100 text-teal-700 px-2 py-1 rounded hover:bg-teal-200 font-bold shadow-sm transition-all">✨ A11y</button>
                  <button onClick={() => handleAIAction("i18n", "Extrahiere Strings als JSON. NUR JSON.", { newExtension: "json" })} className="shrink-0 text-[10px] bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200 font-bold shadow-sm transition-all">✨ i18n</button>
                  <button onClick={() => handleAIAction("cURL API", "Generiere cURL Befehle in Markdown. NUR MARKDOWN.", { newExtension: "md" })} className="shrink-0 text-[10px] bg-cyan-100 text-cyan-700 px-2 py-1 rounded hover:bg-cyan-200 font-bold shadow-sm transition-all">✨ cURL API</button>
                  <button onClick={() => handleAIAction("Tailwind", "Konvertiere Styles zu Tailwind. NUR CODE.", { isCodeUpdate: true })} className="shrink-0 text-[10px] bg-sky-100 text-sky-700 px-2 py-1 rounded hover:bg-sky-200 font-bold shadow-sm transition-all">✨ Tailwind</button>
                  <button onClick={() => handleAIAction("Dockerize", "Generiere Dockerfile. NUR CODE.", { outputFilename: "Dockerfile" })} className="shrink-0 text-[10px] bg-slate-100 text-slate-700 px-2 py-1 rounded hover:bg-slate-200 font-bold shadow-sm transition-all">✨ Dockerize</button>
                  <button onClick={() => handleAIAction("SEO Audit", "SEO Experte. Analysiere Meta/Semantik. HTML.")} className="shrink-0 text-[10px] bg-fuchsia-100 text-fuchsia-700 px-2 py-1 rounded hover:bg-fuchsia-200 font-bold shadow-sm transition-all">✨ SEO Audit</button>
                  <button onClick={() => handleAIAction("SQL Schema", "SQL Experte. Generiere Schema (Postgres). NUR SQL.", { newExtension: "sql" })} className="shrink-0 text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200 font-bold shadow-sm transition-all">✨ SQL Schema</button>
                  <button onClick={() => handleAIAction("TS Types", "TS Experte. Generiere Interfaces. NUR CODE.", { newExtension: "ts" })} className="shrink-0 text-[10px] bg-lime-100 text-lime-700 px-2 py-1 rounded hover:bg-lime-200 font-bold shadow-sm transition-all">✨ TS Types</button>
                  <button onClick={() => handleAIAction("CI/CD", "DevOps. Generiere GitHub Actions. NUR YAML.", { outputFilename: ".github/workflows/main.yml" })} className="shrink-0 text-[10px] bg-rose-100 text-rose-700 px-2 py-1 rounded hover:bg-rose-200 font-bold shadow-sm transition-all">✨ CI/CD</button>
                  <button onClick={() => handleAIAction("Tutorial", "Blogger. Schreibe Tutorial in Markdown. NUR MARKDOWN.", { newExtension: "md" })} className="shrink-0 text-[10px] bg-violet-100 text-violet-700 px-2 py-1 rounded hover:bg-violet-200 font-bold shadow-sm transition-all">✨ Tutorial</button>
                  <button onClick={() => handleAIAction("Docs", "Füge JSDoc Kommentare hinzu. NUR CODE.", { isCodeUpdate: true })} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold shadow-sm transition-all">✨ Docs</button>
                  <button onClick={() => handleAIAction("Tests", "Schreibe Unit-Tests. NUR CODE.", { isCodeUpdate: true })} className="shrink-0 text-[10px] bg-stone-200 text-stone-700 px-2 py-1 rounded hover:bg-stone-300 font-bold shadow-sm transition-all">✨ Tests</button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 bg-stone-100/30 p-2 lg:p-4 overflow-hidden flex flex-col">
            <div className="architect-editor-bg flex-1 rounded-xl shadow-inner relative overflow-hidden flex flex-col">
              <div className="flex-1 overflow-auto p-3 text-[12px] text-stone-300 whitespace-pre custom-scrollbar">
                {isLoadingFile ? (
                  <div className="text-stone-500 italic">Lade {currentFile}...</div>
                ) : currentFileContent ? (
                  currentFileContent.split("\n").map((line, idx) => (
                    <div key={idx} className="architect-code-line">
                      <span className="architect-line-number">{idx + 1}</span>
                      <span className="text-stone-300">{line}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-stone-500 italic">// Bereit für Architekten-Aufträge...</div>
                )}
              </div>
            </div>
          </div>

          <div className="h-16 border-t border-purple-200 px-4 flex items-center justify-between bg-purple-50 shrink-0 gap-4">
            <div className="truncate flex-1">
              <h4 className="text-[10px] font-black text-purple-700 uppercase">GitOps Warteschlange</h4>
              <p className="text-[10px] text-purple-600 italic truncate mb-1">{batchFiles.length} Dateien bereit für Massen-Commit.</p>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={commitMsg}
                  onChange={e => setCommitMsg(e.target.value)}
                  placeholder="Commit Nachricht..."
                  className="text-[10px] w-full px-2 py-1 border border-purple-200 rounded bg-white"
                  disabled={batchFiles.length === 0}
                />
                <button
                  onClick={handleSmartCommit}
                  disabled={batchFiles.length === 0 || isGeneratingCommitMsg}
                  title="Commit Message generieren"
                  className="shrink-0 text-[11px] bg-purple-200 text-purple-800 px-2 py-1 rounded hover:bg-purple-300 font-bold disabled:opacity-50 shadow-sm transition-colors"
                >
                  {isGeneratingCommitMsg ? "⏳" : "✨"}
                </button>
              </div>
            </div>
            <button
              onClick={handleMassPush}
              disabled={batchFiles.length === 0 || isPushing}
              className={`shrink-0 px-4 py-2 rounded-lg font-bold text-[10px] uppercase transition-all ${batchFiles.length > 0 ? "bg-purple-600 text-white" : "bg-stone-300 text-stone-500 cursor-not-allowed"}`}
            >
              {isPushing ? "PUSHING..." : "🚀 API MASS PUSH"}
            </button>
          </div>
        </div>

        {/* Tab 3: Chat Log */}
        <div className={`app-view lg:w-[320px] shrink-0 ${activeTab === "chat" ? "flex" : "hidden lg:flex"} flex-col h-full border-l border-stone-200`}>
          <div className="p-3 bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-800 flex items-center gap-2 shrink-0">
            <span className="text-purple-600">✨</span> SYSTEM LOG
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white text-[11px] custom-scrollbar">
            {logs.map((log, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl rounded-tl-none border leading-normal ${
                  log.type === "error" ? "bg-red-50 border-red-200 text-red-800" :
                  log.type === "success" ? "bg-green-50 border-green-200 text-green-800" :
                  log.type === "warning" ? "bg-orange-50 border-orange-200 text-orange-800" :
                  "bg-stone-100 border-stone-200 text-stone-700"
                }`}
                dangerouslySetInnerHTML={{ __html: log.text }}
              />
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-3 bg-stone-50 border-t border-stone-200 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyPress={e => e.key === "Enter" && handleSendChat()}
                placeholder="Frag den Architekten..."
                className="flex-1 text-[11px] px-2 py-1.5 border border-stone-300 rounded focus:outline-none focus:border-purple-500"
              />
              <button onClick={handleSendChat} className="bg-purple-600 text-white px-3 py-1.5 rounded text-[11px] font-bold hover:bg-purple-700 transition-colors shadow-sm">✨</button>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Navigation */}
      <nav className="h-14 bg-white border-t border-stone-200 flex items-center justify-around shrink-0 z-50 lg:hidden">
        <button onClick={() => setActiveTab("explorer")} className={`flex flex-col items-center gap-1 w-1/3 ${activeTab === "explorer" ? "text-purple-600" : "text-stone-400"}`}>
          <span className="text-lg leading-none">📁</span><span className="text-[9px] uppercase tracking-wider">Planung</span>
        </button>
        <button onClick={() => setActiveTab("editor")} className={`flex flex-col items-center gap-1 w-1/3 ${activeTab === "editor" ? "text-purple-600" : "text-stone-400"}`}>
          <span className="text-lg leading-none">💻</span><span className="text-[9px] uppercase tracking-wider">Code</span>
        </button>
        <button onClick={() => setActiveTab("chat")} className={`flex flex-col items-center gap-1 w-1/3 ${activeTab === "chat" ? "text-purple-600" : "text-stone-400"}`}>
          <span className="text-lg leading-none">✨</span><span className="text-[9px] uppercase tracking-wider">Log</span>
        </button>
      </nav>
    </div>
  );
};
