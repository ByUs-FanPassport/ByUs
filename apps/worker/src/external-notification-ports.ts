import type{ExternalChannel,ExternalNotificationJob}from"./external-notification-domain.js";
export interface ExternalNotificationSender{send(job:ExternalNotificationJob):Promise<{providerMessageId:string}>;}
export interface ExternalNotificationQueue{claim(workerId:string,batchSize:number,leaseSeconds:number):Promise<ExternalNotificationJob[]>;complete(job:ExternalNotificationJob,providerMessageId:string):Promise<void>;fail(job:ExternalNotificationJob,error:{code:string;retryable:boolean}):Promise<void>;recordSink(job:ExternalNotificationJob,result:"sent"|"permanent_failure"|"retryable_failure"):Promise<void>;}
export type ExternalSenders=Record<ExternalChannel,ExternalNotificationSender>;
