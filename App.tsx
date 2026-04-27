/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React, { useCallback, useEffect, useState } from "react";
import { GeneratedContent } from "./components/GeneratedContent";
import { Icon } from "./components/Icon";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { GitHubManagerPanel } from "./components/GitHubManagerPanel";
import { ParametersPanel } from "./components/ParametersPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { Window } from "./components/Window";
import {
  APP_DEFINITIONS_CONFIG,
  INITIAL_MAX_HISTORY_LENGTH,
} from "./constants";
import { streamAppContent } from "./services/geminiService";
import { AppDefinition, InteractionData } from "./types";

const DesktopView: React.FC<{ onAppOpen: (app: AppDefinition) => void }> = ({
  onAppOpen,
}) => (
  <div className="flex flex-wrap content-start p-4">
    {APP_DEFINITIONS_CONFIG.map((app) => (
      <Icon key={app.id} app={app} onInteract={() => onAppOpen(app)} />
    ))}
  </div>
);

const App: React.FC = () => {
  const [activeApp, setActiveApp] = useState<AppDefinition | null>(null);
  const [previousActiveApp, setPreviousActiveApp] =
    useState<AppDefinition | null>(null);
  const [llmContent, setLlmContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [interactionHistory, setInteractionHistory] = useState<
    InteractionData[]
  >([]);
  const [isParametersOpen, setIsParametersOpen] = useState<boolean>(false);
  const [currentMaxHistoryLength, setCurrentMaxHistoryLength] =
    useState<number>(INITIAL_MAX_HISTORY_LENGTH);

  // Statefulness feature state
  const [isStatefulnessEnabled, setIsStatefulnessEnabled] =
    useState<boolean>(false);
  const [appContentCache, setAppContentCache] = useState<
    Record<string, string>
  >({});
  const [currentAppPath, setCurrentAppPath] = useState<string[]>([]); // For UI graph statefulness
  const [systemStatus, setSystemStatus] = useState<any>(null);

  // Health check polling
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          const data = await res.json();
          setSystemStatus(data);
        }
      } catch (e) {
        console.warn("Health check failed", e);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Pulse every 30s
    return () => clearInterval(interval);
  }, []);

  const internalHandleLlmRequest = useCallback(
    async (historyForLlm: InteractionData[], maxHistoryLength: number) => {
      if (historyForLlm.length === 0) {
        setError("No interaction data to process.");
        return;
      }

      setIsLoading(true);
      setError(null);

      let accumulatedContent = "";
      // Clear llmContent before streaming new content only if not loading from cache
      // This is now handled before this function is called (in handleAppOpen/handleInteraction)
      // setLlmContent(''); // Removed from here, set by caller if needed

      try {
        const stream = streamAppContent(historyForLlm, maxHistoryLength);
        let lastUpdateTime = Date.now();
        for await (const chunk of stream) {
          accumulatedContent += chunk;
          const now = Date.now();
          if (now - lastUpdateTime > 64) {
            setLlmContent(accumulatedContent);
            lastUpdateTime = now;
          }
        }
        setLlmContent(accumulatedContent); // Ensure final state is set
      } catch (e: any) {
        setError("Failed to stream content from the API.");
        console.error(e);
        accumulatedContent = `<div class="p-4 text-red-600 bg-red-100 rounded-md">Error loading content.</div>`;
        setLlmContent(accumulatedContent);
      } finally {
        setIsLoading(false);
        // Caching logic is now in useEffect watching llmContent, isLoading, activeApp, currentAppPath etc.
      }
    },
    [],
  );

  // Effect to cache content when loading finishes and statefulness is enabled
  useEffect(() => {
    if (
      !isLoading &&
      currentAppPath.length > 0 &&
      isStatefulnessEnabled &&
      llmContent
    ) {
      const cacheKey = currentAppPath.join("__");
      setAppContentCache((prevCache) => {
        if (prevCache[cacheKey] === llmContent) return prevCache;
        return {
          ...prevCache,
          [cacheKey]: llmContent,
        };
      });
    }
  }, [isLoading, currentAppPath, isStatefulnessEnabled]);

  const handleInteraction = useCallback(
    async (interactionData: InteractionData) => {
      if (interactionData.id === "app_close_button") {
        handleCloseAppView();
        return;
      }

      let toolResult = "";
      if (interactionData.id.startsWith("tool:")) {
        setIsLoading(true);
        try {
          const safeParse = (val: any) => {
            if (typeof val === "object" && val !== null) return val;
            try {
              return JSON.parse(val || "{}");
            } catch (e) {
              return {};
            }
          };

          const toolHandlers: Record<string, (val?: string) => Promise<any>> = {
            "tool:vps_save_path": async (val) => {
              const res = await fetch("/api/ssh/save-path", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: val }),
              });
              return res.json();
            },
            "tool:vps_connect": async (val) => {
              const res = await fetch("/api/ssh/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: val || "{}",
              });
              return res.json();
            },
            "tool:vps_exec": async (val) => {
              const res = await fetch("/api/ssh/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: val }),
              });
              return res.json();
            },
            "tool:vps_read": async (val) => {
              const parsed = safeParse(val);
              const pathArg =
                typeof parsed === "object" && parsed !== null && parsed.path
                  ? parsed.path
                  : val;
              const base64Arg =
                typeof parsed === "object" && parsed !== null && parsed.base64
                  ? "&base64=true"
                  : "";
              const res = await fetch(
                "/api/ssh/file?path=" +
                  encodeURIComponent(String(pathArg || "")) +
                  base64Arg,
              );
              return res.json();
            },
            "tool:vps_ls": async (val) => {
              const res = await fetch(
                "/api/ssh/ls?path=" + encodeURIComponent(val || "."),
              );
              return res.json();
            },
            "tool:vps_file_action": async (val) => {
              const res = await fetch("/api/ssh/file/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: val || "{}",
              });
              return res.json();
            },
            "tool:vps_write": async (val) => {
              const { path, content } = safeParse(val);
              const res = await fetch("/api/ssh/file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, content }),
              });
              return res.json();
            },
            "tool:vps_python_run": async (val) => {
              const res = await fetch("/api/ssh/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: "python3 -c " + JSON.stringify(val || "") }),
              });
              return res.json();
            },
            "tool:github_connect": async (val) => {
              const res = await fetch("/api/github/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: val }),
              });
              return res.json();
            },
            "tool:github_stash": async (val) => {
              const res = await fetch("/api/github/stash", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              return res.json();
            },
            "tool:github_stash_pop": async (val) => {
              const res = await fetch("/api/github/stash-pop", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              return res.json();
            },
            "tool:vps_discovered_paths": async () => {
              const res = await fetch("/api/ssh/discovered-paths");
              return res.json();
            },
            "tool:vps_install_os": async () => {
              const res = await fetch("/api/ssh/install-os", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              return res.json();
            },
            "tool:vps_installer_status": async () => {
              const res = await fetch("/api/ssh/installer");
              return res.json();
            },
            "tool:vps_verify_installer": async () => {
              const res = await fetch("/api/ssh/verify", { method: "POST" });
              return res.json();
            },
            "tool:vps_check_connection": async () => {
              const res = await fetch("/api/ssh/check", { method: "POST" });
              return res.json();
            },
            "tool:ai_learn_skill": async (val) => {
              const skill = safeParse(val);
              const res = await fetch("/api/skills", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(skill),
              });
              return res.json();
            },
            "tool:vps_deep_scan": async (val) => {
              try {
                const res = await fetch("/api/ssh/deep-scan", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: val }),
                });
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
              } catch (e) {
                console.error("Failed to deep scan:", e);
                return { error: "Failed to initiate deep scan" };
              }
            },
            "tool:vps_global_scan": async () => {
              const res = await fetch("/api/ssh/global-scan", {
                method: "POST",
              });
              return res.json();
            },
            "tool:vps_scan_status": async () => {
              const res = await fetch("/api/ssh/scan-status");
              return res.json();
            },
            "tool:vps_migrate_skills": async (val) => {
              const res = await fetch("/api/vps/migrate-skills", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath: val }),
              });
              return res.json();
            },
            "tool:vps_keys_list": async () => {
              const res = await fetch("/api/ssh/keys");
              return res.json();
            },
            "tool:vps_keys_add": async (val) => {
              const { name, key } = safeParse(val);
              const res = await fetch("/api/ssh/keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, key }),
              });
              return res.json();
            },
            "tool:vps_keys_delete": async (val) => {
              const res = await fetch(`/api/ssh/keys/${val}`, {
                method: "DELETE",
              });
              return res.json();
            },
            "tool:vps_keys_set_default": async (val) => {
              const res = await fetch("/api/ssh/keys/default", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: val }),
              });
              return res.json();
            },
          };

          const handler = toolHandlers[interactionData.id];
          if (handler) {
            const data = (await handler(interactionData.value)) || {};
            if (interactionData.id === 'tool:vps_connect') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'Connected to VPS: ' + (data.host || 'success');
            } else if (
              interactionData.id === 'tool:vps_exec' ||
              interactionData.id === 'tool:vps_python_run'
            ) {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'EXEC_RESULT:\n---STDOUT---\n' +
                  (data.stdout || '') +
                  '\n---STDERR---\n' +
                  (data.stderr || '');
            } else if (interactionData.id === 'tool:vps_read') {
              if (data.isBase64) {
                toolResult = 'FILE_CONTENT_BASE64:' + data.content;
              } else {
                toolResult = data.error ? 'Error: ' + data.error : data.content || '';
              }
            } else if (interactionData.id === 'tool:vps_ls') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'DIRECTORY_LISTING:' + JSON.stringify(data);
            } else if (interactionData.id === 'tool:vps_file_action') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'ACTION_RESULT: ' + data.status;
            } else if (interactionData.id === 'tool:vps_write') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'File saved: ' + (data.path || 'success');
            } else if (interactionData.id === 'tool:vps_installer_status') {
              toolResult =
                'Status: ' +
                (data.status || 'unknown') +
                '\nLast Run: ' +
                (data.lastRun || 'never') +
                '\nLogs:\n' +
                (data.logs || '');
            } else if (interactionData.id === 'tool:vps_check_connection') {
              toolResult = data.connected ? 'Connected' : 'Not Connected';
            } else if (interactionData.id === 'tool:vps_verify_installer') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'Verification Report:\n' + (data.report || '');
            } else if (
              interactionData.id === 'tool:vps_deep_scan' ||
              interactionData.id === 'tool:vps_global_scan'
            ) {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'SCAN_TRIGGERED: status=' + (data.status || 'started');
            } else if (interactionData.id === 'tool:vps_scan_status') {
              // Extract meaningful inventory data for the AI to render badges
              const projects = data.report
                ? data.report
                    .split('=== PROJECT:')
                    .slice(1)
                    .map((p: string) => {
                      const lines = p.split('\n');
                      return {
                        path: lines[0].trim(),
                        files: p
                          .match(
                            /\[File Breakdown\]\n([\s\S]+?)\n\[Detected Entry Points\]/,
                          )?.[1]
                          .trim(),
                        entry: p
                          .match(
                            /\[Detected Entry Points\]\n([\s\S]+?)\n\[Dependency Overview\]/,
                          )?.[1]
                          .trim(),
                      };
                    })
                : [];
              toolResult =
                'SCAN_STATUS: state=' +
                data.status +
                ' progress=' +
                data.progress +
                '% logs="' +
                data.logs +
                '" projects=' +
                JSON.stringify(projects) +
                ' skillsFound=' +
                JSON.stringify(data.skillsFound || []) +
                ' discoveredPaths=' +
                JSON.stringify(data.discoveredPaths || []);
            } else if (interactionData.id === 'tool:vps_discovered_paths') {
              toolResult = 'DISCOVERED_PATHS: ' + JSON.stringify(data);
            } else if (interactionData.id === 'tool:vps_migrate_skills') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'MIGRATION_RESULT: ' + JSON.stringify(data);
            } else if (interactionData.id === 'tool:vps_save_path') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'Path saved to system: ' + (data.path || 'success');
            } else if (interactionData.id === 'tool:vps_keys_list') {
              toolResult = data.error
                ? 'Error: ' + data.error
                : 'SSH_KEYS_DATA: ' + JSON.stringify(data);
            } else {
              toolResult = data.error
                ? 'Error: ' + data.error
                : data.status || 'Success';
            }
          } else {
            console.warn(`No handler for tool: ${interactionData.id}`);
          }
        } catch (e: any) {
          toolResult = `System Error: ${e.message}`;
        }
      }

      const updatedInteraction = toolResult
        ? {...interactionData, value: '[TOOL_RESULT]: ' + toolResult}
        : interactionData;

      const newHistory = [
        updatedInteraction,
        ...interactionHistory.slice(0, currentMaxHistoryLength - 1),
      ];
      setInteractionHistory(newHistory);

      const newPath = activeApp
        ? [...currentAppPath, interactionData.id]
        : [interactionData.id];
      setCurrentAppPath(newPath);

      setLlmContent("");
      setError(null);

      // Always re-trigger LLM for tools or if not cached
      internalHandleLlmRequest(newHistory, currentMaxHistoryLength);
    },
    [
      interactionHistory,
      internalHandleLlmRequest,
      activeApp,
      currentMaxHistoryLength,
      currentAppPath,
      isStatefulnessEnabled,
      appContentCache,
    ],
  );

  const handleAppOpen = (app: AppDefinition) => {
    const initialInteraction: InteractionData = {
      id: app.id,
      type: "app_open",
      elementText: app.name,
      elementType: "icon",
      appContext: app.id,
    };

    const newHistory = [initialInteraction];
    setInteractionHistory(newHistory);

    const appPath = [app.id];
    setCurrentAppPath(appPath);
    const cacheKey = appPath.join("__");

    if (isParametersOpen) {
      setIsParametersOpen(false);
    }
    setActiveApp(app);
    setLlmContent("");
    setError(null);

    if (isStatefulnessEnabled && appContentCache[cacheKey]) {
      setLlmContent(appContentCache[cacheKey]);
      setIsLoading(false);
    } else {
      internalHandleLlmRequest(newHistory, currentMaxHistoryLength);
    }
  };

  const handleCloseAppView = () => {
    setActiveApp(null);
    setLlmContent("");
    setError(null);
    setInteractionHistory([]);
    setCurrentAppPath([]);
    setPreviousActiveApp(null);
  };

  const handleToggleParametersPanel = () => {
    setIsParametersOpen((prevIsOpen) => {
      const nowOpeningParameters = !prevIsOpen;
      if (nowOpeningParameters) {
        // Store the currently active app (if any) so it can be restored,
        // or null if no app is active (desktop view).
        setPreviousActiveApp(activeApp);
        setActiveApp(null); // Clear active app to show parameters panel
        setLlmContent("");
        setError(null);
        // Interaction history and current path are not cleared here,
        // as they might be relevant if the user returns to an app.
      } else {
        // Closing parameters panel - try to restore previous app
        if (previousActiveApp) {
          setActiveApp(previousActiveApp);
          setPreviousActiveApp(null);
          // The effect in handleAppOpen handles re-request or cache
          // But here we need to manually trigger because we're bypassing handleAppOpen
          const appPath = [previousActiveApp.id];
          setCurrentAppPath(appPath);
          const cacheKey = appPath.join("__");
          if (isStatefulnessEnabled && appContentCache[cacheKey]) {
            setLlmContent(appContentCache[cacheKey]);
          } else {
            // Re-trigger if no cache
            const initialInteraction: InteractionData = {
              id: previousActiveApp.id,
              type: "app_open",
              elementText: previousActiveApp.name,
              elementType: "icon",
              appContext: previousActiveApp.id,
            };
            const newHistory = [initialInteraction];
            setInteractionHistory(newHistory);
            internalHandleLlmRequest(newHistory, currentMaxHistoryLength);
          }
        } else {
          setActiveApp(null);
          setLlmContent("");
          setInteractionHistory([]);
          setCurrentAppPath([]);
        }
        setError(null);
      }
      return nowOpeningParameters;
    });
  };

  const handleUpdateHistoryLength = (newLength: number) => {
    setCurrentMaxHistoryLength(newLength);
    // Trim interaction history if new length is shorter
    setInteractionHistory((prev) => prev.slice(0, newLength));
  };

  const handleSetStatefulness = (enabled: boolean) => {
    setIsStatefulnessEnabled(enabled);
    if (!enabled) {
      setAppContentCache({});
    }
  };

  const windowTitle = isParametersOpen
    ? "Gemini Computer"
    : activeApp
      ? activeApp.name
      : "Gemini Computer";
  const contentBgColor = "#ffffff";

  const handleRefreshHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
      }
    } catch (e) {
      console.warn("Health check failed", e);
    }
  };

  const handleMasterClose = useCallback(() => {
    if (isParametersOpen) {
      handleToggleParametersPanel();
    } else if (activeApp) {
      handleCloseAppView();
    }
  }, [isParametersOpen, handleToggleParametersPanel, handleCloseAppView, activeApp]);

  // Global Escape key listener
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleMasterClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleMasterClose]);

  return (
    <div className="bg-white w-full min-h-screen flex items-center justify-center sm:p-4">
      <Window
        title={windowTitle}
        onClose={handleMasterClose}
        isAppOpen={!!activeApp && !isParametersOpen}
        appId={activeApp?.id}
        onToggleParameters={handleToggleParametersPanel}
        onExitToDesktop={handleCloseAppView}
        isParametersPanelOpen={isParametersOpen}
        systemStatus={systemStatus}
        onRefreshHealth={handleRefreshHealth}
      >
        <div
          className="w-full h-full"
          style={{ backgroundColor: contentBgColor }}
        >
          {isParametersOpen ? (
            <ParametersPanel
              currentLength={currentMaxHistoryLength}
              onUpdateHistoryLength={handleUpdateHistoryLength}
              onClosePanel={handleToggleParametersPanel}
              isStatefulnessEnabled={isStatefulnessEnabled}
              onSetStatefulness={handleSetStatefulness}
            />
          ) : activeApp?.id === "settings_app" ? (
            <SettingsPanel />
          ) : activeApp?.id === "file_explorer" ? (
            <FileExplorerPanel />
          ) : activeApp?.id === "github_manager" ? (
            <GitHubManagerPanel />
          ) : !activeApp ? (
            <DesktopView onAppOpen={handleAppOpen} />
          ) : (
            <>
              {isLoading && llmContent.length === 0 && (
                <div className="flex justify-center items-center h-full">
                  <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
                </div>
              )}
              {error && (
                <div className="p-4 text-red-600 bg-red-100 rounded-md">
                  {error}
                </div>
              )}
              {(!isLoading || llmContent) && (
                <GeneratedContent
                  htmlContent={llmContent}
                  onInteract={handleInteraction}
                  appContext={activeApp.id}
                  isLoading={isLoading}
                />
              )}
            </>
          )}
        </div>
      </Window>
    </div>
  );
};

export default App;
