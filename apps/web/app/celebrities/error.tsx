"use client";
import { PublicContentState } from "../../components/public-content-state";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <PublicContentState state="error" scope="directory" retry={reset} />; }
