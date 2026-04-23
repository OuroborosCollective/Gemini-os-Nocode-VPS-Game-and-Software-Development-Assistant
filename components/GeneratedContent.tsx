/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import React, {useEffect, useRef} from 'react';
import {InteractionData} from '../types';

interface GeneratedContentProps {
  htmlContent: string;
  onInteract: (data: InteractionData) => void;
  appContext: string | null;
  isLoading: boolean; // Added isLoading prop
}

export const GeneratedContent: React.FC<GeneratedContentProps> = ({
  htmlContent,
  onInteract,
  appContext,
  isLoading,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const processedHtmlContentRef = useRef<string | null>(null); // Ref to track processed content

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
          type: targetElement.dataset.interactionType || 'generic_click',
          value: interactionValue,
          elementType: targetElement.tagName.toLowerCase(),
          elementText: (
            targetElement.innerText ||
            (targetElement as HTMLInputElement).value ||
            ''
          )
            .trim()
            .substring(0, 75),
          appContext: appContext,
        };
        onInteract(interactionData);
      }
    };

    container.addEventListener('click', handleClick);

    // Process scripts only when loading is complete and content has changed
    if (!isLoading) {
      if (htmlContent !== processedHtmlContentRef.current) {
        const scripts = Array.from(container.getElementsByTagName('script')) as HTMLScriptElement[];
        scripts.forEach((oldScript) => {
          try {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach((attr) =>
              newScript.setAttribute(attr.name, attr.value),
            );
            newScript.text = oldScript.innerHTML;

            if (oldScript.parentNode) {
              oldScript.parentNode.replaceChild(newScript, oldScript);
            } else {
              console.warn(
                'Script tag found without a parent node:',
                oldScript,
              );
            }
          } catch (e: any) {
            console.error(
              'Error processing/executing script tag.',
              {
                scriptContent:
                  oldScript.innerHTML.substring(0, 500) +
                  (oldScript.innerHTML.length > 500 ? '...' : ''),
                error: e,
              },
            );
            
            // Create a visible error message with collapsible details
            const errorDiv = document.createElement('div');
            errorDiv.className = 'p-3 mt-2 text-sm text-red-700 bg-red-100 rounded-lg border border-red-200';
            errorDiv.innerHTML = `
              <div class="font-bold flex items-center justify-between cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">
                <span>⚠️ Script Execution Error</span>
                <span class="text-xs opacity-60">Click for details ▾</span>
              </div>
              <div class="mt-2 text-xs font-mono bg-red-50 p-2 rounded border border-red-200 overflow-auto hidden">
                <p class="font-bold border-b border-red-200 pb-1 mb-1">${e.message || 'Unknown Error'}</p>
                <div class="whitespace-pre-wrap">${e.stack || 'No stack trace available'}</div>
                <div class="mt-2 pt-2 border-t border-red-200 italic opacity-70">
                  Script Source Snippet: ${oldScript.innerHTML.substring(0, 100)}...
                </div>
              </div>
            `;
            oldScript.parentNode?.insertBefore(errorDiv, oldScript.nextSibling);
          }
        });
        processedHtmlContentRef.current = htmlContent; // Mark this content as processed
      }
    } else {
      // If loading, reset the processed content ref. This ensures that when loading finishes,
      // the new content (even if identical to a previous state before loading) is processed.
      processedHtmlContentRef.current = null;
    }

    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [htmlContent, onInteract, appContext, isLoading]);

  return (
    <div
      ref={contentRef}
      className="w-full h-full overflow-y-auto"
      dangerouslySetInnerHTML={{__html: htmlContent}}
    />
  );
};
