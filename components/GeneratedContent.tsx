/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React, { useEffect, useRef, useState } from "react";
import { InteractionData } from "../types";

interface GeneratedContentProps {
  htmlContent: string;
  onInteract: (data: InteractionData) => void;
  appContext: string | null;
  isLoading: boolean; // Added isLoading prop
}

export const GeneratedContent = React.memo<GeneratedContentProps>(({
  htmlContent,
  onInteract,
  appContext,
  isLoading,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const processedHtmlContentRef = useRef<string | null>(null); // Ref to track processed content
  const [scanState, setScanState] = useState<{
    status: string;
    progress: number;
    logs: string;
    report: string;
    projects: { path: string; deps: Record<string, string> }[];
  } | null>(null);

  const renderedHtml = React.useMemo(() => {
    if (scanState?.status === "completed") {
      const escapedReport = scanState.report
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<div class="llm-terminal"><div class="llm-terminal-body"><div class="llm-stdout">${escapedReport}</div></div></div>`;
    }
    return htmlContent;
  }, [htmlContent, scanState?.status, scanState?.report]);

  const isScanning = React.useMemo(() => {
    return (
      htmlContent.includes("Scan Result:\nstarted") ||
      htmlContent.includes("Scan Result:\nGlobal scan started")
    );
  }, [htmlContent]);

  // Poll scan status if active
  useEffect(() => {
    if (!isScanning) {
      setScanState(null);
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/ssh/scan-status");
        const data = await res.json();
        setScanState(data);
        if (data.status === "completed" || data.status === "failed") {
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isScanning]);

  // Stable event listener
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      let targetElement = event.target as HTMLElement;

      while (
        targetElement &&
        targetElement !== container &&
        !targetElement.dataset.interactionId
      ) {
        targetElement = targetElement.parentElement as HTMLElement;
      }

      if (targetElement && targetElement.dataset.interactionId) {
        event.preventDefault();

        let interactionValue: string | undefined =
          targetElement.dataset.interactionValue;

        if (targetElement.dataset.valueFrom) {
          const inputElement = document.getElementById(
            targetElement.dataset.valueFrom,
          ) as HTMLInputElement | HTMLTextAreaElement;
          if (inputElement) {
            interactionValue = inputElement.value;
          }
        }

        const interactionData: InteractionData = {
          id: targetElement.dataset.interactionId,
          type: targetElement.dataset.interactionType || "generic_click",
          value: interactionValue,
          elementType: targetElement.tagName.toLowerCase(),
          elementText: (
            targetElement.innerText ||
            (targetElement as HTMLInputElement).value ||
            ""
          )
            .trim()
            .substring(0, 75),
          appContext: appContext,
        };
        onInteract(interactionData);
      }
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onInteract, appContext]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Process scripts only when loading is complete and content has changed
    if (!isLoading) {
      // Bridge for LLM-generated code that expects runTool to exist
      if (!(window as any).runTool) {
        (window as any).runTool = (id: string, value?: any) => {
          const stringifiedValue =
            typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : value;
          onInteract({
            id,
            type: "generic_click",
            value: stringifiedValue,
            elementType: "script",
            elementText: "runTool(" + id + ")",
            appContext: appContext,
          });
        };
      }

      if (htmlContent !== processedHtmlContentRef.current) {
        const scripts = Array.from(
          container.getElementsByTagName("script"),
        ) as HTMLScriptElement[];
        scripts.forEach((oldScript) => {
          // Skip if already processed in this render cycle
          if (oldScript.getAttribute('data-processed') === 'true') return;
          
          try {
            const newScript = document.createElement("script");
            Array.from(oldScript.attributes).forEach((attr) =>
              newScript.setAttribute(attr.name, attr.value),
            );
            newScript.setAttribute('data-processed', 'true');

            // Use textContent or text for script content
            const scriptText = (oldScript.textContent || oldScript.innerHTML || "").trim();
            if (scriptText) {
                newScript.text = scriptText;
            }

            if (oldScript.parentNode) {
              oldScript.parentNode.replaceChild(newScript, oldScript);
            }
          } catch (e: any) {
            console.error("Error executing script tag.", e);
            oldScript.setAttribute('data-processed', 'error');
            
            if (!oldScript.parentNode?.querySelector('.script-error')) {
                const errorDiv = document.createElement("div");
                errorDiv.className = "p-3 mt-2 text-sm text-red-700 bg-red-100 rounded-lg border border-red-200 script-error";
                errorDiv.innerHTML = "<strong>Script Error</strong>";
                oldScript.parentNode?.insertBefore(errorDiv, oldScript.nextSibling);
            }
          }
        });
        processedHtmlContentRef.current = htmlContent;
      }
    } else {
      // If loading, reset the processed content ref. This ensures that when loading finishes,
      // the new content (even if identical to a previous state before loading) is processed.
      processedHtmlContentRef.current = null;
    }

    return () => {};
  }, [htmlContent, onInteract, appContext, isLoading]);

  // Auto-scroll to bottom logic
  useEffect(() => {
    if (contentRef.current) {
      const container = contentRef.current;
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        150;

      if (isNearBottom || isLoading) {
        container.scrollTo({
          top: container.scrollHeight,
          // Use 'auto' (instant) during loading to prevent animation jank
          // and reduce CPU overhead during rapid streaming updates.
          behavior: isLoading ? "auto" : "smooth",
        });
      }
    }
  }, [renderedHtml, isLoading]);

  return (
    <div className="relative w-full h-full overflow-hidden flex flex-col">
      <div
        ref={contentRef}
        className={`w-full h-full overflow-y-auto html-content-renderer ${scanState?.status === "scanning" ? "opacity-20 pointer-events-none" : "opacity-100"}`}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />

      {scanState && scanState.status === "scanning" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/40 backdrop-blur-[2px] z-50">
          <div className="w-full max-w-sm p-4 bg-[#1a1b1e] border border-blue-500/30 rounded shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <div>
                <h3 className="font-bold text-gray-100 text-xs tracking-tight uppercase">
                  Intelligence Acquisition
                </h3>
                <p className="text-[9px] text-blue-400/80 uppercase font-bold tracking-widest opacity-70">
                  Recursive VPS Traversal
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-black/50 border border-gray-800 rounded p-2 font-mono text-[10px] h-10 flex items-center overflow-hidden">
                <span className="text-green-500 shrink-0 mr-2">&gt;</span>
                <span className="text-gray-400 truncate">
                  {scanState.logs || "initializing..."}
                </span>
                <span className="w-1 h-3 bg-blue-500 ml-1 animate-pulse"></span>
              </div>

              {scanState.projects && scanState.projects.length > 0 && (
                <div className="bg-black/50 border border-gray-800 rounded p-2 font-mono text-[10px] max-h-32 overflow-y-auto">
                  <div className="text-gray-500 uppercase mb-1 font-bold">Detected Projects:</div>
                  {scanState.projects.map((proj, i) => (
                    <div key={i} className="mb-2">
                      <div className="text-blue-400 truncate">{proj.path}</div>
                      <div className="text-gray-600 ml-2">
                        {Object.keys(proj.deps || {}).length} deps
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold tracking-tighter">
                  <span className="text-gray-500 uppercase">
                    SYS_SCAN_PROGRESS
                  </span>
                  <span className="text-blue-400">{scanState.progress}%</span>
                </div>
                <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600 bg-[length:200%_100%] animate-shimmer transition-all duration-700 ease-out shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                    style={{ width: `${scanState.progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
