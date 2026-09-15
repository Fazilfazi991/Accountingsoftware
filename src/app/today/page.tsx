import { requireOrganizationContext } from "@/lib/organization-context";
import { getTodayData } from "@/lib/today/data";
import { TodayView } from "@/components/today/today-view";

export const metadata = { title: "Today · Ledgerly" };

function calendarDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export default async function TodayPage() {
  const context = await requireOrganizationContext();
  const today = calendarDate(context.payload.organization.timezone || "Asia/Dubai");
  const data = await getTodayData(context, today);
  return <TodayView data={data} />;
}
