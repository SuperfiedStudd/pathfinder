export type ActionType =
  | "highlight"
  | "explain"
  | "scroll"
  | "ask"
  | "wait"
  | "done"
  | "fill"
  | "click";

export type Mode = "guide" | "assist";

export interface Action {
  thought: string;
  action: ActionType;
  target_id?: number | null;
  target_name?: string;
  value?: string | null;
  message: string;
  options?: string[];
  goal_progress?: string;
  goal_id?: string;
  policy_blocked?: boolean;
}

export interface TranscriptTurn {
  role: "user" | "agent";
  text: string;
}

export interface RecentAction {
  action: ActionType;
  target: string;
  outcome: string;
}

export interface DecideRequest {
  siteId: string;
  mode: Mode;
  goal: string;
  transcript: TranscriptTurn[];
  recentActions: RecentAction[];
  pageModel: string;
}

export interface DecideResponse {
  action: Action;
  latencyMs: number;
  model: string;
}

export const ACTION_TYPES: ActionType[] = [
  "highlight",
  "explain",
  "scroll",
  "ask",
  "wait",
  "done",
  "fill",
  "click",
];

// JSON schema handed to Gemini structured output. Kept deliberately small,
// Gemini's structured output supports a subset of JSON Schema and rejects
// very large or deeply nested schemas.
export const ACTION_SCHEMA = {
  type: "object",
  properties: {
    thought: {
      type: "string",
      description: "One private sentence of reasoning about the current page and goal.",
    },
    action: {
      type: "string",
      enum: ACTION_TYPES,
      description:
        "highlight: point at one element and tell the user what to do with it. explain: message only. scroll: bring an element into view. ask: a clarifying question with options. wait: the page is still changing. done: the goal is visibly complete. fill and click: assist mode only.",
    },
    target_id: {
      type: ["integer", "null"],
      description: "The [id] from the page model. Required for highlight, scroll, fill and click.",
    },
    target_name: {
      type: "string",
      description: "the quoted accessible name of the target exactly as it appears in the page model",
    },
    value: {
      type: ["string", "null"],
      description: "Value to type into the target. Assist mode fill only.",
    },
    message: {
      type: "string",
      description: "What to say to the user. Under 35 words, plain language, no markdown.",
    },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Quick reply choices for an ask action. Two to four short options.",
    },
    goal_progress: {
      type: "string",
      description: "Which goal is active and what remains before it is done.",
    },
    goal_id: {
      type: "string",
      description: "the id of the manifest goal you are working on",
    },
  },
  required: ["thought", "action", "message"],
} as const;

export const MAX_PAGE_MODEL_CHARS = 12000;
