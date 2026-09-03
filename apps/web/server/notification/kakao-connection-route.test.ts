import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { createKakaoCallbackHandler,createKakaoStartHandler } from "./kakao-connection-route";

function deps(){const repository={createState:vi.fn(),consumeState:vi.fn(async()=>({codeVerifier:"v".repeat(64),returnPath:"/settings"})),complete:vi.fn(async()=>({provider:"kakao" as const,status:"connected" as const,connectedAt:"2026-09-04T00:00:00.000Z",disconnectedAt:null})),disconnect:vi.fn()};return {authorize:vi.fn(async()=>({appUserId:"owner",privyUserId:"p",verifiedEmail:"o@example.com"})),repository:repository as never,_repository:repository,port:{authorizationUrl:vi.fn(()=>"https://kauth.kakao.com/oauth/authorize?state=x"),exchange:vi.fn(async()=>({kakaoSubject:"123"}))},redirectUri:"https://dev.byus.test/api/me/connected-accounts/kakao/callback"};}
describe("Kakao connection routes",()=>{
 it("rejects unauthenticated start and unsafe return paths",async()=>{const d=deps();d.authorize.mockRejectedValue(new Error("no"));expect((await createKakaoStartHandler(d)(new Request("https://dev.byus.test/api?return=https://evil.test"))).status).toBe(401);});
 it("consumes owner-bound state once and discards provider tokens",async()=>{const d=deps();const response=await createKakaoCallbackHandler(d)(new Request("https://dev.byus.test/api?code=c&state="+"s".repeat(40),{headers:{authorization:"Bearer x"}}));expect(response.status).toBe(200);expect(d._repository.consumeState).toHaveBeenCalledWith({appUserId:"owner",stateHash:expect.stringMatching(/^[0-9a-f]{64}$/)});expect(JSON.stringify(d._repository.complete.mock.calls)).not.toContain("token");});
 it("fails closed on provider callback errors",async()=>{const d=deps();expect((await createKakaoCallbackHandler(d)(new Request("https://dev.byus.test/api?error=denied",{headers:{authorization:"Bearer x"}}))).status).toBe(400);});
});
