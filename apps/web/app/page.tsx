import { GuestHome } from "../components/guest-home";
import { loadServerEnv } from "../server/config/env";
import { createLiveEventRepositoryFromEnvironment } from "../server/g3/live-event-repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const environment = loadServerEnv();
  const repository = createLiveEventRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const featuredLive = await repository.findFeaturedPublished({ locale: "ko", now: new Date() });
  return <GuestHome featuredLive={featuredLive} />;
}
