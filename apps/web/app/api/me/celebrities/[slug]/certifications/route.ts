import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){return certificationRoutes.history(createCertificationDependencies())(request,await params);}
