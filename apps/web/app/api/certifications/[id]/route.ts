import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return certificationRoutes.publicDetail(createCertificationDependencies())(request,await params);}
