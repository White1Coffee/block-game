export function isTextEditing(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const field = target.closest("input,textarea,[contenteditable]");
  if (!field) return false;
  if (field instanceof HTMLTextAreaElement) return true;
  if (field instanceof HTMLInputElement)
    return [
      "text",
      "search",
      "email",
      "url",
      "password",
      "tel",
      "number",
    ].includes(field.type);
  return field instanceof HTMLElement && field.isContentEditable;
}
export function blocksBrowserShortcut(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey">,
  editing: boolean,
) {
  return (
    (event.ctrlKey || event.metaKey) &&
    (event.code === "KeyS" || (event.code === "KeyA" && !editing))
  );
}
