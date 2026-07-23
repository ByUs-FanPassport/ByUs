type PendingTrigger = { element: HTMLElement; selector?: string };
let pendingTrigger: PendingTrigger | null = null;

export function rememberOverlayTrigger(trigger: HTMLElement, selector?: string): void {
  pendingTrigger = { element: trigger, selector };
}

export function takeOverlayTrigger(): PendingTrigger | null {
  const trigger = pendingTrigger;
  pendingTrigger = null;
  return trigger;
}
