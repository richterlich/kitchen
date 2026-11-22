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
- **Rezepte → +**: PDFs (oder Fotos) der Karteikarten auswählen, auch mehrere gleichzeitig.
  Hat die PDF eine Textebene, werden Titel, Portionen, Zutaten und Zubereitung automatisch
  erkannt (Überschriften „Zutaten“ und „Zubereitung“/„Anleitung“ helfen dabei).
  Eingescannte PDFs ohne Text: Die Karte wird als Bild angezeigt, Zutaten bitte über ✎
  eintragen (eine pro Zeile, z. B. `200 g Mehl`).
- **Woche**: Gerichte anhaken, Portionen einstellen → **Bestätigen & Einkaufsliste erstellen**.
  Gleiche Zutaten werden zusammengezählt und auf die Portionen umgerechnet.
- **Einkauf**: Liste bei Bedarf bearbeiten → **Kopieren** (dann in WhatsApp/SMS einfügen)
  oder **Senden** (öffnet direkt das Teilen-Menü).
- **Daten**: Sicherung exportieren/importieren. Die beiden Handys synchronisieren sich
  **nicht** automatisch – Rezepte auf einem Handy erfassen, Sicherung exportieren, auf dem
  anderen Handy importieren. Regelmäßig sichern, falls die App/Browserdaten gelöscht werden.
