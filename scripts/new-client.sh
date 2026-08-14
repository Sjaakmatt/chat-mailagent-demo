#!/usr/bin/env bash
#
# new-client.sh — scaffold een klant-repo uit dit fundament.
#
#   ./scripts/new-client.sh <slug> "<Klantnaam>" [doelmap]
#
# Voorbeeld:
#   ./scripts/new-client.sh acme "Acme B.V."
#     → ../acme-mail-agent, klaar om een GitHub-repo aan te koppelen.
#
# Wat het doet (= stap 0 t/m 2 uit docs/NEW-CLIENT.md):
#   1. Kloont het fundament naar de doelmap.
#   2. Hernoemt de remote `origin` → `upstream`, zodat je later
#      `git pull upstream main` kunt doen om kernverbeteringen op te halen.
#      De klant-repo koppel je zelf als nieuwe `origin`.
#   3. Vervangt __CLIENT_SLUG__ en __CLIENT_NAME__ in de configbestanden.
#   4. Vult slug + naam in client.manifest.yaml.
#   5. Controleert dat er niets is blijven staan, installeert en draait
#      typecheck + tests.
#   6. Commit het resultaat, zodat `git diff upstream/main` precies laat zien
#      wat er voor deze klant afwijkt.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Alleen de CONFIG-bestanden worden gesubstitueerd.
#
# Bewust géén `grep -rl` over de hele repo: DEPLOY.md, docs/NEW-CLIENT.md en
# .github/workflows/deploy.yml noemen de placeholders omdat ze erover gáán.
# Die meevervangen zou de documentatie onleesbaar maken én — erger — de
# placeholder-guard in deploy.yml herschrijven naar de klantnaam, waardoor die
# altijd zou matchen en stil nutteloos wordt.
# ---------------------------------------------------------------------------
CONFIG_FILES=(
  "agents/mail-agent/wrangler.jsonc"
  "ui/wrangler.jsonc"
  "ui/supabase-magic-link-email.html"
  "client.manifest.yaml"
)

die() { echo "FOUT: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Argumenten
# ---------------------------------------------------------------------------
[ $# -ge 2 ] || die "gebruik: $0 <slug> \"<Klantnaam>\" [doelmap]"

SLUG="$1"
NAME="$2"
TARGET="${3:-../${SLUG}-mail-agent}"

# De slug landt in Worker- en Workflow-namen; Cloudflare accepteert daar alleen
# kleine letters, cijfers en streepjes. Liever hier falen dan bij de eerste deploy.
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]] \
  || die "slug '$SLUG' mag alleen kleine letters, cijfers en streepjes bevatten (en niet met een streepje beginnen)"

[ -n "$NAME" ] || die "klantnaam mag niet leeg zijn"
[ ! -e "$TARGET" ] || die "doelmap '$TARGET' bestaat al"

FUNDAMENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$FUNDAMENT_ROOT"

# Standaard klonen we van de gepubliceerde fundament-remote, niet van je lokale
# checkout: een klant hoort te starten op wat er in `main` staat, niet op wat jij
# toevallig lokaal open hebt. Beide zijn te overrulen voor tests of een fork.
FUNDAMENT_URL="${FUNDAMENT_URL:-$(git remote get-url origin 2>/dev/null || echo "$FUNDAMENT_ROOT")}"
FUNDAMENT_BRANCH="${FUNDAMENT_BRANCH:-main}"

echo "Klant     : $NAME"
echo "Slug      : $SLUG"
echo "Doelmap   : $TARGET"
echo "Fundament : $FUNDAMENT_URL ($FUNDAMENT_BRANCH)"
echo

# ---------------------------------------------------------------------------
# 1. Klonen + remotes goedzetten
#
# `--branch` staat er expliciet: zonder dat pakt git de default branch van de
# remote, en die kan per ongeluk op een feature-branch staan. Dan zou een klant
# stilletjes op onafgemaakt werk starten.
# ---------------------------------------------------------------------------
echo "→ Klonen…"
git clone --quiet --branch "$FUNDAMENT_BRANCH" "$FUNDAMENT_URL" "$TARGET" \
  || die "klonen mislukt — bestaat branch '$FUNDAMENT_BRANCH' op $FUNDAMENT_URL?"
cd "$TARGET"

