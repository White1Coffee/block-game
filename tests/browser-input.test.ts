import { expect, it } from "vitest";
import { blocksBrowserShortcut } from "../src/player/BrowserInput";

it("blocks page save everywhere and select-all only outside text editing", () => {
  const key = (code: string, ctrlKey = true, metaKey = false) => ({
    code,
    ctrlKey,
    metaKey,
  });
  expect(blocksBrowserShortcut(key("KeyS"), false)).toBe(true);
  expect(blocksBrowserShortcut(key("KeyS"), true)).toBe(true);
  expect(blocksBrowserShortcut(key("KeyA"), false)).toBe(true);
  expect(blocksBrowserShortcut(key("KeyA"), true)).toBe(false);
  expect(blocksBrowserShortcut(key("KeyA", false, true), false)).toBe(true);
  expect(blocksBrowserShortcut(key("KeyS", false), false)).toBe(false);
  expect(blocksBrowserShortcut(key("KeyW"), false)).toBe(false);
});
