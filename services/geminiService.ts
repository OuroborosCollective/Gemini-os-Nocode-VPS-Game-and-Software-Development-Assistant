/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import { GoogleGenAI } from "@google/genai";
import { APP_DEFINITIONS_CONFIG, getSystemPrompt } from "../constants"; // Import getSystemPrompt and APP_DEFINITIONS_CONFIG
import { InteractionData } from "../types";

if (!process.env.GEMINI_API_KEY) {
  // This is a critical error. In a real app, you might throw or display a persistent error.
  // For this environment, logging to console is okay, but the app might not function.
  console.error(
    "GEMINI_API_KEY environment variable is not set. The application will not be able to connect to the Gemini API.",
  );
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }); // The "!" asserts GEMINI_API_KEY is non-null after the check.

export async function* streamAppContent(
  interactionHistory: InteractionData[],
  currentMaxHistoryLength: number,
): AsyncGenerator<string, void, void> {
  const model = "gemini-3-flash-preview";

  if (!process.env.GEMINI_API_KEY) {
    yield `<div class="p-4 text-red-700 bg-red-100 rounded-lg">
      <p class="font-bold text-lg">Configuration Error</p>
      <p class="mt-2">The GEMINI_API_KEY is not configured. Please set the GEMINI_API_KEY environment variable.</p>
    </div>`;
    return;
  }

  if (interactionHistory.length === 0) {
    yield `<div class="p-4 text-orange-700 bg-orange-100 rounded-lg">
      <p class="font-bold text-lg">No interaction data provided.</p>
    </div>`;
    return;
  }

  const systemPrompt = getSystemPrompt(currentMaxHistoryLength); // Generate system prompt dynamically

  // Fetch learned skills
  let learnedSkillsStr = "";
  try {
    const res = await fetch(
      `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/api/skills`,
    );
    const skills = await res.json();
    if (skills.length > 0) {
      learnedSkillsStr = `\n\n**Learned AI Skills:**\n${skills.map((s: any) => `- ${s.name}: ${s.content}`).join("\n")}`;
    }
  } catch (e) {
    console.warn("Failed to fetch skills", e);
  }

  const currentInteraction = interactionHistory[0];
  // pastInteractions already respects currentMaxHistoryLength due to slicing in App.tsx
  const pastInteractions = interactionHistory.slice(1);

  const currentElementName =
    currentInteraction.elementText ||
    currentInteraction.id ||
    "Unknown Element";
  let currentInteractionSummary = `Current User Interaction: Clicked on '${currentElementName}' (Type: ${currentInteraction.type || "N/A"}, ID: ${currentInteraction.id || "N/A"}).`;
  if (currentInteraction.value) {
    currentInteractionSummary += ` Associated value: '${currentInteraction.value.substring(0, 100)}'.`;
  }

  const currentAppDef = APP_DEFINITIONS_CONFIG.find(
    (app) => app.id === currentInteraction.appContext,
  );
  const currentAppContext = currentInteraction.appContext
    ? `Current App Context: '${currentAppDef?.name || currentInteraction.appContext}'.`
    : "No specific app context for current interaction.";

  let historyPromptSegment = "";
  if (pastInteractions.length > 0) {
    // The number of previous interactions to mention in the prompt text.
    const numPrevInteractionsToMention =
      currentMaxHistoryLength - 1 > 0 ? currentMaxHistoryLength - 1 : 0;
    historyPromptSegment = `\n\nPrevious User Interactions (up to ${numPrevInteractionsToMention} most recent, oldest first in this list segment but chronologically before current):`;

    // Iterate over the pastInteractions array, which is already correctly sized
    pastInteractions.forEach((interaction, index) => {
      const pastElementName =
        interaction.elementText || interaction.id || "Unknown Element";
      const appDef = APP_DEFINITIONS_CONFIG.find(
        (app) => app.id === interaction.appContext,
      );
      const appName = interaction.appContext
        ? appDef?.name || interaction.appContext
        : "N/A";
      historyPromptSegment += `\n${index + 1}. (App: ${appName}) Clicked '${pastElementName}' (Type: ${interaction.type || "N/A"}, ID: ${interaction.id || "N/A"})`;
      if (interaction.value) {
        historyPromptSegment += ` with value '${interaction.value.substring(0, 50)}'`;
      }
      historyPromptSegment += ".";
    });
  }

  const fullPrompt = `${systemPrompt}${learnedSkillsStr}

${currentInteractionSummary}
${currentAppContext}
${historyPromptSegment}

Full Context for Current Interaction (for your reference, primarily use summaries and history):
${JSON.stringify(currentInteraction, null, 1)}

Generate the HTML content for the window's content area only:`;

  try {
    const response = await ai.models.generateContentStream({
      model: model,
      contents: fullPrompt,
      // Removed thinkingConfig to use default (enabled thinking) for higher quality responses
      // as this is a general app, not a low-latency game AI.
      config: {},
    });

    for await (const chunk of response) {
      if (chunk.text) {
        // Ensure text property exists and is not empty
        yield chunk.text;
      }
    }
  } catch (error) {
    console.error("Error streaming from Gemini:", error);
    let errorMessage = "An error occurred while generating content.";
    // Check if error is an instance of Error and has a message property
    if (error instanceof Error && typeof error.message === "string") {
      errorMessage += ` Details: ${error.message}`;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as any).message === "string"
    ) {
      // Handle cases where error might be an object with a message property (like the API error object)
      errorMessage += ` Details: ${(error as any).message}`;
    } else if (typeof error === "string") {
      errorMessage += ` Details: ${error}`;
    }

    yield `<div class="p-4 text-red-700 bg-red-100 rounded-lg">
      <p class="font-bold text-lg">Error Generating Content</p>
      <p class="mt-2">${errorMessage}</p>
      <p class="mt-1">This may be due to an API key issue, network problem, or misconfiguration. Please check the developer console for more details.</p>
    </div>`;
  }
}
