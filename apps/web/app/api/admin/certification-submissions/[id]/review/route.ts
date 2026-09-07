import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return certificationRoutes.adminReview(createCertificationDependencies())(request,await params);}
