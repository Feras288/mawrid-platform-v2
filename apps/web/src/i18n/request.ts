import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: "Asia/Riyadh",
    formats: {
      dateTime: { short: { day: "numeric", month: "short", year: "numeric" }, long: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } },
      number: { money: { style: "currency", currency: "SAR" } },
    },
  };
});
