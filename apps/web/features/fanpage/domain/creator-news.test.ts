import { describe,expect,it } from "vitest";
import { creatorNewsItems, chzzkPostTitle } from "./creator-news";
describe("news ordering",()=>{
 it("prioritizes a pinned announcement over a welcome guide while limiting home to three",()=>{
  const notices=[{slug:"welcome",title:"안내",pinned:true,postType:"notice" as const,visibility:"public" as const,kind:"welcome" as const,publishedAt:"2026-09-15"},{slug:"important",title:"공지",pinned:true,postType:"notice" as const,visibility:"public" as const,kind:"standard" as const,publishedAt:"2026-09-01"}];
  const posts=[{id:"1",text:"\n 새 소식\n본문",date:"2026-09-16",images:[]},{id:"2",text:"과거",date:"2026-08-01",images:[]}];
  expect(creatorNewsItems(notices,posts,"ko",false).map(x=>x.key)).toEqual(["byus:important","chzzk:1","byus:welcome"]);
  expect(creatorNewsItems(notices,posts,"ko",true).map(x=>x.key)).toEqual(["byus:important","byus:welcome","chzzk:1","chzzk:2"]);
  expect(chzzkPostTitle(posts[0]!,"ko")).toBe("새 소식");
  expect(chzzkPostTitle({...posts[0]!,text:""},"en")).toBe("Photo update");
 });
});
