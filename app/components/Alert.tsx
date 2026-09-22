"use client";

import { useEffect } from "react";

const AUTO_DISMISS_MS = 5000;

/**
 * Neutral, auto-dismissing alert. Renders while `visible` is true, then
 * disappears automatically after 5 seconds and invokes `onDismiss` (if given)
 * so the caller can clean up whatever triggered it — which flips `visible`
 * back to false and unmounts this component.
 */
export default function Alert({
  message,
  visible,
  onDismiss,
}: {
  message: string;
  visible: boolean;
  onDismiss?: () => void;
}) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="alert" role="status">
      {message}
    </div>
  );
}