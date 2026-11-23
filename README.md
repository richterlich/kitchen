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
- **Rezepte → +**: Fotos oder PDFs der Karteikarten auswählen. Das Bild der Karte wird gespeichert
  und das Rezept öffnet sich direkt zum Eintragen von Titel, Zutaten (eine pro Zeile, z. B.
  „200 g Mehl“) und Zubereitung – das Kartenbild steht darunter zum Abschreiben.
  Digital erstellte PDFs (mit echtem Text, kein Scan) werden automatisch übernommen.
- **Woche**: Gerichte anhaken, Portionen wählen → **Bestätigen & Einkaufsliste erstellen**.
  **📋 Gerichte kopieren** kopiert die ausgewählten Gerichte (z. B. zum Verschicken).
  Gleiche Zutaten werden zusammengerechnet (300 g + 200 g Huhn = 500 g Huhn) und auf die
  gewählten Portionen umgerechnet. Zutaten mit EL/TL/Prise erscheinen nur mit Namen.
  Zutaten aus dem Vorrat stehen separat unter „Vorrat prüfen“.
- **Einkauf**: Einträge antippen zum Abhaken (werden nicht mitkopiert), unter jeder Zutat **Billa**/**Penny** wählen
  (steht beim Kopieren in Klammern dahinter, sortiert nach Billa, Penny, Rest; wird je Zutat gemerkt),
  ✕ löscht einen Eintrag, 🏠 verschiebt eine
  Zutat dauerhaft in den Vorrat, mit „+“ eigene Einträge ergänzen (z. B. Klopapier).
  **Vorrat prüfen**: Gewürze und Grundzutaten, die man meist zu Hause hat, stehen separat –
  nur antippen, wenn etwas leer ist, dann kommt es mit auf die Liste.
  Dann **Kopieren** oder **Senden**. **Abgehakte entfernen** räumt durchgestrichene Einträge weg, **Ganze Liste löschen** leert alles und setzt die Wochenauswahl zurück.
- **Vorrat** (eigener Tab, anfangs leer): eintippen, was ihr immer im Haus habt (mehrere mit Komma trennen),
  mit ✕ entfernen, mit 🛒 als „leer“ markieren → steht dann auf der Einkaufsliste.
- **Daten**: Sicherung exportieren/importieren. Die beiden Handys synchronisieren sich
  **nicht** automatisch – Rezepte auf einem Handy erfassen, Sicherung exportieren, auf dem
  anderen Handy importieren. Regelmäßig sichern, falls die App/Browserdaten gelöscht werden.

## Versionen
Die aktuelle Version steht in der App unter **Daten** (z. B. „App-Version v0.1“).
