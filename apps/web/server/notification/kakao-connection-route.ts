import "server-only";
import { createHash } from "node:crypto";
import { createKakaoPkce, hashKakaoSubject, type KakaoConnectionPort } from "../../features/notification/domain/kakao-connection";
import { kakaoConnectionCallbackSchema, safeKakaoReturnPathSchema } from "../../features/notification/domain/kakao-connection-schema";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { SupabaseKakaoConnectionRepository } from "./kakao-connection-repository";
import { KAKAO_ALIMTALK_CONSENT_VERSION, readKakaoEnrollmentProfile } from "./kakao-phone-enrollment";

export class KakaoHttpConnectionPort implements KakaoConnectionPort {
  constructor(private readonly config:{clientId:string;clientSecret:string}){}
  authorizationUrl(input:{state:string;codeChallenge:string;redirectUri:string;scope?:"phone_number"}){const url=new URL("https://kauth.kakao.com/oauth/authorize");const params=new URLSearchParams({response_type:"code",client_id:this.config.clientId,redirect_uri:input.redirectUri,state:input.state,code_challenge:input.codeChallenge,code_challenge_method:"S256"});if(input.scope)params.set("scope",input.scope);url.search=params.toString();return url.toString();}
  async exchange(input:{code:string;codeVerifier:string;redirectUri:string;includePhone?:boolean}){const tokenResponse=await fetch("https://kauth.kakao.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:this.config.clientId,client_secret:this.config.clientSecret,redirect_uri:input.redirectUri,code:input.code,code_verifier:input.codeVerifier}),signal:AbortSignal.timeout(8000)});if(!tokenResponse.ok)throw new Error("Kakao token exchange failed");const token=await tokenResponse.json() as {access_token?:unknown};if(typeof token.access_token!=="string")throw new Error("Kakao token response invalid");const profile=await fetch("https://kapi.kakao.com/v2/user/me",{headers:{authorization:`Bearer ${token.access_token}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)});if(!profile.ok)throw new Error("Kakao profile lookup failed");const body=await profile.json() as {id?:unknown;kakao_account?:unknown};const validId=typeof body.id==="number"?Number.isSafeInteger(body.id)&&body.id>0:typeof body.id==="string"&&/^[1-9]\d{0,19}$/.test(body.id);if(!validId)throw new Error("Kakao subject missing");const account=body.kakao_account&&typeof body.kakao_account==="object"&&!Array.isArray(body.kakao_account)?body.kakao_account as Record<string,unknown>:null;return{kakaoSubject:String(body.id),...(input.includePhone?{phoneNumber:account?.phone_number,phoneNumberNeedsAgreement:account?.phone_number_needs_agreement}:{})};}
}

export interface KakaoConnectionRouteDependencies {
  authorize(value: string): Promise<AuthorizedFan>;
  repository: SupabaseKakaoConnectionRepository;
  port: KakaoConnectionPort;
  redirectUri: string;
  enrollmentEnabled?: boolean;
}
const headers={"cache-control":"no-store",vary:"Authorization"};
function auth(request:Request,deps:KakaoConnectionRouteDependencies){return deps.authorize(request.headers.get("authorization")??"");}
export function createKakaoStartHandler(deps:KakaoConnectionRouteDependencies){return async(request:Request)=>{
  if(request.method!=="POST")return Response.json({error:{code:"METHOD_NOT_ALLOWED"}},{status:405,headers:{...headers,allow:"POST"}});
  let owner:AuthorizedFan;
  try{owner=await auth(request,deps);}catch{return Response.json({error:{code:"UNAUTHORIZED"}},{status:401,headers});}
  try { const url=new URL(request.url); const values=url.searchParams.getAll("return"); if(values.length>1)throw new Error("duplicate return"); const returnPath=safeKakaoReturnPathSchema.parse(values[0]??"/settings"); const pkce=createKakaoPkce(); await deps.repository.createState({appUserId:owner.appUserId,stateHash:pkce.stateHash,codeVerifier:pkce.codeVerifier,returnPath}); return Response.json({authorizationUrl:deps.port.authorizationUrl({state:pkce.state,codeChallenge:pkce.codeChallenge,redirectUri:deps.redirectUri})},{headers}); }
  catch{return Response.json({error:{code:"KAKAO_CONNECTION_START_FAILED"}},{status:400,headers});}
};}
export function createKakaoEnrollmentStartHandler(deps:KakaoConnectionRouteDependencies){return async(request:Request)=>{
  if(request.method!=="POST")return Response.json({error:{code:"METHOD_NOT_ALLOWED"}},{status:405,headers:{...headers,allow:"POST"}});
  let owner:AuthorizedFan;
  try{owner=await auth(request,deps);}catch{return Response.json({error:{code:"UNAUTHORIZED"}},{status:401,headers});}
  try {
    const body=await request.json() as {consented?:unknown;consentVersion?:unknown};
    if(body.consented!==true||body.consentVersion!==KAKAO_ALIMTALK_CONSENT_VERSION)throw new Error("consent required");
    const url=new URL(request.url);const values=url.searchParams.getAll("return");if(values.length>1)throw new Error("duplicate return");
    const returnPath=safeKakaoReturnPathSchema.parse(values[0]??"/settings");const pkce=createKakaoPkce();
    await deps.repository.createState({appUserId:owner.appUserId,stateHash:pkce.stateHash,codeVerifier:pkce.codeVerifier,returnPath,purpose:"alimtalk"});
    return Response.json({authorizationUrl:deps.port.authorizationUrl({state:pkce.state,codeChallenge:pkce.codeChallenge,redirectUri:deps.redirectUri,scope:"phone_number"})},{headers});
  } catch{return Response.json({error:{code:"KAKAO_ENROLLMENT_START_FAILED"}},{status:400,headers});}
};}
export function createKakaoCallbackHandler(deps:KakaoConnectionRouteDependencies){return async(request:Request)=>{
  if(request.method!=="POST")return Response.json({error:{code:"METHOD_NOT_ALLOWED"}},{status:405,headers:{...headers,allow:"POST"}});
  let owner:AuthorizedFan;
  try{owner=await auth(request,deps);}catch{return Response.json({error:{code:"UNAUTHORIZED"}},{status:401,headers});}
  try { const body=kakaoConnectionCallbackSchema.parse(await request.json()); const stateHash=createHash("sha256").update(body.state).digest("hex");const saved=await deps.repository.consumeState({appUserId:owner.appUserId,stateHash}); const returnPath=safeKakaoReturnPathSchema.parse(saved.returnPath);if(saved.purpose==="alimtalk"&&deps.enrollmentEnabled!==true)throw new Error("enrollment disabled");const exchanged=await deps.port.exchange({code:body.code,codeVerifier:saved.codeVerifier,redirectUri:deps.redirectUri,includePhone:saved.purpose==="alimtalk"});const subjectHash=hashKakaoSubject(exchanged.kakaoSubject);if(saved.purpose==="alimtalk"){if(saved.consentVersion!==KAKAO_ALIMTALK_CONSENT_VERSION)throw new Error("invalid consent");const profile=readKakaoEnrollmentProfile(exchanged);const account=await deps.repository.complete({appUserId:owner.appUserId,subjectHash});const pending=await deps.repository.stageEnrollment({appUserId:owner.appUserId,stateHash,subjectHash:hashKakaoSubject(profile.subject),phone:profile.phone});return Response.json({account,returnPath,enrollmentPending:true,pending:{id:pending.id,destinationLabel:pending.destinationLabel,expiresAt:pending.expiresAt}},{headers});}const account=await deps.repository.complete({appUserId:owner.appUserId,subjectHash}); return Response.json({account,returnPath},{headers}); }
  catch{return Response.json({error:{code:"KAKAO_CONNECTION_CALLBACK_FAILED"}},{status:400,headers});}
};}
export function createKakaoDisconnectHandler(deps:KakaoConnectionRouteDependencies){return async(request:Request)=>{try{const owner=await auth(request,deps);return Response.json({account:await deps.repository.disconnect(owner.appUserId)},{headers});}catch{return Response.json({error:{code:"KAKAO_DISCONNECT_FAILED"}},{status:400,headers});}};}