git remote rename origin upstream
echo "  remote 'upstream' → $FUNDAMENT_URL"

# ---------------------------------------------------------------------------
# 2. Placeholders vervangen
#
# Via perl met $ENV{}: de klantnaam kan spaties, punten of & bevatten, en die
# zouden in een sed-expressie verkeerd geïnterpreteerd worden.
# ---------------------------------------------------------------------------
echo "→ Placeholders vervangen…"
for f in "${CONFIG_FILES[@]}"; do
  [ -f "$f" ] || die "verwacht bestand ontbreekt: $f"
  CLIENT_SLUG="$SLUG" CLIENT_NAME="$NAME" perl -pi -e '
    s/__CLIENT_SLUG__/$ENV{CLIENT_SLUG}/g;
    s/__CLIENT_NAME__/$ENV{CLIENT_NAME}/g;
  ' "$f"
  echo "  $f"
done

# client.manifest.yaml gebruikt een eigen <...>-stijl voor slug en naam.
CLIENT_SLUG="$SLUG" CLIENT_NAME="$NAME" perl -pi -e '
  s/"<klant-slug>"/"$ENV{CLIENT_SLUG}"/;
  s/"<Klantnaam>"/"$ENV{CLIENT_NAME}"/;
' client.manifest.yaml

# ---------------------------------------------------------------------------
# 3. Controleren
# ---------------------------------------------------------------------------
echo "→ Controleren…"
if grep -l '__CLIENT_SLUG__\|__CLIENT_NAME__' "${CONFIG_FILES[@]}" 2>/dev/null; then
  die "er staan nog slug/naam-placeholders in bovenstaande configbestanden"
fi

# De guard in .github/workflows/deploy.yml moet de tokens juist nog kennen —
# die grept erop. Als die hier weg zijn, is er te veel vervangen.
grep -q '__CLIENT_SLUG__' .github/workflows/deploy.yml \
  || die "de placeholder-guard in deploy.yml is per ongeluk mee-vervangen"

echo "  slug + naam ingevuld, guard intact"

# ---------------------------------------------------------------------------
# 4. Installeren + verifiëren
# ---------------------------------------------------------------------------
if [ "${SKIP_VERIFY:-}" = "1" ]; then
  echo "→ Verificatie overgeslagen (SKIP_VERIFY=1)"
else
  echo "→ Installeren…"
  pnpm install --frozen-lockfile --silent
  echo "→ Typecheck + tests…"
  pnpm -r typecheck >/dev/null
  pnpm -r test >/dev/null
  echo "  groen"
fi

# ---------------------------------------------------------------------------
# 5. Vastleggen
# ---------------------------------------------------------------------------
git add -A
git commit --quiet -m "Scaffold klant-agent voor ${NAME}

Slug '${SLUG}' ingevuld in de wrangler-configs, de auth-mailtemplate en het
client-manifest. Org-id's volgen zodra de tenant is aangemaakt.

Gegenereerd met scripts/new-client.sh uit het mail-agent-fundament."

cat <<EOF

────────────────────────────────────────────────────────────────────────
Klaar. De repo staat in: $TARGET

Nog in te vullen (dat kan pas als de tenant bestaat):
  __CLIENT_ORG_ID__        → org-id van de klant        (NEW-CLIENT stap 3)
  __CLIENT_TEST_ORG_ID__   → org-id van het test-tenant (stap 9, optioneel)

Volgende stappen:
  1. Maak de GitHub-repo aan en koppel 'm:
       cd $TARGET
       git remote add origin git@github.com:<org>/${SLUG}-mail-agent.git
       git push -u origin main

  2. Zet in de klant-repo:
       secret   CLOUDFLARE_API_TOKEN   + CLOUDFLARE_ACCOUNT_ID   (deploy)
       variable FUNDAMENT_REPO         + secret FUNDAMENT_TOKEN  (upstream-sync)
     Zonder de laatste twee slaat de wekelijkse fundament-sync over.

  3. Loop docs/NEW-CLIENT.md af vanaf stap 3 (Supabase + tenant).
     Stap 4 (categorieën) is de belangrijkste inhoudelijke stap.

Kernverbeteringen later ophalen:
       git fetch upstream && git merge upstream/main
     of automatisch, elke maandag, via .github/workflows/upstream-sync.yml
────────────────────────────────────────────────────────────────────────
EOF
