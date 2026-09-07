import "server-only";
import { randomUUID } from "node:crypto";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { CertificationRepositoryError } from "./certification-repository";

export const privateHeaders = { "cache-control":"private, no-store", vary:"Authorization" };
export function json(body: unknown,status=200,headers:HeadersInit=privateHeaders){return Response.json(body,{status,headers});}
export function locale(request:Request):"ko"|"en"|null { const value=new URL(request.url).searchParams.get("locale")??"ko"; return value==="ko"||value==="en"?value:null; }
export function correlation(request:Request):string { const value=request.headers.get("x-correlation-id"); return value && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)?value:randomUUID(); }
export function mapError(error:unknown):Response {
  if(error instanceof CertificationBodyError)return json({error:{code:error.code}},error.code==="BODY_TOO_LARGE"?413:400);
  if(error instanceof AuthError)return json({error:{code:error.code}},error.status);
  if(error instanceof CertificationRepositoryError){
    const conflict=error.code.includes("STALE")||error.code.includes("ALREADY")||error.code.includes("IDEMPOTENCY")||error.code.includes("PREVIOUS");
    const invalid=error.code.includes("INVALID")||error.code.includes("COUNT")||error.code.includes("DUPLICATE")||error.code.includes("INCOMPLETE");
    const forbidden=error.code.includes("PASSPORT_REQUIRED")||error.code.includes("ADMIN_REQUIRED");
    return json({error:{code:error.code}},conflict?409:invalid?400:forbidden?403:error.code.includes("UNAVAILABLE")?503:400);
  }
  return json({error:{code:"CERTIFICATION_UNAVAILABLE"}},503);
}
export class CertificationBodyError extends Error {
  constructor(readonly code:"BODY_TOO_LARGE"|"INVALID_REQUEST"){super(code);this.name="CertificationBodyError";}
}
async function readBodyBounded(request:Request,max:number):Promise<Uint8Array>{
  const declared=request.headers.get("content-length");
  if(declared!==null){const value=Number(declared);if(!Number.isSafeInteger(value)||value<0||value>max)throw new CertificationBodyError("BODY_TOO_LARGE");}
  if(!request.body)throw new CertificationBodyError("INVALID_REQUEST");
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw new CertificationBodyError("BODY_TOO_LARGE");}chunks.push(value);}}
  finally{reader.releaseLock();}
  const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return body;
}
export async function boundedJson(request:Request,max=16_384):Promise<unknown>{
  const body=await readBodyBounded(request,max);
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body));}catch{throw new SyntaxError("Invalid JSON body");}
}
export async function boundedMultipart(request:Request,max:number):Promise<FormData>{
  const contentType=request.headers.get("content-type");if(!contentType?.toLowerCase().startsWith("multipart/form-data;"))throw new CertificationBodyError("INVALID_REQUEST");
  const body=await readBodyBounded(request,max);
  const buffer=new ArrayBuffer(body.byteLength);new Uint8Array(buffer).set(body);
  try{return await new Request(request.url,{method:"POST",headers:{"content-type":contentType},body:buffer}).formData();}catch{throw new CertificationBodyError("INVALID_REQUEST");}
}
