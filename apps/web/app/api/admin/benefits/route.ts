import { createBenefitAdminRouteDependencies } from "../../../../server/g5/benefit-admin-route-dependencies";
import { createGetBenefitAdminHandler,createPostBenefitAdminHandler } from "../../../../server/g5/benefit-admin-route";
export const dynamic="force-dynamic";
export async function GET(request:Request){return createGetBenefitAdminHandler(createBenefitAdminRouteDependencies())(request);}
export async function POST(request:Request){return createPostBenefitAdminHandler(createBenefitAdminRouteDependencies())(request);}
