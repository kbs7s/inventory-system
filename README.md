# Inventory

A simple inventory management web app that runs in the browser on a phone, iPad or laptop.

**Open it:** https://kbs7s.github.io/inventory-system/

## What it does

- **Products** with SKU, category, unit, location, supplier, cost, sale price and a low-stock alert level.
- **Stock in / stock out / set count**, each logged with date and note, so every quantity change has a history.
- **Dashboard** with product count, units, stock value, low and out-of-stock items, and recent activity.
- **Search, filter and sort** products; filter history by type and date.
- **CSV import and export** (opens in Excel or Google Sheets) and **JSON backup / restore**.
- **Works offline** and can be installed to the home screen (iPhone/iPad: Safari, Share, Add to Home Screen).

## Where the data lives

Data is saved in the browser on each device (localStorage); there is no server or account. Each device has its own copy, so use **Data → Download backup** and **Restore from backup** to move data between devices, and keep regular backups.

## Code

Plain HTML, CSS and JavaScript, no build step: `index.html`, `styles.css`, `app.js`, `sw.js` (offline cache), `manifest.webmanifest`. To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.
