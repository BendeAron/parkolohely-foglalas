# Felhasználói kézikönyv

**Parkolóhely-foglaló rendszer** — telepítés, használat, hibaelhárítás.

---

## Tartalom

- [1. Előfeltételek](#1-előfeltételek)
- [2. Indítás egyetlen paranccsal](#2-indítás-egyetlen-paranccsal)
- [3. A felület felépítése](#3-a-felület-felépítése)
- [4. Foglalás lépésről lépésre](#4-foglalás-lépésről-lépésre)
- [5. Foglalás lemondása](#5-foglalás-lemondása)
- [6. Egy hely menetrendjének megtekintése](#6-egy-hely-menetrendjének-megtekintése)
- [7. Árképzés és kedvezmények](#7-árképzés-és-kedvezmények)
- [8. Adatbázis visszaállítása](#8-adatbázis-visszaállítása)
- [9. Hibaelhárítás](#9-hibaelhárítás)
- [10. Napi használatú parancsok](#10-napi-használatú-parancsok)

---

## 1. Előfeltételek

**Docker Desktop.** Ennyi.

Nincs szükség külön telepített PHP-ra, Node.js-re, npm-re vagy PostgreSQL-re —
minden konténerben fut. A Docker Desktop tartalmazza a Docker Compose-t is.

Ellenőrzés:

```bash
docker --version
docker compose version
```

Ha mindkettő kiír egy verziószámot, minden megvan.

---

## 2. Indítás egyetlen paranccsal

A projekt gyökérkönyvtárában:

```bash
git clone <repo-url>
cd parkolohely-foglalas
docker compose up --build
```

Az első indulás néhány percig tart, amíg az image-ek felépülnek és a függőségek
települnek. Ezután néhány másodperc.

Amikor a naplók elcsendesednek, nyisd meg:

| Cím                       | Mit ér el                                 |
| ------------------------- | ----------------------------------------- |
| **http://localhost:5173** | **A felhasználói felület — ezt használd** |
| http://localhost:8000     | A REST API (fejlesztéshez, teszteléshez)  |
| `localhost:5432`          | Az adatbázis (pl. pgAdmin-ból)            |

Az adatbázis az első indításkor magától létrehozza a táblákat (`schema.sql`), majd
feltölti a parkolóhelyeket (`seed.sql`). A felületnek azonnal működnie kell.

**Leállítás:** `Ctrl+C`, vagy másik ablakból `docker compose down`.

**Háttérben futtatás** (a parancssor visszakapása):

```bash
docker compose up -d
```

---

## 3. A felület felépítése

A képernyő három sávból áll, fentről lefelé:

### 3.1 Fejléc — a bejárati tábla

Bal oldalt a rendszer neve. Jobb oldalt három szám, amelyek a képernyőn látható
állapotot összegzik:

| Szám      | Jelentés                             |
| --------- | ------------------------------------ |
| **Free**  | Szabad helyek a vizsgált időablakban |
| **Taken** | Foglalt helyek                       |
| **Total** | Összes aktív hely                    |

A **My booking** gomb nyitja a lemondási panelt (5. fejezet).

### 3.2 Időablak-választó

Két időpontmező (**Arrive** — érkezés, **Leave** — távozás) és a **Check
availability** gomb.

A mezők nem engednek múltbeli időpontot, és a távozás legfeljebb 7 nappal az
érkezés után lehet.

### 3.3 Alaprajz (Floor Plan)

Rácsba rendezett parkolóhelyek. Minden kártyán a hely azonosítója (pl. `A-01`),
típusa és óradíja.

| Szín                                | Állapot                    | Kattintásra                   |
| ----------------------------------- | -------------------------- | ----------------------------- |
| 🟢 **Zöld keret**                   | Szabad a vizsgált ablakban | Megnyílik a foglalási űrlap   |
| 🟡 **Sárga keret**                  | Éppen ezt választottad ki  | —                             |
| 🔴 **Piros keret, sávozott háttér** | Foglalt                    | Megjelenik a hely menetrendje |

> **Fontos:** az oldal betöltésekor **minden hely zöld**. Ez nem azt jelenti,
> hogy minden szabad — időablak nélkül a rendszer a teljes készletet mutatja. A
> tényleges szabadság a **Check availability** megnyomása után jelenik meg. Az
> alaprajz fölötti szöveg mindig kiírja, melyik ablakra vonatkozik a nézet.

A helytípusok ikonnal is jelöltek:

| Ikon | Típus                            |
| ---- | -------------------------------- |
| 🚗   | `standard` — általános           |
| ⚡   | `electric` — elektromos töltővel |
| ♿   | `handicapped` — akadálymentes    |

---

## 4. Foglalás lépésről lépésre

### 1. lépés — időablak megadása

Állítsd be az **Arrive** és a **Leave** mezőt, majd nyomd meg a **Check
availability** gombot.

Az alaprajz frissül: ami zöld marad, az valóban szabad a megadott időszakra.

### 2. lépés — hely kiválasztása

Kattints egy zöld kártyára. Megnyílik a foglalási panel (mobilon alulról
felcsúszó fiók, asztali gépen középre kerülő ablak).

A panel tetején látod a hely azonosítóját, típusát és óradíját, alatta a
választott időablakot.

### 3. lépés — menetrend áttekintése

A panelen megjelenik a hely **Already booked** szakasza: 24 órás idősávok
naponként, a foglalt időszakok pirossal kiszínezve, alatta pontos időpontokkal.

Így látod, mikor szabad a hely a választott ablakon kívül is.

### 4. lépés — rendszám megadása

Írd be a **Licence plate** mezőbe. A rendszer automatikusan nagybetűsít.

Formátum: 2–15 karakter, betűk, számok, szóköz és kötőjel. Például `ZR-123-AB`.

> **Jegyezd meg a rendszámot** — a lemondáshoz ez az egyetlen azonosító.

### 5. lépés — kedvezmény

Három lehetőség közül választhatsz:

- **No discount** — nincs kedvezmény
- **Student** — diák, 15%
- **Senior** — nyugdíjas, 20%

Az **esti kedvezmény nem választható**: a rendszer magától alkalmazza, ha az
időpont jogosult rá (7. fejezet). Ilyenkor zöld sáv jelenik meg:

> _Overnight rate applied automatically — 25% off._

### 6. lépés — ár ellenőrzése

A panel alján a részletezés:

```
3 h × 2.50            7.50
Evening (automatic)  −1.88
─────────────────────────
Total                 5.62
```

Az ár minden módosításnál azonnal újraszámolódik, és pontosan azt az összeget
mutatja, amit a szerver is kiszámol.

### 7. lépés — foglalás

Nyomd meg a **Reserve for …** gombot.

**Sikeres foglalás** esetén zöld értesítés jelenik meg a foglalás
azonosítójával és végösszegével. Ez az értesítés kattintásig megmarad — érdemes
feljegyezni az azonosítót.

**Ha közben más lefoglalta** a helyet, sárga figyelmeztetést kapsz
(_„Already taken"_), és az alaprajz azonnal frissül. Válassz másik helyet.

---

## 5. Foglalás lemondása

Lemondani csak **még el nem kezdődött** foglalást lehet.

### 1. lépés

Kattints a fejlécben a **My booking** gombra.

### 2. lépés

Írd be a rendszámot, amivel foglaltál, és nyomd meg a **Find** gombot (vagy
`Enter`).

### 3. lépés

Megjelenik az összes közelgő foglalásod. Mindegyiknél látod a hely azonosítóját,
az időpontot, a foglalási számot és az árat.

| Megjelenés      | Jelentés                          |
| --------------- | --------------------------------- |
| **Cancel** gomb | Lemondható                        |
| _In progress_   | Már elkezdődött — nem mondható le |
| _Locked_        | Lezárult vagy már lemondott       |

### 4. lépés

Kattints a **Cancel** gombra. Megerősítést kér — a lemondás visszavonhatatlan.
Nyomd meg a **Yes, cancel it** gombot.

Zöld értesítés igazolja vissza a lemondást, és a hely azonnal újra foglalható
lesz mindenki számára.

> **Nem találod a foglalásod?** Ellenőrizd a rendszám írásmódját. A rendszer
> nagybetűsít és összevonja a többszörös szóközöket, de a kötőjeleknek egyezniük
> kell azzal, ahogy foglaláskor beírtad.

---

## 6. Egy hely menetrendjének megtekintése

**Kattints bármelyik piros (foglalt) kártyára.** A panel csak olvasható módban
nyílik meg, és megmutatja, mikor foglalt az adott hely.

Ez a leggyorsabb módja annak, hogy megtaláld a következő szabad idősávot: nézd
meg a rést a piros sávok között, állítsd át fent az időablakot, és nyomj újra
**Check availability**-t.

Adatvédelmi okból a menetrend **csak időpontokat mutat** — más foglaló rendszámát
és a fizetett összeget nem.

---

## 7. Árképzés és kedvezmények

### 7.1 Számlázás

**Megkezdett óránként.** A 61 perc két óra díja, a minimum egy óra.

### 7.2 Kedvezmények

| Kedvezmény | Mérték | Hogyan kapod    |
| ---------- | ------ | --------------- |
| Diák       | 15%    | kiválasztod     |
| Nyugdíjas  | 20%    | kiválasztod     |
| Esti       | 25%    | **automatikus** |

### 7.3 Az esti kedvezmény feltétele

A **teljes** foglalásnak 18:00 és 06:00 közé kell esnie. Mindkét határ beleszámít.

| Foglalás      | Jár a kedvezmény?                       |
| ------------- | --------------------------------------- |
| 20:00 → 23:00 | ✅ igen                                 |
| 18:00 → 06:00 | ✅ igen                                 |
| 22:00 → 02:00 | ✅ igen (az éjfél átlépése rendben van) |
| 01:00 → 05:00 | ✅ igen                                 |
| 17:59 → 20:00 | ❌ nem — egy perccel korábban kezdődik  |
| 20:00 → 07:00 | ❌ nem — egy órával később ér véget     |
| 10:00 → 14:00 | ❌ nem — nappal                         |

Ha jogosult vagy rá, **az esti kedvezmény felülírja a diák- és nyugdíjas
kedvezményt**, mert nagyobb — tehát mindig a jobbik árat kapod.

---

## 8. Adatbázis visszaállítása

A séma- és a kezdőadat-szkript **csak üres adatkötet mellett fut le**. Ha
módosítod a `schema.sql`-t vagy a `seed.sql`-t az első indítás után, semmi nem
történik, amíg le nem törlöd a kötetet.

```bash
docker compose down -v
docker compose up --build
```

A `-v` kapcsoló törli az adatkötetet, és vele **minden foglalást és
parkolóhelyet**. Utána a `schema.sql` és a `seed.sql` újra lefut.

`-v` nélkül az adatok megmaradnak, és a szkriptek kimaradnak.

> ⚠️ Ez visszafordíthatatlan. Éles adaton előbb készíts mentést:
>
> ```bash
> docker exec parkolo_db_container pg_dump -U postgres parkolo_db > mentes.sql
> ```

### Adatbázis közvetlen megnyitása

```bash
docker exec -it parkolo_db_container psql -U postgres -d parkolo_db
```

Hasznos parancsok bent:

```sql
\dt                                              -- táblák listája
SELECT * FROM parking_spots;
SELECT * FROM reservations ORDER BY start_time;
\q                                               -- kilépés
```

---

## 9. Hibaelhárítás

### Minden hely zöld, pedig van foglalás

Nyomd meg a **Check availability** gombot. Betöltéskor a rendszer időablak nélkül
kérdez, ilyenkor mindent szabadnak jelöl — ez szándékos.

Ellenőrizd azt is, hogy a megadott ablak tényleg átfedi-e a foglalást. Egy
10:00–14:00-ig tartó ablak nem ütközik egy 20:00–23:00-as foglalással.

### „The server returned a response that isn't valid JSON"

A PHP hibaüzenetet írt ki a JSON elé. Nézd meg, mit küld valójában:

```bash
curl -s http://localhost:8000/get_spots.php
docker compose logs backend
```

> A PHP a törzs előtt küldi el a fejlécet, ezért egy futás közbeni végzetes hiba
> is `[200]`-ként naplózódik. A státuszkód nem megbízható, ha a kimenet már
> elindult.

### A felület nem tölt be

```bash
docker compose ps
```

Mind a három konténernek `Up` állapotban kell lennie. Ha nem:

```bash
docker compose logs frontend
docker compose logs backend
```

### „Port already in use"

Valami más foglalja az 5173-as, 8000-es vagy 5432-es portot.

Windows:

```powershell
netstat -ano | findstr :8000
```

Linux / macOS:

```bash
lsof -i :8000
```

Vagy írd át a gazdagép oldali portot a `docker-compose.yaml`-ban (`"5433:5432"`).

> Ha **két különböző PID** jelenik meg ugyanazon a porton, egy másik folyamat
> (gyakran egy ottfelejtett `php -S`) hallgatózik az IPv6-localhoston. A Node és
> a böngésző előbb `::1`-re oldja fel a `localhost`-ot, így az a folyamat fogadja
> a kérést a Docker helyett. Állítsd le, vagy használd a `127.0.0.1`-et.

### A sémamódosítás nem érvényesül

Lásd a [8. fejezetet](#8-adatbázis-visszaállítása) — kötettörlés nélkül az init-
szkriptek nem futnak le újra.

### Nem tudok foglalni: „Reservations cannot start in the past"

A kezdőidőpont a múltban van. Ha a gép órája elcsúszott a szerverétől, ez akkor
is előfordulhat, ha helyesnek tűnik az időpont — 60 másodperc türelmi idő van
beépítve.

### „This spot is already reserved for the selected time window"

Valaki megelőzött a foglalás beküldése és a mentés között. Az alaprajz magától
frissül; válassz másik helyet.

---

## 10. Napi használatú parancsok

```bash
docker compose up -d              # indítás a háttérben
docker compose down               # leállítás
docker compose down -v            # leállítás + adatok törlése
docker compose ps                 # mi fut éppen
docker compose logs -f backend    # backend naplója élőben
docker compose restart backend    # backend újraindítása
```

Kódmódosításhoz **nem kell újraindítás**: a `backend/` és az `src/` könyvtár be
van csatolva, a PHP-változások a következő kérésnél élnek, a React-változásokat a
Vite azonnal újratölti.

Újraépítés csak akkor kell, ha a `Dockerfile` változott:

```bash
docker compose build backend
docker compose up -d --force-recreate backend
```

### Tesztek futtatása

```bash
npm test                                                                # 36 egységteszt
npm run test:integration                                                # 37 API-teszt
docker compose exec backend php vendor/bin/phpunit --testsuite unit          # 28 PHP egységteszt
docker compose exec backend php vendor/bin/phpunit --testsuite integration   # 20 adatbázisteszt
```

Részletek: [`docs/TESTING.md`](docs/TESTING.md).
