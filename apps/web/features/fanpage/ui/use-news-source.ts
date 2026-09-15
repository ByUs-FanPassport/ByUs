"use client";
import { useEffect, useRef, useState } from "react";
type Page<T> = { items: T[]; nextCursor: string | null };
type State<T> = { url: string | null; status: "loading" | "ready" | "error"; data: T[]; nextCursor: string | null; moreLoading: boolean; moreError: boolean };
export function useNewsSource<T>(url: string | null, parse: (body: unknown) => Page<T>, key: (item: T) => string) {
  const [state, setState] = useState<State<T>>({url,status:url ? "loading" : "ready",data:[],nextCursor:null,moreLoading:false,moreError:false});
  const actions = useRef({ retry: () => {}, loadMore: () => {} });
  useEffect(() => {
    let active = true;
    let busy = false;
    let snapshot: State<T> = {url,status:url ? "loading" : "ready",data:[],nextCursor:null,moreLoading:false,moreError:false};
    let controller: AbortController | undefined;
    const commit = (next: State<T>) => { snapshot = next; if (active) setState(next); };
    const read = async (append: boolean) => {
      if (!url || (append && (busy || !snapshot.nextCursor))) return;
      controller?.abort();
      const current = new AbortController(); controller = current; busy = true;
      const cursor = append ? snapshot.nextCursor : null;
      commit(append ? {...snapshot,moreLoading:true,moreError:false} : {...snapshot,status:"loading",data:[],nextCursor:null,moreLoading:false,moreError:false});
      try {
        const address = cursor ? `${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : url;
        const response = await fetch(address,{signal:current.signal,cache:"no-store",credentials:"omit"});
        if (!response.ok) throw Error();
        const page = parse(await response.json());
        if (current.signal.aborted || !active) return;
        if (page.nextCursor && page.nextCursor === cursor) throw Error("Cursor did not advance");
        const data = new Map((append ? snapshot.data : []).map(item => [key(item),item]));
        page.items.forEach(item => data.set(key(item),item));
        commit({...snapshot,status:"ready",data:[...data.values()],nextCursor:page.nextCursor,moreLoading:false,moreError:false});
      } catch {
        if (!current.signal.aborted && active) commit(append ? {...snapshot,moreLoading:false,moreError:true} : {...snapshot,status:"error",data:[],nextCursor:null,moreLoading:false});
      } finally { if (!current.signal.aborted) busy = false; }
    };
    commit(snapshot);
    actions.current = {retry:()=>{void read(false);},loadMore:()=>{void read(true);}};
    if (url) void read(false);
    // Refresh from page one; never keep older pages across visibility revalidation.
    const refresh = () => { if (!document.hidden) void read(false); };
    const timer = window.setInterval(refresh,900_000);
    document.addEventListener("visibilitychange",refresh);
    return () => {active=false;controller?.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[url,parse,key]);
  return {state:state.url === url ? state : {url,status:url ? "loading" as const : "ready" as const,data:[],nextCursor:null,moreLoading:false,moreError:false},retry:()=>actions.current.retry(),loadMore:()=>actions.current.loadMore()};
}
