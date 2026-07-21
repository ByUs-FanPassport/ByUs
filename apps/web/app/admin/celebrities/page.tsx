import { AuthorizedCelebrityManager, type DeploymentEnvironment } from "../../../components/admin/celebrity-manager";

function deploymentEnvironment(): DeploymentEnvironment {
  if (process.env.VERCEL_ENV === "production") return "Production";
  if (process.env.VERCEL_ENV === "preview") return "Preview";
  return "Development";
}

export default function AdminCelebritiesPage() {
  return <AuthorizedCelebrityManager environment={deploymentEnvironment()} />;
}
