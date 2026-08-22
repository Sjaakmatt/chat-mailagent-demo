/**
 * `/mail/<id>` — de oude detailroute.
 *
 * Blijft bestaan als doorverwijzing naar `/item/<id>`. Niet uit netheid: er
 * staan links naar dit pad in de auditlog van elke bestaande klant en in mails
 * die al verstuurd zijn. Een 404 daar zou een spoor breken dat juist bedoeld is
 * om jaren mee te gaan.
 *
 * Geen rechtencontrole hier: die staat op `/item/[id]`, en die kent de module
 * van de rij. Twee keer toetsen zou betekenen dat deze route de module moet
 * raden.
 */

import { redirect } from "next/navigation";

export default async function MailDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/item/${id}`);
}
