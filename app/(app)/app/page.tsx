import { redirect } from "next/navigation";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";

export default function AppHomePage() {
  redirect(ANBAR_APP_PATH);
}
