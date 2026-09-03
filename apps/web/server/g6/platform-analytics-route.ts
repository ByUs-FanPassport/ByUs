import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { PlatformAnalyticsRepositoryError, type PlatformAnalyticsRepository } from "./platform-analytics-repository";

interface Dependencies { authorize(input:{authorization:string;correlationId:string}):Promise<AdminSession>; repository:PlatformAnalyticsRepository }
const date = z.iso.datetime({ offset: true });
const headers = {"cache-control":"private, no-store",vary:"Authorization"};
const failure=(status:number,code:string)=>Response.json({error:{code}},{status,headers});
export function createGetPlatformAnalyticsHandler(dependencies: Dependencies) {
  return async (request: Request) => {
    try {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key)=>!["from","to","asOf"].includes(key)||params.getAll(key).length!==1)) throw new Error("INVALID_QUERY");
      const parsed=z.object({from:date,to:date,asOf:date}).safeParse({from:params.get("from"),to:params.get("to"),asOf:params.get("asOf")});
      if(!parsed.success) throw new Error("INVALID_QUERY");
      const normalized=Object.fromEntries(Object.entries(parsed.data).map(([key,value])=>[key,new Date(value).toISOString()])) as typeof parsed.data;
      if(normalized.from>=normalized.to||normalized.to>normalized.asOf||Date.parse(normalized.to)-Date.parse(normalized.from)>366*86400000) throw new Error("INVALID_QUERY");
      const admin=await dependencies.authorize({authorization:request.headers.get("authorization")??"",correlationId:crypto.randomUUID()});
      const data=await dependencies.repository.read({...normalized,adminAppUserId:admin.appUserId,adminAllowlistId:admin.allowlistId});
      return Response.json(data,{status:200,headers});
    } catch(error) {
      if(error instanceof AuthError) return failure(error.status,error.status===401?"UNAUTHENTICATED":"FORBIDDEN");
      if(error instanceof PlatformAnalyticsRepositoryError) return failure(503,"PLATFORM_ANALYTICS_UNAVAILABLE");
      if(error instanceof Error&&error.message==="INVALID_QUERY") return failure(400,"INVALID_QUERY");
      throw error;
    }
  };
}

