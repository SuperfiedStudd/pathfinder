import { describe, expect, it } from "vitest";
import { validateAction } from "../shared/policy";
import { manifests } from "../shared/manifests";

describe("policy", () => {
  it("downgrades fill to explain in guide mode and flags it", () => {
    const out = validateAction({ thought: "t", action: "fill", target_id: 3, value: "Acme", message: "Filling it" }, "guide", manifests.ledgerly, "");
    expect(out.action).toBe("explain");
    expect(out.policy_blocked).toBe(true);
    expect(out.target_id).toBeNull();
  });

  it("allows fill in assist mode on a site that opted in", () => {
    const out = validateAction({ thought: "t", action: "fill", target_id: 3, value: "Acme", message: "Filling it" }, "assist", manifests.ledgerly, "");
    expect(out.action).toBe("fill");
    expect(out.policy_blocked).toBeUndefined();
  });

  it("forces guide mode on a site that did not opt in to assist", () => {
    const out = validateAction({ thought: "t", action: "click", target_id: 9, message: "Clicking" }, "assist", manifests.canopy, "");
    expect(out.action).toBe("explain");
    expect(out.policy_blocked).toBe(true);
  });

  it("turns a highlight without a target into a question", () => {
    const out = validateAction({ thought: "t", action: "highlight", message: "Look here" }, "guide", manifests.canopy, "");
    expect(out.action).toBe("explain");
    expect(out.message).toMatch(/could not find/i);
  });

  it("survives garbage from the model", () => {
    const out = validateAction("not json at all", "guide", manifests.canopy, "");
    expect(out.action).toBe("explain");
    expect(out.message.length).toBeGreaterThan(0);
  });

  it("blocks done on ledgerly until the workspace-ready text is on the page", () => {
    const out = validateAction(
      { thought: "t", action: "done", goal_id: "workspace", message: "All set" },
      "guide",
      manifests.ledgerly,
      "Dashboard checklist: Organization complete, Pipeline complete.",
    );
    expect(out.action).toBe("explain");
    expect(out.message).toMatch(/do not see the confirmation/i);
  });

  it("lets done through on ledgerly once the workspace-ready text is on the page", () => {
    const out = validateAction(
      { thought: "t", action: "done", goal_id: "workspace", message: "All set" },
      "guide",
      manifests.ledgerly,
      "Workspace ready banner is visible.",
    );
    expect(out.action).toBe("done");
  });

  it("lets done through for a goal with no doneMatch", () => {
    const out = validateAction(
      { thought: "t", action: "done", goal_id: "learn", message: "Got it" },
      "guide",
      manifests.canopy,
      "anything at all",
    );
    expect(out.action).toBe("done");
  });
});
