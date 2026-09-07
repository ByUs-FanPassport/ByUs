import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){return certificationRoutes.publicList(createCertificationDependencies())(request,await params);}
