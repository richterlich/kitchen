# Rezeptkartei – Installation & Nutzung

Die App ist eine **Web-App (PWA)**: Sie wird einmal aus dem Internet geladen, dann auf dem
Home-Bildschirm installiert und läuft danach **komplett offline**. Alle Rezepte, PDFs und
Einkaufslisten bleiben **nur auf dem jeweiligen Handy** (im Browser-Speicher), nichts wird
hochgeladen.

## 1. Einmalig online stellen (kostenlos, z. B. GitHub Pages)
1. Auf github.com ein Konto anlegen, neues Repository (z. B. `rezepte`) erstellen.
2. Alle Dateien aus diesem Ordner hochladen („Add file → Upload files“), inkl. Ordner `lib/`.
3. Repository → Settings → Pages → „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
4. Nach ca. 1 Minute ist die App unter `https://<name>.github.io/rezepte/` erreichbar.
   (HTTPS ist nötig, damit der Offline-Modus funktioniert.)

## 2. Auf dem Handy installieren
- **iPhone 13 Pro:** Adresse in **Safari** öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.
- **Galaxy Fold 5:** Adresse in **Chrome** öffnen → Menü ⋮ → „App installieren“ /
  „Zum Startbildschirm hinzufügen“.

Danach immer über das Symbol „Rezepte“ starten.

## 3. Nutzung
- **Rezepte → +**: Fotos oder PDFs der Karteikarten auswählen, auch mehrere gleichzeitig.
  Die App liest den Text der Karte automatisch aus (Texterkennung direkt auf dem Handy,
  funktioniert offline) und trägt Titel, Portionen, Zutaten und Zubereitung ein – auch bei
  Karten mit zwei Spalten. Ergebnis kurz prüfen, bei Bedarf über ✎ korrigieren.
  Tipp für Fotos: Karte gerade, formatfüllend und ohne Schatten fotografieren.
- **Handgeschriebene Karten** kann die eingebaute Texterkennung nicht lesen. Stattdessen die
  Handschrift vom Handy lesen lassen und einfügen: Rezept öffnen → **📋 Text einfügen**.
  iPhone: ins Einfügefeld tippen und halten → „Text scannen“ (oder Live Text in der Fotos-App).
  Samsung: Galerie → Foto → „T“ (Text extrahieren) bzw. Google Lens. Die App teilt den Text
  anhand von „Zutaten:“, „Zubereitung:“, Kommas und Pfeilen (→) auf.
- Bereits gespeicherte Rezepte ohne Zutaten: Rezept öffnen → **🔍 Text aus Karte erkennen**.
- **Woche**: Gerichte anhaken → **Bestätigen & Einkaufsliste erstellen**.
  Die Liste enthält nur die Zutaten ohne Mengen (z. B. „Huhn“). Wird eine Zutat in mehreren
  Rezepten gebraucht, steht davor, wie oft (z. B. „2x Zwiebel“).
- **Einkauf**: Einträge antippen zum Abhaken (werden nicht mitkopiert), ✕ löscht einen Eintrag, 🏠 verschiebt eine
  Zutat dauerhaft in den Vorrat, mit „+“ eigene Einträge ergänzen (z. B. Klopapier).
  **Vorrat prüfen**: Gewürze und Grundzutaten, die man meist zu Hause hat, stehen separat –
  nur antippen, wenn etwas leer ist, dann kommt es mit auf die Liste.
  Dann **Kopieren** oder **Senden**. **Abgehakte entfernen** räumt durchgestrichene Einträge weg, **Ganze Liste löschen** leert alles und setzt die Wochenauswahl zurück.
- **Vorrat** (eigener Tab): eintippen, was ihr immer im Haus habt (mehrere mit Komma trennen),
  mit ✕ entfernen, mit 🛒 als „leer“ markieren → steht dann auf der Einkaufsliste.
- **Daten**: Sicherung exportieren/importieren. Die beiden Handys synchronisieren sich
  **nicht** automatisch – Rezepte auf einem Handy erfassen, Sicherung exportieren, auf dem
  anderen Handy importieren. Regelmäßig sichern, falls die App/Browserdaten gelöscht werden.
