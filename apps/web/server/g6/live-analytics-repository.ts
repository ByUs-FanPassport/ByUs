import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { analyticsWindowSchema, integerMetricSchema, metricSchema, ratioMetricSchema, type AnalyticsQuery } from "../../features/analytics/domain/admin-analytics";
import { platformAnalyticsSchema } from "./platform-analytics-repository";

const missionRowSchema=z.object({missionId:z.uuid(),title:z.string().min(1),type:z.enum(["quiz","survey","vote"]),participants:z.number().int().nonnegative(),participationRate:z.number().min(0).max(1).nullable(),correct:z.number().int().nonnegative().nullable(),incorrect:z.number().int().nonnegative().nullable(),correctRate:z.number().min(0).max(1).nullable(),options:z.array(z.object({optionId:z.uuid(),label:z.string().min(1),responses:z.number().int().nonnegative()}))});
export const liveAnalyticsSchema=z.object({
  live:z.object({id:z.uuid(),title:z.string().min(1),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true})}),
  window:analyticsWindowSchema,
  funnel:z.object({visits:integerMetricSchema,reservations:integerMetricSchema,reservationRate:ratioMetricSchema,attendances:integerMetricSchema,attendanceRate:ratioMetricSchema}),
  relationships:z.object({newFans:integerMetricSchema,newPassports:integerMetricSchema,firstReactions:integerMetricSchema}),
  missions:metricSchema(z.array(missionRowSchema)),
  benefits:z.object({ticketsEarned:integerMetricSchema,ticketsUsed:integerMetricSchema,applicants:integerMetricSchema,winners:integerMetricSchema}),
  journey:z.object({eligible:integerMetricSchema,complete:integerMetricSchema,claims:integerMetricSchema,claimRate:ratioMetricSchema}),
  chain:platformAnalyticsSchema.shape.chain,
});
export type LiveAnalytics=z.infer<typeof liveAnalyticsSchema>;
export interface LiveAnalyticsRepository{read(input:AnalyticsQuery&{adminAppUserId:string;adminAllowlistId:string;liveEventId:string}):Promise<LiveAnalytics>}
interface RpcClient{rpc(name:string,parameters:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>}
export class LiveAnalyticsRepositoryError extends Error{constructor(){super("LIVE_ANALYTICS_UNAVAILABLE");this.name="LiveAnalyticsRepositoryError"}}
export class SupabaseLiveAnalyticsRepository implements LiveAnalyticsRepository{constructor(private readonly database:RpcClient){}async read(input:AnalyticsQuery&{adminAppUserId:string;adminAllowlistId:string;liveEventId:string}){const{data,error}=await this.database.rpc("read_admin_live_analytics",{p_actor_app_user_id:input.adminAppUserId,p_actor_admin_allowlist_id:input.adminAllowlistId,p_live_event_id:input.liveEventId,p_from:input.from,p_to:input.to,p_as_of:input.asOf});const parsed=liveAnalyticsSchema.safeParse(data);if(error||!parsed.success)throw new LiveAnalyticsRepositoryError();return parsed.data}}
export function createLiveAnalyticsRepository(config:{url:string;serviceRoleKey:string}):LiveAnalyticsRepository{const database=createClient(config.url,config.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});return new SupabaseLiveAnalyticsRepository(database as unknown as RpcClient)}

