# Scripts navigateur CCC (Tampermonkey)

Mise à jour automatique : chaque script contient `@updateURL` / `@downloadURL` vers ce dépôt.
Pour qu'une modification soit prise en compte par Tampermonkey, **augmenter `@version`**.

| Fichier | Rôle |
|---|---|
| `ccc-gradereport-guard.user.js` | Couleurs GradeReport (live), version sans son |
| `ccc-gradereport-guard-sonore.user.js` | Même chose, version sonore (rien de coloré au départ ; couleur + message + son à la première tentative sur un bouton en erreur ; Option + clic = pas de son) |
| `ccc-gradereport-guard-sonore-son.user.js` | Compagnon de la version sonore : envoie la demande de son au service local du Mac (installé par `installer_lanceurs.command`, section 3d) |

Installation : ouvrir l'URL « raw » du fichier dans Chrome, Tampermonkey propose l'installation.
Ne pas activer en même temps la version sans son et la version sonore.
