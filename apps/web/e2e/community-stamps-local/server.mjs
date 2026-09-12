// Isolated browser fixture: actual product component/CSS; synthetic auth and API.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)), web=path.resolve(here,'../..');
export async function startHarness(port=4193) {
 const server=await createServer({configFile:false,root:here,publicDir:path.join(web,'public'),cacheDir:path.join(web,'node_modules/.vite-community-stamps'),esbuild:{jsx:'automatic'},resolve:{alias:[{find:'@',replacement:web},{find:'next/navigation',replacement:path.join(here,'next-navigation.ts')},{find:'@privy-io/react-auth',replacement:path.join(here,'privy.ts')},...['link','image'].map(name=>({find:`next/${name}`,replacement:path.join(here,`../mission-local/next-${name}.tsx`)}))]},server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[web,path.resolve(web,'../../node_modules')]}}});
 await server.listen(); return {server,baseURL:`http://127.0.0.1:${port}`};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) { const h=await startHarness();console.log(h.baseURL); }
