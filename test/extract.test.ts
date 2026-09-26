import { beforeEach, describe, expect, it } from "vitest";
import { snapshot, getElementById, findByName, resetSnapshotMemory } from "../client/src/widget/extract";
import { execute } from "../client/src/widget/actions";
import type { Overlay } from "../client/src/widget/overlay";
import { maskValue } from "../client/src/widget/redact";

function setPage(html: string) {
  document.body.innerHTML = html;
  document.title = "Test page";
}

// jsdom has no layout, so give every element a fake box.
beforeEach(() => {
  resetSnapshotMemory();
  Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 20, top: 10, left: 10, bottom: 30, right: 110, x: 10, y: 10, toJSON() {} } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return (this as HTMLElement).textContent ?? "";
    },
  });
  HTMLElement.prototype.scrollIntoView = () => {};
});

describe("extract", () => {
  it("assigns stable ids across snapshots and masks sensitive values", () => {
    setPage(`
      <main>
        <h1>Give to a program</h1>
        <label for="name">Your name</label><input id="name" value="Tanmay" />
        <div data-pf-sensitive>
          <label for="card">Card number</label><input id="card" value="4242424242424242" />
        </div>
        <input type="password" id="pw" value="hunter2" placeholder="Password" />
        <select id="d"><option>General fund</option><option selected>Urban Canopy</option></select>
        <button disabled>Donate now</button>
        <a href="/canopy/programs?x=1">Programs</a>
      </main>
      <div data-pf-widget><button>Send</button></div>
    `);
    const a = snapshot();
    const b = snapshot();
    expect(a.text).toContain('input(text) "Your name" value="Tanmay"');
    expect(a.text).toContain('input(text) "Card number" value="[filled]"');
    expect(a.text).not.toContain("4242");
    expect(a.text).toContain('input(password) "Password" value="[filled]"');
    expect(a.text).not.toContain("hunter2");
    expect(a.text).toContain('selected="Urban Canopy"');
    expect(a.text).toContain('button "Donate now" disabled');
    expect(a.text).toContain("href=/canopy/programs?x=1");
    expect(a.text).not.toContain('"Send"');
    expect(a.text).toContain("CONTENT: Give to a program");
    expect(a.text).toContain("CHANGES SINCE LAST STEP: none");
    // same ids on the second call
    const idsA = a.text.match(/^\[(\d+)\]/gm);
    const idsB = b.text.match(/^\[(\d+)\]/gm);
    expect(idsA).toEqual(idsB);
    // ids resolve back to elements
    const nameId = Number(a.text.match(/\[(\d+)\] input\(text\) "Your name"/)![1]);
    expect(getElementById(nameId)).toBe(document.getElementById("name"));
  });

  it("reports changes between snapshots", () => {
    setPage(`<main><button id="c" disabled>Continue</button></main>`);
    snapshot();
    (document.getElementById("c") as HTMLButtonElement).disabled = false;
    const after = snapshot();
    expect(after.text).toMatch(/CHANGES SINCE LAST STEP: ~\[\d+\] enabled/);
  });

  it("masks by autocomplete and by name pattern", () => {
    const el = document.createElement("input");
    el.setAttribute("autocomplete", "cc-number");
    el.value = "1234";
    expect(maskValue(el)).toBe("[filled]");
    const el2 = document.createElement("input");
    el2.name = "ssn";
    expect(maskValue(el2)).toBe("[empty]");
    const el3 = document.createElement("input");
    el3.value = "Acme Roasters";
    expect(maskValue(el3)).toBe("Acme Roasters");
  });

  it("uses an exact unique name only after the original target disappears", async () => {
    setPage('<main><button id="original">Continue</button><button id="other">Other</button></main>');
    const id = Number(snapshot().text.match(/\[(\d+)\] button "Continue"/)![1]);
    const overlay = { show() {}, clear() {} } as unknown as Overlay;
    let clicked = "";
    document.getElementById("original")!.addEventListener("click", () => { clicked = "original"; });
    await execute({ thought: "", action: "click", target_id: id, target_name: "Other", message: "Go" }, overlay);
    expect(clicked).toBe("original");

    document.getElementById("original")!.remove();
    const replacement = document.createElement("button");
    replacement.textContent = "Continue";
    replacement.addEventListener("click", () => { clicked = "replacement"; });
    document.querySelector("main")!.appendChild(replacement);
    const result = await execute({ thought: "", action: "click", target_id: id, target_name: "Continue", message: "Go" }, overlay);
    expect(clicked).toBe("replacement");
    expect(result.outcome).toMatch(/resolved by name/);

    expect(findByName(" ")).toBeNull();
    document.querySelector("main")!.appendChild(replacement.cloneNode(true));
    expect(findByName("Continue")).toBeNull();
    clicked = "";
    const ambiguous = await execute({ thought: "", action: "click", target_id: id, target_name: "Continue", message: "Go" }, overlay);
    expect(clicked).toBe("");
    expect(ambiguous.outcome).toBe("target not found on page");
  });
});

describe("redact false positives", () => {
  it("does not treat a cc- id prefix as a card field", () => {
    const el = document.createElement("input");
    el.id = "cc-name";
    el.value = "Tanmay";
    expect(maskValue(el)).toBe("Tanmay");
    const card = document.createElement("input");
    card.id = "cc-card";
    card.value = "4242";
    expect(maskValue(card)).toBe("[filled]");
  });
});
