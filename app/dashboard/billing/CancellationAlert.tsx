"use client";

import { useRouter } from "next/navigation";
import Alert from "@/app/components/Alert";

const CANCELLED_MESSAGE =
  "Your subscription was cancelled successfully. You'll keep access until the " +
  "end of your current billing period.";

export default function CancellationAlert({ visible }: { visible: boolean }) {
  const router = useRouter();

  return (
    <Alert
      message={CANCELLED_MESSAGE}
      visible={visible}
      onDismiss={() => router.replace("/dashboard/billing")}
    />
  );
}