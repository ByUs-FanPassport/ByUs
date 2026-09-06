import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({queue:vi.fn(),external:vi.fn(),ses:vi.fn(),http:vi.fn()}));
vi.mock("../src/adapters/supabase-notification-queue.js",()=>({SupabaseNotificationQueue:{create:()=>({})}}));
vi.mock("../src/adapters/web-push-sender.js",()=>({WebPushSender:class {}}));
vi.mock("../src/notification-worker.js",()=>({NotificationWorker:class {async runOnce(){return 2;}}}));
vi.mock("../src/adapters/supabase-external-notification-queue.js",()=>({SupabaseExternalNotificationQueue:{create:state.queue}}));
vi.mock("../src/adapters/notification-test-sink.js",()=>({NotificationTestSinkSender:class {}}));
vi.mock("../src/adapters/ses-email-sender.js",()=>({SesEmailSender:class {constructor(config:unknown){state.ses(config);}}}));
vi.mock("../src/adapters/email-sender.js",()=>({EmailSender:class {constructor(){state.http();}}}));
vi.mock("../src/adapters/kakao-sender.js",()=>({KakaoSender:class {constructor(){state.http();}}}));
vi.mock("../src/external-notification-worker.js",()=>({ExternalNotificationWorker:class {constructor(...args:unknown[]){state.external(...args);}async runOnce(){return 1;}}}));
import {runNotificationWorkerOnce} from "../src/notification-runtime.js";
import {parseNotificationEnv} from "../src/notification-env.js";
const source={NOTIFICATION_WORKER_ID:"runtime-test",SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"s".repeat(48),WEB_PUSH_VAPID_SUBJECT:"mailto:ops@byus.kr",WEB_PUSH_VAPID_PUBLIC_KEY:"a".repeat(88),WEB_PUSH_VAPID_PRIVATE_KEY:"b".repeat(43)};
beforeEach(()=>vi.clearAllMocks());
it("keeps all external providers dormant by default",async()=>{
 expect(await runNotificationWorkerOnce(parseNotificationEnv(source))).toBe(2);
 expect(state.queue).not.toHaveBeenCalled();expect(state.ses).not.toHaveBeenCalled();
});
it("wires SES to the email-only queue without HTTP/Kakao provider configuration",async()=>{
 const env=parseNotificationEnv({...source,NOTIFICATION_EXTERNAL_MODE:"ses_email",NOTIFICATION_WORKER_BATCH_SIZE:"2",SES_REGION:"ap-northeast-2",SES_FROM_EMAIL:"notifications@byus.kr"});
 expect(await runNotificationWorkerOnce(env)).toBe(3);
 expect(state.queue).toHaveBeenCalledWith(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,"dev",true);
 expect(state.ses).toHaveBeenCalledExactlyOnceWith({region:"ap-northeast-2",fromEmail:"notifications@byus.kr",storageOrigin:"https://example.supabase.co"});
 expect(state.http).not.toHaveBeenCalled();expect(state.external).toHaveBeenCalledTimes(1);
});
it("preserves the Dev sink for both channels",async()=>{
 const env=parseNotificationEnv({...source,NOTIFICATION_EXTERNAL_MODE:"test_sink"});
 await runNotificationWorkerOnce(env);
 expect(state.queue).toHaveBeenCalledWith(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,"dev",false);
 expect(state.ses).not.toHaveBeenCalled();expect(state.http).not.toHaveBeenCalled();
});
