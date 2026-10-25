export type AiTask =
  | "bengali"
  | "vocabulary"
  | "grammar"
  | "natural"
  | "client"
  | "sales"
  | "roleplay"
  | "examples";

export const AI_TASKS: { id: AiTask; label: string; category: string; instruction: string }[] = [
  {
    id: "bengali",
    label: "Bengali explanation",
    category: "Explanation",
    instruction:
      "Explain the meaning of the English text in simple Bengali (বাংলা). Give a natural Bengali translation first, then explain any tricky words or phrases briefly.",
  },
  {
    id: "vocabulary",
    label: "Vocabulary extraction",
    category: "Vocabulary",
    instruction:
      "Extract the useful vocabulary and phrases from the English text. For each: the word/phrase, its meaning in simple English, the Bengali meaning, and one short example sentence. Use a compact list.",
  },
  {
    id: "grammar",
    label: "Grammar explanation",
    category: "Grammar",
    instruction: "Explain the grammar patterns used in the English text for an intermediate learner. Name each pattern, show the structure, and give one extra example. Add a short Bengali note where it helps.",
  },
  {
    id: "natural",
    label: "More natural English",
    category: "Rewrite",
    instruction: "Rewrite the text in more natural, fluent English as a native speaker would say it. Give 2–3 alternatives (casual and professional) and explain the differences briefly.",
  },
  {
    id: "client",
    label: "Client communication template",
    category: "Client Communication",
    instruction:
      "Using the phrases and ideas in the text, write a reusable client communication template (email or chat message) with placeholders in [brackets]. Keep it polite, clear and professional.",
  },
  {
    id: "sales",
    label: "Sales conversation",
    category: "Sales English",
    instruction: "Write a short realistic sales conversation between Person A (salesperson) and Person B (client) that reuses the useful phrases from the text. Label each line 'Person A:' or 'Person B:'.",
  },
  {
    id: "roleplay",
    label: "Role-play script",
    category: "Role-play",
    instruction:
      "Create a role-play practice script based on the text, with lines labelled 'Person A:' and 'Person B:'. Keep sentences short and speakable, about 10–14 lines.",
  },
  {
    id: "examples",
    label: "Example sentences",
    category: "Examples",
    instruction: "Write 6 new example sentences that reuse the key phrases from the text in different everyday and work situations. Add the Bengali meaning under each.",
  },
];

export const AI_SYSTEM =
  "You are a friendly English tutor for a Bengali-speaking professional who learns English from videos. Be concise and practical. Output plain text (simple lists are fine, no tables).";

export function buildPrompt(task: AiTask, text: string, extra: string): string {
  const t = AI_TASKS.find((x) => x.id === task) ?? AI_TASKS[0];
  return `${t.instruction}${extra.trim() ? `\n\nAdditional request: ${extra.trim()}` : ""}\n\nText:\n"""\n${text.trim()}\n"""`;
}
