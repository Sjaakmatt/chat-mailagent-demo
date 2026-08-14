"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { CodeFlow } from "@/components/auth/CodeFlow";

export default function ForgotPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-muted flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      }
    >
      <CodeFlow variant="forgot" />
    </Suspense>
  );
}
