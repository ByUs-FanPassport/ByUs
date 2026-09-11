// Standalone local integration harness. Never imported by the Next application.
import { createRoot } from "react-dom/client";
import { InquiryScreen, AdminInquiryScreen } from "../../features/support/ui/inquiry-screen";
import "../../app/globals.css";
const query = new URLSearchParams(location.search);
const locale = query.get("locale") === "en" || query.get("lang") === "en" ? "en" : "ko";
const admin = location.pathname.startsWith("/admin/");
const id = location.pathname.match(/\/inquiries\/([^/]+)/)?.[1];
document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(admin ? <AdminInquiryScreen locale={locale} id={id} /> : <InquiryScreen locale={locale} id={id} />);
