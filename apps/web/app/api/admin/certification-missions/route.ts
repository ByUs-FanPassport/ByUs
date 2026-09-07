import { createCertificationDependencies } from "@/server/certification/certification-dependencies";
import { certificationRoutes } from "@/server/certification/certification-routes";
export async function GET(request:Request){return certificationRoutes.adminMissions(createCertificationDependencies())(request);}
export async function POST(request:Request){return certificationRoutes.adminMissions(createCertificationDependencies())(request);}
