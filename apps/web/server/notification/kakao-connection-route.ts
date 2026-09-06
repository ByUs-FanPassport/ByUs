import "server-only";
import { createHash } from "node:crypto";
import { createKakaoPkce, hashKakaoSubject, type KakaoConnectionPort } from "../../features/notification/domain/kakao-connection";
import { kakaoConnectionCallbackSchema, safeKakaoReturnPathSchema } from "../../features/notification/domain/kakao-connection-schema";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { SupabaseKakaoConnectionRepository } from "./kakao-connection-repository";

export class KakaoHttpConnectionPort implements KakaoConnectionPort {
  constructor(private readonly config:{clientId:string;clientSecret:string}){}
  authorizationUrl(input:{state:string;codeChallenge:string;redirectUri:string}){const url=new URL("https://kauth.kakao.com/oauth/authorize");url.search=new URLSearchParams({response_type:"code",client_id:this.config.clientId,redirect_uri:input.redirectUri,state:input.state,code_challenge:input.codeChallenge,code_challenge_method:"S256"}).toString();return url.toString();}
  async exchange(input:{code:string;codeVerifier:string;redirectUri:string}){const tokenResponse=await fetch("https://kauth.kakao.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:this.config.clientId,client_secret:this.config.clientSecret,redirect_uri:input.redirectUri,code:input.code,code_verifier:input.codeVerifier}),signal:AbortSignal.timeout(8000)});if(!tokenResponse.ok)throw new Error("Kakao token exchange failed");const token=await tokenResponse.json() as {access_token?:unknown};if(typeof token.access_token!=="string")throw new Error("Kakao token response invalid");const profile=await fetch("https://kapi.kakao.com/v2/user/me",{headers:{authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(8000)});if(!profile.ok)throw new Error("Kakao profile lookup failed");const body=await profile.json() as {id?:unknown};if(typeof body.id!=="number"&&typeof body.id!=="string")throw new Error("Kakao subject missing");return{kakaoSubject:String(body.id)};}
}

export interface KakaoConnectionRouteDependencies {
  authorize(value: string): Promise<AuthorizedFan>;
  repository: SupabaseKakaoConnectionRepository;
  port: KakaoConnectionPort;
  redirectUri: string;
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
export function createKakaoCallbackHandler(deps:KakaoConnectionRouteDependencies){return async(request:Request)=>{
  if(request.method!=="POST")return Response.json({error:{code:"METHOD_NOT_ALLOWED"}},{status:405,headers:{...headers,allow:"POST"}});
  let owner:AuthorizedFan;
  try{owner=await auth(request,deps);}catch{return Response.json({error:{code:"UNAUTHORIZED"}},{status:401,headers});}
  try { const body=kakaoConnectionCallbackSchema.parse(await request.json()); const saved=await deps.repository.consumeState({appUserId:owner.appUserId,stateHash:createHash("sha256").update(body.state).digest("hex")}); const returnPath=safeKakaoReturnPathSchema.parse(saved.returnPath); const exchanged=await deps.port.exchange({code:body.code,codeVerifier:saved.codeVerifier,redirectUri:deps.redirectUri}); const account=await deps.repository.complete({appUserId:owner.appUserId,subjectHash:hashKakaoSubject(exchanged.kakaoSubject)}); return Response.json({account,returnPath},{headers}); }
  catch{return Response.json({error:{code:"KAKAO_CONNECTION_CALLBACK_FAILED"}},{status:400,headers});}
};}
export function createKakaoDisconnectHandler(deps:KakaoConnectionRouteDependencies){return async(request:Request)=>{try{const owner=await auth(request,deps);return Response.json({account:await deps.repository.disconnect(owner.appUserId)},{headers});}catch{return Response.json({error:{code:"KAKAO_DISCONNECT_FAILED"}},{status:400,headers});}};}
