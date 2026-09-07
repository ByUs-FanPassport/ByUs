import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export async function GET(request:Request){return certificationRoutes.adminQueue(createCertificationDependencies())(request);}
