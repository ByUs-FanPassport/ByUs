"use client";
import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { subscribeFanActivityUpdates } from "@/components/fan-ui/fan-activity-updates";
import { useFanpageResource } from "./use-fanpage-resource";

/** Refresh on return visits and local fan actions, without a chat polling loop. */
export function useCommunityResource<T>(url: string, parse: (value: unknown) => T) {
  const auth = usePrivy();
  const resource = useFanpageResource(url, parse, true);
  const refresh = useRef(resource.retry);
  useEffect(() => { refresh.current = resource.retry; }, [resource.retry]);
  useEffect(() => subscribeFanActivityUpdates(auth.user?.id, () => refresh.current()), [auth.user?.id, url]);
  return resource;
}
