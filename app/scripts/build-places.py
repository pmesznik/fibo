"""Buduje app/src-tauri/data/places.tsv z danych GeoNames (CC BY 4.0, https://www.geonames.org).

Uruchamiane ręcznie, rzadko (dane miejscowości prawie się nie zmieniają); wynik jest w repozytorium, a program nic nie pobiera.
Wejście: cities15000.txt i alternateNamesV2.txt z https://download.geonames.org/export/dump/ (rozpakowane).
Użycie: python build-places.py <cities15000.txt> <alternateNamesV2.txt> <wyjście places.tsv>
Wynik: wiersze "nazwa<TAB>kraj<TAB>szerokość<TAB>długość<TAB>liczba mieszkańców". Nazwa jest polska, gdy GeoNames ją zna, inaczej podstawowa.
Dzielnice dużych miast (np. arrondissements Paryża) są pomijane, żeby zdjęcie z centrum miasta dostawało nazwę miasta.
"""
import math
import sys

cities_path, alt_path, out_path = sys.argv[1:4]

cities = {}
for line in open(cities_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if f[7] == "PPLX":
        continue
    cities[f[0]] = {"name": f[1], "cc": f[8], "lat": float(f[4]), "lon": float(f[5]), "pop": int(f[14] or 0)}

polish = {}
for line in open(alt_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) < 8 or f[2] != "pl" or f[1] not in cities or f[6] == "1" or f[7] == "1":
        continue
    score = (f[4] == "1", f[5] != "1")
    if f[1] not in polish or score > polish[f[1]][0]:
        polish[f[1]] = (score, f[3])

rows = []
for gid, c in cities.items():
    c["name"] = polish[gid][1] if gid in polish else c["name"]
    rows.append(c)

# Pomijamy miejscowość, jeśli w promieniu 10 km leży miejscowość ponad trzy razy większa (dzielnice i przedmieścia wchłonięte przez miasto).
rows.sort(key=lambda c: -c["pop"])
kept = []
for c in rows:
    absorbed = False
    for b in kept:
        if b["pop"] < 3 * max(c["pop"], 1):
            break
        dy = (b["lat"] - c["lat"]) * 111.2
        dx = (b["lon"] - c["lon"]) * 111.2 * math.cos(math.radians(c["lat"]))
        if dx * dx + dy * dy < 100:
            absorbed = True
            break
    if not absorbed:
        kept.append(c)

with open(out_path, "w", encoding="utf-8", newline="\n") as o:
    for c in kept:
        o.write(f"{c['name']}\t{c['cc']}\t{c['lat']:.3f}\t{c['lon']:.3f}\t{c['pop']}\n")
print(len(kept), "miejscowości")
