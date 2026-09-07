import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export async function POST(request:Request){return certificationRoutes.submit(createCertificationDependencies())(request);}
