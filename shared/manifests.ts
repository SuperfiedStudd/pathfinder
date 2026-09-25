import type { Mode } from "./schema";

export interface Goal {
  id: string;
  title: string;
  doneWhen: string;
}

export interface SitePolicy {
  defaultMode: Mode;
  allowAssist: boolean;
}

export interface SiteManifest {
  siteName: string;
  about: string;
  goals: Goal[];
  clarify: string[];
  policy: SitePolicy;
}

// A manifest declares outcomes, never steps. The agent works out the path
// from the live page on every turn.
export const manifests: Record<string, SiteManifest> = {
  canopy: {
    siteName: "Canopy Collective",
    about:
      "Nonprofit planting trees in cities and restoring forests. Programs: Urban Canopy, Reforestation, School Groves. Donations can be designated to a program. Volunteers sign up on the Volunteer page.",
    goals: [
      {
        id: "donate",
        title: "Complete a donation",
        doneWhen: "A donation confirmation with a receipt number is visible on the page.",
      },
      {
        id: "volunteer",
        title: "Sign up to volunteer",
        doneWhen: "A volunteer signup confirmation is visible on the page.",
      },
      {
        id: "learn",
        title: "Understand how the organization works",
        doneWhen: "The user says they understand or asks to move on to something else.",
      },
    ],
    clarify: [],
    policy: { defaultMode: "guide", allowAssist: false },
  },
  ledgerly: {
    siteName: "Ledgerly CRM",
    about:
      "CRM for small businesses. The setup wizard has five steps: organization profile, pipeline template, contact import, integrations, and member invites. Contacts and Members are optional. The dashboard shows a setup checklist.",
    goals: [
      {
        id: "workspace",
        title: "Finish workspace setup",
        doneWhen:
          "The dashboard checklist shows Organization, Pipeline and Integrations complete and the Workspace ready banner is visible.",
      },
    ],
    clarify: [
      "what the business sells",
      "whether there is a sales team or a solo owner",
      "where their contacts live today",
    ],
    policy: { defaultMode: "guide", allowAssist: true },
  },
};

export function getManifest(siteId: string): SiteManifest | undefined {
  return manifests[siteId];
}
