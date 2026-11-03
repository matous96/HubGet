/**
 * Zaniklé a rozbité CDN nad GitHubem – stejné soubory nabízí jsDelivr:
 * /gh/<uživatel>/<repozitář>@<větev nebo commit>/<cesta>.
 *  - rawgit.com, cdn.staticaly.com: zaniklé,
 *  - cdn.statically.io: přesměruje HTTPS na HTTP, které aplikace nenačte (CSP img-src) –
 *    obrázky z něj (screenshoty KiCadu…) byly v galerii prázdné.
 * Obrázkový proxy (…/img/<host>/<cesta>) se nahradí původní adresou. Adresa bez větve
 * (např. „…/repo//icons/x.png“) nejde opravit → null.
 *
 * Používá ji datová pipeline (data-pipeline/src/lib/images.ts) i aplikace pro katalog
 * stažený před opravou (services/catalog.ts).
 */
export function fixDeadCdn(url: string): string | null {
  const proxied = url.match(/^https?:\/\/cdn\.static(?:aly\.com|ally\.io)\/img\/(.+)$/);
  if (proxied) return `https://${proxied[1]}`;
  const dead = url.match(/^https?:\/\/(?:cdn\.rawgit\.com|rawgit\.com|cdn\.staticaly\.com\/gh|cdn\.statically\.io\/gh)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!dead) return url;
  const [, user, repo, rest] = dead;
  // „repo@větev/cesta“ – větev už v adrese je
  if (repo.includes("@")) return `https://cdn.jsdelivr.net/gh/${user}/${repo}/${rest}`;
  const slash = rest.indexOf("/");
  const [ref, path] = slash < 0 ? ["", rest] : [rest.slice(0, slash), rest.slice(slash + 1)];
  return ref && path ? `https://cdn.jsdelivr.net/gh/${user}/${repo}@${ref}/${path}` : null;
}
