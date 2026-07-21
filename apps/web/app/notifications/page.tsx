import { Suspense } from "react";
import { NotificationCenter } from "../../features/notification/ui/notification-center";
export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationCenter />
    </Suspense>
  );
}
